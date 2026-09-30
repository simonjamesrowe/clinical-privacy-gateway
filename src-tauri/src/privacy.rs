use crate::dictation::DictationState;
use crate::documents;
use crate::storage::{
    load_openai_key, openai_key_configured, remove_openai_key, save_openai_key,
    ClinicianProfileView, DocumentSummary, MappingView, NoteSummary, NoteView, PatientView,
    Storage,
};
use clinicians_veil_core::document_usage::{
    document_model, document_models, estimate, CostEstimate, DocumentModel, TokenUsage,
    UsageSummary, MAX_OUTPUT_TOKENS,
};
use clinicians_veil_core::documents::{
    DocumentFormat, DocumentMetadata, ExtractedDocument, OriginalDocument,
};
use clinicians_veil_core::{
    document_generation::{
        restore_response, DocumentBody, DocumentTemplate, PatientDocument, PreparedSubmission,
        RestoredDocument,
    },
    privacy::{self, Decision, PrivacyResult, Session, SessionView},
};
use clinicians_veil_ner::{assets, detect};
use serde::Serialize;
use std::{
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone)]
pub struct PrivacyState {
    inner: Arc<Mutex<Inner>>,
    root: PathBuf,
    storage: Option<Storage>,
}
#[derive(Default)]
struct Inner {
    session: Option<Session>,
    patient_id: Option<i64>,
    note_id: Option<i64>,
    active: Option<(u64, Arc<AtomicBool>)>,
    next_session: u64,
    import: Option<ImportedDocument>,
    preview: Option<DocumentPreview>,
}

struct ImportedDocument {
    id: u64,
    patient_id: i64,
    original: Arc<OriginalDocument>,
    extracted: ExtractedDocument,
}
struct DocumentPreview {
    id: u64,
    original: Arc<OriginalDocument>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportView {
    id: u64,
    document: DocumentMetadata,
    extracted: ExtractedDocument,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewView {
    id: u64,
    document: DocumentMetadata,
    extracted: ExtractedDocument,
}

impl PrivacyState {
    pub fn new(root: PathBuf, storage_root: PathBuf) -> Self {
        assets::cleanup(&root);
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            root,
            storage: Storage::open(&storage_root).ok(),
        }
    }
    fn lock(&self) -> PrivacyResult<MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| "The review session is unavailable. Restart the app.")
    }
    fn storage(&self) -> PrivacyResult<&Storage> {
        self.storage
            .as_ref()
            .ok_or("The encrypted note library is unavailable. Reopen the app and try again.")
    }
    pub(crate) fn begin(&self, operation: u64) -> PrivacyResult<Operation> {
        let mut inner = self.lock()?;
        if inner.active.is_some() {
            return Err("Wait for the current operation to finish.");
        }
        let cancel = Arc::new(AtomicBool::new(false));
        inner.active = Some((operation, cancel.clone()));
        Ok(Operation {
            state: self.clone(),
            cancel,
            id: operation,
        })
    }
    pub fn discard(&self) -> PrivacyResult<()> {
        let mut inner = self.lock()?;
        if let Some((_, cancel)) = &inner.active {
            cancel.store(true, Ordering::Relaxed);
        }
        inner.session = None;
        inner.import = None;
        inner.preview = None;
        inner.patient_id = None;
        inner.note_id = None;
        Ok(())
    }
    /// Whether a cancellable model, import or generation operation is running.
    pub(crate) fn busy(&self) -> PrivacyResult<bool> {
        Ok(self.lock()?.active.is_some())
    }
}

