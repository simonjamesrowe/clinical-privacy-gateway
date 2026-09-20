use crate::storage::{MappingView, NoteSummary, NoteView, PatientView, Storage};
use clinicians_veil_core::privacy::{self, Decision, PrivacyResult, Session, SessionView};
use clinicians_veil_ner::{assets, detect};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};
use tauri::{AppHandle, Emitter, State};

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
    fn begin(&self, operation: u64) -> PrivacyResult<Operation> {
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
        inner.patient_id = None;
        inner.note_id = None;
        Ok(())
    }
}

// RAII clears active work even if a worker fails or unwinds.
struct Operation {
    state: PrivacyState,
    cancel: Arc<AtomicBool>,
    id: u64,
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
fn progress(app: &AppHandle, op: u64, stage: &'static str, completed: u64, total: u64) {
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
) -> PrivacyResult<SessionView> {
    privacy::validate_source(&source)?;
    if let Some(patient_id) = patient_id {
        state.storage()?.patient(patient_id)?;
    }
    let library_matches = state.storage()?.matches(&source, patient_id)?;
    let op = state.begin(operation)?;
    let id = {
        let mut inner = state.lock()?;
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
    let inner = state.lock()?;
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
    drop(inner);
    if let Some(note_id) = note_id {
        state.storage()?.update_note(
            note_id,
            patient_id,
            &title,
            &source_text,
            &reviewed_text,
            &provenance,
        )
    } else {
        state.storage()?.save_note(
            patient_id,
            &title,
            None,
            &source_text,
            &reviewed_text,
            &provenance,
        )
    }
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, PrivacyState>,
    query: String,
) -> PrivacyResult<Vec<NoteSummary>> {
    state.storage()?.search_notes(&query)
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
    state.storage()?.delete_note(id)
}

#[tauri::command]
pub fn delete_patient(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<()> {
    state.storage()?.delete_patient(id)
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
pub fn create_mapping(
    state: State<'_, PrivacyState>,
    phrase: String,
    category: privacy::Category,
    replacement: String,
) -> PrivacyResult<MappingView> {
    state
        .storage()?
        .create_mapping(&phrase, category, &replacement)
}

#[tauri::command]
pub fn update_mapping(
    state: State<'_, PrivacyState>,
    id: i64,
    phrase: String,
    category: privacy::Category,
    replacement: String,
) -> PrivacyResult<MappingView> {
    state
        .storage()?
        .update_mapping(id, &phrase, category, &replacement)
}

#[tauri::command]
pub fn delete_mapping(state: State<'_, PrivacyState>, id: i64) -> PrivacyResult<()> {
    state.storage()?.delete_mapping(id)
}

#[tauri::command]
pub fn create_patient_mapping(
    state: State<'_, PrivacyState>,
    patient_id: i64,
    phrase: String,
    category: privacy::Category,
    replacement: String,
) -> PrivacyResult<MappingView> {
    state
        .storage()?
        .create_patient_mapping(patient_id, &phrase, category, &replacement)
}

#[tauri::command]
pub fn update_patient_mapping(
    state: State<'_, PrivacyState>,
    patient_id: i64,
    id: i64,
    phrase: String,
    category: privacy::Category,
    replacement: String,
) -> PrivacyResult<MappingView> {
    state
        .storage()?
        .update_patient_mapping(patient_id, id, &phrase, category, &replacement)
}

#[tauri::command]
pub fn delete_patient_mapping(
    state: State<'_, PrivacyState>,
    patient_id: i64,
    id: i64,
) -> PrivacyResult<()> {
    state.storage()?.delete_patient_mapping(patient_id, id)
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