// RAII clears active work even if a worker fails or unwinds.
pub(crate) struct Operation {
    state: PrivacyState,
    pub(crate) cancel: Arc<AtomicBool>,
    pub(crate) id: u64,
}
impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.state.inner.lock() {
            if inner.active.as_ref().is_some_and(|(id, _)| *id == self.id) {
                inner.active = None;
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    operation: u64,
    stage: &'static str,
    completed: u64,
    total: u64,
}
pub(crate) fn progress(app: &AppHandle, op: u64, stage: &'static str, completed: u64, total: u64) {
    let _ = app.emit(
        "privacy-progress",
        Progress {
            operation: op,
            stage,
            completed,
            total,
        },
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    installed: bool,
    name: &'static str,
    bytes: u64,
    revision: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedNote {
    note: NoteView,
    session: SessionView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSettings {
    #[serde(flatten)]
    profile: ClinicianProfileView,
    api_key_configured: bool,
    models: Vec<DocumentModel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSubmissionView {
    document_id: i64,
    estimate: CostEstimate,
    id: String,
    model: String,
    destination: String,
    purpose: String,
    instructions: String,
    input: String,
    payload_digest: String,
    source_count: usize,
    review_notes: Vec<SubmissionReviewNoteView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionReviewNoteView {
    id: i64,
    title: String,
    reviewed_text: String,
    created_at: i64,
}

#[tauri::command]
pub async fn model_status(state: State<'_, PrivacyState>) -> PrivacyResult<ModelStatus> {
    let root = state.root.clone();
    tauri::async_runtime::spawn_blocking(move || ModelStatus {
        installed: assets::installed(&root),
        name: assets::MODEL_ID,
        bytes: assets::DOWNLOAD_BYTES,
        revision: assets::REVISION,
    })
    .await
    .map_err(|_| "Model status is unavailable.")
}

#[tauri::command]
pub async fn install_model(
    app: AppHandle,
    state: State<'_, PrivacyState>,
    operation: u64,
) -> PrivacyResult<()> {
    let op = state.begin(operation)?;
    tauri::async_runtime::spawn_blocking(move || {
        assets::install(&op.state.root, &op.cancel, |done, total| {
            progress(&app, op.id, "Downloading model", done, total)
        })
    })
    .await
    .map_err(|_| "Model installation could not finish.")?
}

#[tauri::command]
pub fn remove_model(state: State<'_, PrivacyState>) -> PrivacyResult<()> {
    let inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    drop(inner);
    assets::remove(&state.root)
}

#[tauri::command]
pub async fn replace_model(
    app: AppHandle,
    state: State<'_, PrivacyState>,
    operation: u64,
) -> PrivacyResult<()> {
    let op = state.begin(operation)?;
    tauri::async_runtime::spawn_blocking(move || {
        assets::remove(&op.state.root)?;
        assets::install(&op.state.root, &op.cancel, |done, total| {
            progress(&app, op.id, "Replacing model", done, total)
        })
    })
    .await
    .map_err(|_| "Model replacement could not finish.")?
}

#[tauri::command]
pub fn cancel_operation(state: State<'_, PrivacyState>, operation: u64) -> PrivacyResult<()> {
    if let Some((id, cancel)) = &state.lock()?.active {
        if *id == operation {
            cancel.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn discard_session(state: State<'_, PrivacyState>) -> PrivacyResult<()> {
    state.discard()
}

fn run_detectors(
    app: &AppHandle,
    op: &Operation,
    source: &str,
) -> PrivacyResult<Vec<privacy::Evidence>> {
    assets::cancelled(&op.cancel)?;
    // Whisper and the entity model are never resident together (8 GB unified memory budget).
    app.state::<DictationState>().release_model()?;
    progress(app, op.id, "Checking identifier patterns", 0, 0);
    let mut evidence = privacy::detect_rules(source);
    progress(app, op.id, "Loading local model", 0, 0);
    evidence.extend(detect(
        &op.state.root,
        source,
        &op.cancel,
        |done, total| {
            progress(
                app,
                op.id,
                "Finding named entities",
                done as u64,
                total as u64,
            )
        },
    )?);
    assets::cancelled(&op.cancel)?;
    Ok(evidence)
}

#[tauri::command]
pub async fn detect_text(
    app: AppHandle,
    state: State<'_, PrivacyState>,
    operation: u64,
    source: String,
    patient_id: Option<i64>,
    review_saved_mappings: bool,
    import_id: Option<u64>,
    acknowledge_warnings: Option<bool>,
) -> PrivacyResult<SessionView> {
    privacy::validate_source(&source)?;
    if let Some(patient_id) = patient_id {
        state.storage()?.patient(patient_id)?;
    }
    let library_matches = state.storage()?.matches(&source, patient_id)?;
    let op = state.begin(operation)?;
    let id = {
        let mut inner = state.lock()?;
        validate_import(
            &inner,
            import_id,
            patient_id,
            acknowledge_warnings.unwrap_or(false),
        )?;
        inner.session = None;
        inner.patient_id = patient_id;
        inner.note_id = None;
        inner.next_session += 1;
        inner.next_session
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut evidence = run_detectors(&app, &op, &source)?;
        evidence.extend(library_matches.iter().map(|matched| privacy::Evidence {
            span: privacy::Span {
                start: matched.start,
                end: matched.end,
            },
            category: matched.category,
            confidence: 1.0,
            stage: "library",
        }));
        let mut session = Session::new(id, source, evidence)?;
        session.apply_library_defaults(
            library_matches
                .into_iter()
                .map(|matched| {
                    (
                        privacy::Span {
                            start: matched.start,
                            end: matched.end,
                        },
                        matched.category,
                        matched.replacement,
                    )
                })
                .collect(),
            review_saved_mappings,
        );
        let mut inner = op.state.lock()?;
        assets::cancelled(&op.cancel)?;
        let view = session.view();
        inner.session = Some(session);
        Ok(view)
    })
    .await
    .map_err(|_| "Detection could not finish. Retry the local check.")?
}

fn change(
    state: &PrivacyState,
    session_id: u64,
    revision: u64,
    apply: impl FnOnce(&mut Session) -> PrivacyResult<()>,
) -> PrivacyResult<SessionView> {
    let mut inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    let session = inner.session.as_mut().ok_or("Start a new review.")?;
    session.matches(session_id, revision)?;
    apply(session)?;
    Ok(session.view())
}

#[tauri::command]
pub fn review_decision(
    state: State<'_, PrivacyState>,
    session_id: u64,
    revision: u64,
    item: u64,
    decision: Decision,
    replacement: Option<String>,
) -> PrivacyResult<SessionView> {
    change(&state, session_id, revision, |s| {
        s.decide(item, decision, replacement)
    })
}

#[tauri::command]
pub fn split_detection(
    state: State<'_, PrivacyState>,
    session_id: u64,
    revision: u64,
    item: u64,
) -> PrivacyResult<SessionView> {
    change(&state, session_id, revision, |s| s.split(item))
}

#[tauri::command]
pub fn add_manual_detection(
    state: State<'_, PrivacyState>,
    session_id: u64,
    revision: u64,
    start: usize,
    end: usize,
) -> PrivacyResult<SessionView> {
    change(&state, session_id, revision, |s| s.manual(start, end))
}

#[tauri::command]
pub async fn rescan_text(
    app: AppHandle,
    state: State<'_, PrivacyState>,
    operation: u64,
    session_id: u64,
    revision: u64,
) -> PrivacyResult<SessionView> {
    let op = state.begin(operation)?;
    let mut session = {
        let inner = state.lock()?;
        let session = inner.session.as_ref().ok_or("Start a new review.")?;
        session.matches(session_id, revision)?;
        session.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let source = session.scan_text()?;
        let evidence = run_detectors(&app, &op, &source)?;
        session.finish_scan(evidence)?;
        let mut inner = op.state.lock()?;
        assets::cancelled(&op.cancel)?;
        inner
            .session
            .as_ref()
            .ok_or("Start a new review.")?
            .matches(session_id, revision)?;
        let view = session.view();
        inner.session = Some(session);
        Ok(view)
    })
    .await
    .map_err(|_| "The final check could not finish. Please retry.")?
}

#[tauri::command]
pub fn copy_reviewed_text(
    state: State<'_, PrivacyState>,
    session_id: u64,
    revision: u64,
) -> PrivacyResult<()> {
    let inner = state.lock()?;
    let output = reviewed_output(&inner, session_id, revision)?;
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(output))
        .map_err(|_| "The clipboard is unavailable. Please try again.")
}

#[tauri::command]
pub fn save_reviewed_note(
    state: State<'_, PrivacyState>,
    session_id: u64,
    revision: u64,
    title: String,
) -> PrivacyResult<NoteView> {
    let mut inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    let session = inner.session.as_ref().ok_or("Start a new review.")?;
    let patient_id = inner
        .patient_id
        .ok_or("Start a new note for a patient first.")?;
    session.matches(session_id, revision)?;
    let (source_text, reviewed_text, provenance) = session.saveable_note()?;
    let note_id = inner.note_id;
    let document = inner.import.as_ref().map(|import| import.original.clone());
    let note = if let Some(note_id) = note_id {
        state.storage()?.update_note(
            note_id,
            patient_id,
            &title,
            &source_text,
            &reviewed_text,
            &provenance,
        )
    } else {
        state.storage()?.save_note_with_document(
            patient_id,
            &title,
            None,
            &source_text,
            &reviewed_text,
            &provenance,
            document.as_deref(),
        )
    }?;
    inner.note_id = Some(note.id);
    inner.import = None;
    inner.preview = None;
    Ok(note)
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, PrivacyState>,
    query: String,
    patient_id: Option<i64>,
) -> PrivacyResult<Vec<NoteSummary>> {
    state.storage()?.search_notes(&query, patient_id)
}

#[tauri::command]
pub fn note_detail(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<NoteView> {
    state.storage()?.note(id)
}

#[tauri::command]
pub fn open_saved_note(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<OpenedNote> {
    let note = state.storage()?.note(id)?;
    let patient_id = note
        .patient_id
        .ok_or("This saved note no longer has a patient.")?;
    let source_text = note
        .source_text
        .as_deref()
        .ok_or("This older note does not include its original text.")?;
    let mut inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    inner.next_session += 1;
    let session = Session::restore(inner.next_session, &note.provenance)?;
    if session.view().source != source_text {
        return Err("The saved review record is unavailable.");
    }
    let view = session.view();
    inner.import = None;
    inner.preview = None;
    inner.session = Some(session);
    inner.patient_id = Some(patient_id);
    inner.note_id = Some(id);
    Ok(OpenedNote {
        note,
        session: view,
    })
}

#[tauri::command]
pub fn delete_note(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<()> {
    let mut inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    state.storage()?.delete_note(id)?;
    inner.preview = None;
    if inner.note_id == Some(id) {
        inner.session = None;
        inner.note_id = None;
        inner.patient_id = None;
        inner.import = None;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_patient(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<()> {
    let mut inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    state.storage()?.delete_patient(id)?;
    inner.session = None;
    inner.note_id = None;
    inner.patient_id = None;
    inner.import = None;
    inner.preview = None;
    Ok(())
}

#[tauri::command]
pub fn copy_note(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<()> {
    let note = state.storage()?.note(id)?;
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(note.reviewed_text))
        .map_err(|_| "The clipboard is unavailable. Please try again.")
}

#[tauri::command]
pub fn list_mappings(state: State<'_, PrivacyState>) -> PrivacyResult<Vec<MappingView>> {
    state.storage()?.mappings()
}

#[tauri::command]
pub fn list_patient_mappings(
    state: State<'_, PrivacyState>,
    patient_id: i64,
) -> PrivacyResult<Vec<MappingView>> {
    state.storage()?.patient_mappings(patient_id)
}

#[tauri::command]
pub fn list_patients(state: State<'_, PrivacyState>) -> PrivacyResult<Vec<PatientView>> {
    state.storage()?.patients()
}

#[tauri::command]
pub fn create_patient(
    state: State<'_, PrivacyState>,
    name: String,
    patient_reference: Option<String>,
) -> PrivacyResult<PatientView> {
    state
        .storage()?
        .create_patient(&name, patient_reference.as_deref())
}

#[tauri::command]
pub fn update_patient(
    state: State<'_, PrivacyState>,
    id: i64,
    name: String,
    patient_reference: Option<String>,
) -> PrivacyResult<PatientView> {
    state
        .storage()?
        .update_patient(id, &name, patient_reference.as_deref())
}

/// Redactions are created during review and never deleted from the library, so
/// the only library change is the replacement of an all-patients redaction.
#[tauri::command]
pub fn update_mapping(
    state: State<'_, PrivacyState>,
    id: i64,
    replacement: String,
) -> PrivacyResult<MappingView> {
    state
        .storage()?
        .update_mapping_replacement(id, &replacement)
}

#[tauri::command]
pub fn update_patient_mapping(
    state: State<'_, PrivacyState>,
    patient_id: i64,
    id: i64,
    replacement: String,
) -> PrivacyResult<MappingView> {
    state
        .storage()?
        .update_patient_mapping_replacement(patient_id, id, &replacement)
}

#[tauri::command]
pub fn save_mapping_from_review(
    state: State<'_, PrivacyState>,
    session_id: u64,
    revision: u64,
    item: u64,
    patient_scope: bool,
) -> PrivacyResult<MappingView> {
    let inner = state.lock()?;
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    let session = inner.session.as_ref().ok_or("Start a new review.")?;
    session.matches(session_id, revision)?;
    let mapping = session.mapping_for_group(item)?;
    let patient_id = inner.patient_id;
    drop(inner);
    if patient_scope {
        state.storage()?.upsert_patient_mapping(
            patient_id.ok_or("Choose a patient before saving a patient-specific mapping.")?,
            &mapping.phrase,
            mapping.category,
            &mapping.replacement,
        )
    } else {
        state
            .storage()?
            .upsert_mapping(&mapping.phrase, mapping.category, &mapping.replacement)
    }
}

#[tauri::command]
pub fn list_document_templates(
    state: State<'_, PrivacyState>,
    include_archived: bool,
) -> PrivacyResult<Vec<DocumentTemplate>> {
    state.storage()?.templates(include_archived)
}

#[tauri::command]
pub fn create_document_template(
    state: State<'_, PrivacyState>,
    name: String,
    description: String,
    instructions: String,
) -> PrivacyResult<DocumentTemplate> {
    state
        .storage()?
        .create_template(&name, &description, &instructions)
}

#[tauri::command]
pub fn update_document_template(
    state: State<'_, PrivacyState>,
    id: i64,
    name: String,
    description: String,
    instructions: String,
) -> PrivacyResult<DocumentTemplate> {
    state
        .storage()?
        .update_template(id, &name, &description, &instructions)
}

#[tauri::command]
pub fn duplicate_document_template(
    state: State<'_, PrivacyState>,
    id: i64,
) -> PrivacyResult<DocumentTemplate> {
    state.storage()?.duplicate_template(id)
}

#[tauri::command]
pub fn set_document_template_archived(
    state: State<'_, PrivacyState>,
    id: i64,
    archived: bool,
) -> PrivacyResult<DocumentTemplate> {
    state.storage()?.set_template_archived(id, archived)
}

#[tauri::command]
pub fn document_settings(state: State<'_, PrivacyState>) -> PrivacyResult<DocumentSettings> {
    Ok(DocumentSettings {
        profile: state.storage()?.clinician_profile()?,
        api_key_configured: openai_key_configured(),
        models: document_models(),
    })
}

#[tauri::command]
pub fn save_document_settings(
    state: State<'_, PrivacyState>,
    display_name: String,
    role: String,
    qualifications: String,
    letter_header: String,
    signature: Option<Vec<u8>>,
    remove_signature: bool,
    openai_model: String,
    api_key: Option<String>,
) -> PrivacyResult<DocumentSettings> {
    document_model(&openai_model)?;
    if let Some(api_key) = api_key {
        state
            .storage()?
            .set_clinical_sending_enabled(false, [false; 4])?;
        save_openai_key(&api_key)?;
    }
    let profile = state.storage()?.save_clinician_profile(
        &display_name,
        &role,
        &qualifications,
        &letter_header,
        signature.as_deref(),
        remove_signature,
        &openai_model,
    )?;
    Ok(DocumentSettings {
        profile,
        api_key_configured: openai_key_configured(),
        models: document_models(),
    })
}

#[tauri::command]
pub fn remove_openai_api_key(state: State<'_, PrivacyState>) -> PrivacyResult<DocumentSettings> {
    state
        .storage()?
        .set_clinical_sending_enabled(false, [false; 4])?;
    remove_openai_key()?;
    document_settings(state)
}

#[tauri::command]
pub fn set_clinical_sending_enabled(
    state: State<'_, PrivacyState>,
    enabled: bool,
    organisational_approval: bool,
    provider_terms_reviewed: bool,
    data_controls_confirmed: bool,
    rollback_plan_confirmed: bool,
) -> PrivacyResult<DocumentSettings> {
    if enabled && !openai_key_configured() {
        return Err("Save an OpenAI API key before enabling clinical sending.");
    }
    state.storage()?.set_clinical_sending_enabled(
        enabled,
        [
            organisational_approval,
            provider_terms_reviewed,
            data_controls_confirmed,
            rollback_plan_confirmed,
        ],
    )?;
    document_settings(state)
}

#[tauri::command]
pub async fn test_openai_connection() -> PrivacyResult<()> {
    let key = load_openai_key()?;
    tauri::async_runtime::spawn_blocking(move || {
        let key = std::str::from_utf8(&key)
            .map_err(|_| "The OpenAI API key in Keychain is unavailable.")?;
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| "The OpenAI connection test could not start.")?;
        let response = client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(key)
            .send()
            .map_err(|_| {
                "OpenAI could not be reached. Check the network connection and try again."
            })?;
        if response.status().is_redirection() {
            return Err("OpenAI redirected the connection test, so nothing was followed.");
        }
        if !response.status().is_success() {
            return Err("OpenAI rejected the connection test. Replace the API key and try again.");
        }
        Ok(())
    })
    .await
    .map_err(|_| "The OpenAI connection test could not finish.")?
}

#[tauri::command]
pub fn list_patient_documents(
    state: State<'_, PrivacyState>,
    patient_id: i64,
) -> PrivacyResult<Vec<DocumentSummary>> {
    state.storage()?.documents(patient_id)
}

#[tauri::command]
pub fn list_documents(state: State<'_, PrivacyState>) -> PrivacyResult<Vec<DocumentSummary>> {
    state.storage()?.all_documents()
}

#[tauri::command]
pub fn patient_document(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<PatientDocument> {
    state.storage()?.patient_document(id)
}

#[tauri::command]
pub fn save_patient_document(
    state: State<'_, PrivacyState>,
    id: Option<i64>,
    patient_id: i64,
    title: String,
    template_id: i64,
    body: DocumentBody,
    reviewed: bool,
    include_signature: bool,
    source_note_ids: Vec<i64>,
) -> PrivacyResult<PatientDocument> {
    state.storage()?.save_document(
        id,
        patient_id,
        &title,
        template_id,
        &body,
        reviewed,
        include_signature,
        &source_note_ids,
    )
}

#[tauri::command]
pub fn update_patient_document(
    state: State<'_, PrivacyState>,
    id: i64,
    title: String,
    body: DocumentBody,
    reviewed: bool,
    include_signature: bool,
) -> PrivacyResult<PatientDocument> {
    state
        .storage()?
        .update_document(id, &title, &body, reviewed, include_signature)
}

#[tauri::command]
pub fn delete_patient_document(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<()> {
    state.storage()?.delete_document(id)
}

#[tauri::command]
pub async fn export_patient_document_pdf(
    state: State<'_, PrivacyState>,
    id: i64,
) -> PrivacyResult<bool> {
    let export = state.storage()?.document_export(id)?;
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Export patient document")
        .set_file_name(format!("document-{id}.pdf"))
        .add_filter("PDF document", &["pdf"])
        .save_file()
        .await;
    let Some(chosen) = chosen else {
        return Ok(false);
    };
    let path = chosen.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = documents::export_pdf::render(&export)?;
        std::fs::write(path, bytes)
            .map_err(|_| "The PDF could not be saved. Choose another location and try again.")?;
        Ok(true)
    })
    .await
    .map_err(|_| "The PDF export could not finish. Try again.")?
}

#[tauri::command]
pub fn prepare_document_submission(
    state: State<'_, PrivacyState>,
    patient_id: i64,
    template_id: i64,
    note_ids: Vec<i64>,
    model: String,
    title: String,
    custom_instructions: String,
    document_id: Option<i64>,
) -> PrivacyResult<PreparedSubmissionView> {
    let review = state.storage()?.prepare_document_submission(
        patient_id,
        template_id,
        &note_ids,
        &model,
        &title,
        &custom_instructions,
        document_id,
    )?;
    let prepared = review.prepared;
    Ok(PreparedSubmissionView {
        document_id: review.document_id,
        estimate: estimate(
            &document_model(&prepared.model)?,
            &prepared.instructions,
            &prepared.input,
        ),
        id: prepared.id,
        model: prepared.model,
        destination: prepared.destination,
        purpose: prepared.purpose,
        instructions: prepared.instructions,
        input: prepared.input,
        payload_digest: prepared.payload_digest,
        source_count: prepared.source_revisions.len(),
        review_notes: review
            .notes
            .into_iter()
            .map(|note| SubmissionReviewNoteView {
                id: note.id,
                title: note.title,
                reviewed_text: note.reviewed_text,
                created_at: note.created_at,
            })
            .collect(),
    })
}

#[tauri::command]
pub fn document_usage(
    state: State<'_, PrivacyState>,
    from: Option<i64>,
    until: Option<i64>,
    document_id: Option<i64>,
) -> PrivacyResult<UsageSummary> {
    state.storage()?.document_usage(from, until, document_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedDocument {
    document_id: i64,
    #[serde(flatten)]
    restored: RestoredDocument,
    usage: UsageSummary,
}

#[tauri::command]
pub async fn submit_document_generation(
    state: State<'_, PrivacyState>,
    operation: u64,
    preparation_id: String,
) -> PrivacyResult<GeneratedDocument> {
    let op = state.begin(operation)?;
    // Missing credentials do not consume approval or count as an API attempt.
    let key = load_openai_key()?;
    let prepared = op
        .state
        .storage()?
        .consume_prepared_submission(&preparation_id)?;
    let document_id = state.storage()?.prepared_document_id(&preparation_id)?;
    let restoration = prepared.restorations.clone();
    let audit = prepared.clone();
    let response =
        tauri::async_runtime::spawn_blocking(move || send_openai(&op, &prepared, &key)).await;
    let (result, usage) = response.unwrap_or((
        Err("OpenAI did not return a document. Prepare and send a new submission."),
        None,
    ));
    state.storage()?.finish_document_attempt(
        &preparation_id,
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
        usage.as_ref(),
    )?;
    state.storage()?.record_submission_outcome(
        &audit,
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
    )?;
    Ok(GeneratedDocument {
        document_id,
        restored: restore_response(&result?, &restoration),
        usage: state
            .storage()?
            .document_usage(None, None, Some(document_id))?,
    })
}

fn send_openai(
    op: &Operation,
    prepared: &PreparedSubmission,
    key: &[u8],
) -> (PrivacyResult<String>, Option<TokenUsage>) {
    let fail = |message| (Err(message), None);
    if op.cancel.load(Ordering::Relaxed) {
        return fail(
            "The OpenAI submission was cancelled. Review and prepare a new submission to retry.",
        );
    }
    if prepared.destination != clinicians_veil_core::document_generation::OPENAI_ORIGIN {
        return fail("The configured OpenAI destination is not allowed.");
    }
    let key = match std::str::from_utf8(key) {
        Ok(key) => key,
        Err(_) => return fail("The OpenAI API key in Keychain is unavailable."),
    };
    let client = match reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(90))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return fail("OpenAI is unavailable. Prepare and send a new submission to retry.")
        }
    };
    let mut payload = serde_json::json!({
        "model": prepared.model,
        "instructions": prepared.instructions,
        "input": prepared.input,
        "store": false,
        "background": false,
        "tools": [],
        "tool_choice": "none",
        "truncation": "disabled",
        "service_tier": "default",
        "max_output_tokens": MAX_OUTPUT_TOKENS
    });
    if let Some(effort) = document_model(&prepared.model)
        .ok()
        .and_then(|model| model.reasoning_effort)
    {
        payload["reasoning"] = serde_json::json!({ "effort": effort });
    }
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&payload)
        .send();
    let mut response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) if response.status().is_redirection() => {
            return fail("OpenAI redirected the request, so nothing was followed. Review the configured destination.")
        }
        Ok(_) => return fail("OpenAI did not return a document. Prepare and send a new submission to retry."),
        Err(_) => return fail("OpenAI could not be reached. Prepare and send a new submission to retry."),
    };
    let mut bytes = Vec::new();
    if response
        .by_ref()
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > 2 * 1024 * 1024
    {
        return fail(
            "The OpenAI response was too large. Prepare and send a new submission to retry.",
        );
    }
    let body: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => return fail(
            "OpenAI returned an unreadable document. Prepare and send a new submission to retry.",
        ),
    };
    document_response(&body, &prepared.model, op.cancel.load(Ordering::Relaxed))
}

fn document_response(
    body: &serde_json::Value,
    model: &str,
    cancelled: bool,
) -> (PrivacyResult<String>, Option<TokenUsage>) {
    let usage = if body.get("model").and_then(serde_json::Value::as_str) == Some(model)
        && body
            .get("service_tier")
            .and_then(serde_json::Value::as_str)
            .is_none_or(|tier| tier == "default")
    {
        TokenUsage::from_response(&body)
    } else {
        None
    };
    if cancelled {
        return (Err("The OpenAI submission was cancelled. Review and prepare a new submission to retry."), usage);
    }
    if body.get("status").and_then(serde_json::Value::as_str) != Some("completed") {
        return (
            Err(
                "OpenAI did not complete the document. Prepare and send a new submission to retry.",
            ),
            usage,
        );
    }
    let text = body
        .get("output")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("content").and_then(serde_json::Value::as_array))
        .flatten()
        .filter(|content| {
            content.get("type").and_then(serde_json::Value::as_str) == Some("output_text")
        })
        .filter_map(|content| content.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return (
            Err("OpenAI returned no document text. Prepare and send a new submission to retry."),
            usage,
        );
    }
    (Ok(text), usage)
}

fn reviewed_output(inner: &Inner, session_id: u64, revision: u64) -> PrivacyResult<String> {
    if inner.active.is_some() {
        return Err("Wait for processing to finish.");
    }
    let session = inner.session.as_ref().ok_or("Start a new review.")?;
    session.matches(session_id, revision)?;
    session.copy_text()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> PrivacyState {
        PrivacyState {
            inner: Arc::new(Mutex::new(Inner {
                session: Some(Session::new(1, "Synthetic note.".into(), vec![]).unwrap()),
                ..Inner::default()
            })),
            root: PathBuf::from("/nonexistent/veil-test"),
            storage: None,
        }
    }
    #[test]
    fn incomplete_and_cancelled_responses_keep_billable_usage() {
        let model = clinicians_veil_core::document_usage::DEFAULT_DOCUMENT_MODEL;
        let mut body = serde_json::json!({"model": model, "status": "incomplete", "service_tier": "default",
            "usage": {"input_tokens": 100, "input_tokens_details": {"cached_tokens": 20}, "output_tokens": 50},
            "output": [{"content": [{"type": "output_text", "text": "Synthetic partial draft"}]}]});
        let (result, usage) = document_response(&body, model, false);
        assert!(result.is_err());
        assert_eq!(usage.unwrap().output_tokens, 50);
        body["status"] = "completed".into();
        let (result, usage) = document_response(&body, model, true);
        assert!(result.is_err());
        assert!(usage.is_some());
        let (result, usage) = document_response(&body, model, false);
        assert_eq!(result.unwrap(), "Synthetic partial draft");
        assert!(usage.is_some());
    }

    #[test]
    fn unexpected_model_or_service_tier_leaves_cost_unknown() {
        let model = clinicians_veil_core::document_usage::DEFAULT_DOCUMENT_MODEL;
        let mut body = serde_json::json!({"model": model, "status": "completed", "service_tier": "priority",
            "usage": {"input_tokens": 100, "input_tokens_details": {"cached_tokens": 0}, "output_tokens": 50},
            "output": [{"content": [{"type": "output_text", "text": "Synthetic draft"}]}]});
        assert!(document_response(&body, model, false).1.is_none());
        body["service_tier"] = "default".into();
        body["model"] = "unrecognised-model".into();
        assert!(document_response(&body, model, false).1.is_none());
    }

    #[test]
    fn operations_are_exclusive_and_release_their_guard_on_failure() {
        let state = state();
        let op = state.begin(1).unwrap();
        assert!(state.begin(2).is_err());
        assert!(change(&state, 1, 0, |_| Ok(())).is_err());
        assert!(reviewed_output(&state.lock().unwrap(), 1, 0).is_err());
        drop(op);
        assert!(state.begin(2).is_ok());
    }
    #[test]
    fn discard_cancels_work_and_drops_the_session_without_allowing_parallel_work() {
        let state = state();
        let op = state.begin(1).unwrap();
        state.discard().unwrap();
        assert!(op.cancel.load(Ordering::Relaxed));
        assert!(state.lock().unwrap().session.is_none());
        assert!(state.begin(2).is_err());
        drop(op);
        assert!(state.begin(2).is_ok());
    }
    #[test]
    fn native_copy_gate_rejects_unchecked_stale_and_missing_sessions() {
        let state = state();
        assert!(reviewed_output(&state.lock().unwrap(), 1, 0).is_err());
        change(&state, 1, 0, |s| s.finish_scan(vec![])).unwrap();
        assert!(reviewed_output(&state.lock().unwrap(), 1, 0).is_err());
        assert_eq!(
            reviewed_output(&state.lock().unwrap(), 1, 1).unwrap(),
            "Synthetic note."
        );
        assert!(change(&state, 1, 0, |s| s.manual(0, 9)).is_err());
        change(&state, 1, 1, |s| s.manual(0, 9)).unwrap();
        assert!(reviewed_output(&state.lock().unwrap(), 1, 2).is_err());
        state.discard().unwrap();
        assert!(reviewed_output(&state.lock().unwrap(), 1, 2).is_err());
    }
}

fn validate_import(
    inner: &Inner,
    id: Option<u64>,
    patient: Option<i64>,
    acknowledged: bool,
) -> PrivacyResult<()> {
    match (&inner.import, id) {
        (None, None) => Ok(()),
        (Some(import), Some(id)) if import.id == id && Some(import.patient_id) == patient => {
            if !import.extracted.warnings.is_empty() && !acknowledged {
                Err("Check the extraction warnings before finding identifiers.")
            } else {
                Ok(())
            }
        }
        _ => Err("This document belongs to another session. Choose the document again."),
    }
}

#[tauri::command]
pub async fn import_document(
    app: AppHandle,
    state: State<'_, PrivacyState>,
    operation: u64,
    patient_id: i64,
) -> PrivacyResult<Option<ImportView>> {
    state.storage()?.patient(patient_id)?;
    let op = state.begin(operation)?;
    if state.lock()?.session.is_some() {
        return Err("Discard the current review before importing a document.");
    }
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Choose a document")
        .add_filter("Documents", &["txt", "docx", "pdf"])
        .pick_file()
        .await;
    documents::cancelled(&op.cancel)?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        progress(&app, op.id, "Extracting document text", 0, 0);
        let original = Arc::new(documents::read(&path, &op.cancel)?);
        let extracted = documents::extract(&original, &op.cancel, |done, total| {
            progress(
                &app,
                op.id,
                "Extracting document text",
                done as u64,
                total as u64,
            )
        })?;
        let mut inner = op.state.lock()?;
        documents::cancelled(&op.cancel)?;
        inner.next_session += 1;
        let id = inner.next_session;
        let view = ImportView {
            id,
            document: original.metadata.clone(),
            extracted: extracted.clone(),
        };
        inner.import = Some(ImportedDocument {
            id,
            patient_id,
            original,
            extracted,
        });
        inner.preview = None;
        Ok(Some(view))
    })
    .await
    .map_err(|_| "The document could not be imported. Choose it again.")?
}

#[tauri::command]
pub fn release_import(state: State<'_, PrivacyState>, id: u64) -> PrivacyResult<()> {
    let mut inner = state.lock()?;
    if inner.active.is_some() || inner.session.is_some() {
        return Err("Discard the review before releasing this document.");
    }
    if inner.import.as_ref().is_some_and(|import| import.id == id) {
        inner.import = None;
        inner.preview = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_document_preview(
    app: AppHandle,
    state: State<'_, PrivacyState>,
    operation: u64,
    note_id: Option<i64>,
    import_id: Option<u64>,
) -> PrivacyResult<PreviewView> {
    let op = state.begin(operation)?;
    // Saved-note IDs and import handles are separate namespaces; accept exactly one.
    let original = match (note_id, import_id) {
        (Some(id), None) => Arc::new(state.storage()?.document(id)?),
        (None, Some(id)) => state
            .lock()?
            .import
            .as_ref()
            .filter(|import| import.id == id)
            .map(|import| import.original.clone())
            .ok_or("This imported document is no longer available.")?,
        _ => return Err("Choose an original document to preview."),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let extracted = documents::extract(&original, &op.cancel, |done, total| {
            progress(
                &app,
                op.id,
                "Opening original document",
                done as u64,
                total as u64,
            )
        })?;
        let mut inner = op.state.lock()?;
        documents::cancelled(&op.cancel)?;
        inner.next_session += 1;
        let id = inner.next_session;
        let view = PreviewView {
            id,
            document: original.metadata.clone(),
            extracted,
        };
        inner.preview = Some(DocumentPreview { id, original });
        Ok(view)
    })
    .await
    .map_err(|_| "The original document could not be previewed.")?
}

#[tauri::command]
pub async fn document_preview_page(
    state: State<'_, PrivacyState>,
    operation: u64,
    id: u64,
    page: usize,
    width: usize,
) -> PrivacyResult<String> {
    let op = state.begin(operation)?;
    let original = state
        .lock()?
        .preview
        .as_ref()
        .filter(|preview| preview.id == id)
        .map(|preview| preview.original.clone())
        .ok_or("This preview is no longer available.")?;
    if original.metadata.format != DocumentFormat::Pdf {
        return Err("This document is not a PDF.");
    }
    tauri::async_runtime::spawn_blocking(move || {
        documents::cancelled(&op.cancel)?;
        let image = documents::render_page(&original.bytes, page, width)?;
        documents::cancelled(&op.cancel)?;
        if !op
            .state
            .lock()?
            .preview
            .as_ref()
            .is_some_and(|preview| preview.id == id)
        {
            return Err("This preview is no longer available.");
        }
        Ok(image)
    })
    .await
    .map_err(|_| "This PDF page could not be displayed.")?
}

#[tauri::command]
pub fn close_document_preview(state: State<'_, PrivacyState>, id: u64) -> PrivacyResult<()> {
    let mut inner = state.lock()?;
    if inner
        .preview
        .as_ref()
        .is_some_and(|preview| preview.id == id)
    {
        inner.preview = None;
    }
    Ok(())
}

#[cfg(test)]
mod document_session_tests {
    use super::*;
    fn imported() -> ImportedDocument {
        ImportedDocument {
            id: 12,
            patient_id: 7,
            original: Arc::new(OriginalDocument {
                metadata: DocumentMetadata {
                    name: "synthetic.txt".into(),
                    format: DocumentFormat::Txt,
                    byte_length: 4,
                },
                bytes: b"text".to_vec(),
            }),
            extracted: ExtractedDocument {
                text: "text".into(),
                blocks: vec![],
                warnings: vec!["Check extraction".into()],
                page_count: None,
            },
        }
    }
    #[test]
    fn imported_files_are_bound_to_patient_handle_and_warning_acknowledgement() {
        let inner = Inner {
            import: Some(imported()),
            ..Inner::default()
        };
        assert!(validate_import(&inner, Some(12), Some(7), true).is_ok());
        assert!(validate_import(&inner, Some(12), Some(7), false).is_err());
        assert!(validate_import(&inner, Some(12), Some(8), true).is_err());
        assert!(validate_import(&inner, Some(13), Some(7), true).is_err());
        assert!(validate_import(&inner, None, Some(7), true).is_err());
        assert!(validate_import(&Inner::default(), Some(12), Some(7), true).is_err());
    }
    #[test]
    fn discard_drops_original_and_preview_and_cancels_pending_results() {
        let state = PrivacyState {
            inner: Arc::new(Mutex::new(Inner::default())),
            root: PathBuf::new(),
            storage: None,
        };
        let import = imported();
        let weak = Arc::downgrade(&import.original);
        {
            let mut inner = state.lock().unwrap();
            inner.preview = Some(DocumentPreview {
                id: 13,
                original: import.original.clone(),
            });
            inner.import = Some(import);
        }
        let op = state.begin(1).unwrap();
        state.discard().unwrap();
        assert!(weak.upgrade().is_none());
        assert!(op.cancel.load(Ordering::Relaxed));
        assert!(state.lock().unwrap().preview.is_none());
        drop(op);
        assert!(state.lock().unwrap().active.is_none());
    }
}
