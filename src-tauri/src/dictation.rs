//! Push-to-talk dictation commands. Audio never crosses the IPC boundary; the view that starts
//! a recording receives its level, provisional and final text on a per-recording channel.
use crate::privacy::{progress, PrivacyState};
use clinicians_veil_asr::{assets, load, microphone, Event, Loader, Model, Session, Sink};
use clinicians_veil_core::{dictation::Transcribed, privacy::PrivacyResult};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tauri::{async_runtime::JoinHandle, ipc::Channel, AppHandle, State};

/// Keep Whisper resident this long after a recording so the next hold starts quickly.
const IDLE_UNLOAD: Duration = Duration::from_secs(90);
const MICROPHONE_OFF: &str =
    "Microphone access is off. Allow Clinician’s Veil in System Settings › Privacy & Security › Microphone.";

#[derive(Clone)]
pub struct DictationState {
    root: PathBuf,
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    model: Option<Arc<Model>>,
    /// The recording that owns the microphone, reserved before its threads start.
    current: Option<u64>,
    session: Option<Session>,
    next: u64,
    /// Bumped whenever residency changes so a superseded idle timer cannot unload a model.
    generation: u64,
    idle: Option<JoinHandle<()>>,
}

impl Inner {
    fn cancel_idle(&mut self) {
        self.generation += 1;
        if let Some(timer) = self.idle.take() {
            timer.abort();
        }
    }
}

impl DictationState {
    pub fn new(root: PathBuf) -> Self {
        assets::cleanup(&root);
        Self {
            root,
            inner: Arc::default(),
        }
    }

    fn lock(&self) -> PrivacyResult<MutexGuard<'_, Inner>> {
        lock(&self.inner)
    }

    /// Drops a resident Whisper model before the entity model loads.
    pub fn release_model(&self) -> PrivacyResult<()> {
        let mut inner = self.lock()?;
        if inner.current.is_some() {
            return Err("Stop dictation before finding identifiers.");
        }
        inner.cancel_idle();
        inner.model = None;
        Ok(())
    }

    /// Cancels any recording, waits for its threads and releases the model (app teardown).
    pub fn discard(&self) -> PrivacyResult<()> {
        let session = {
            let mut inner = self.lock()?;
            inner.cancel_idle();
            inner.model = None;
            inner.current = None;
            inner.session.take()
        };
        if let Some(session) = session {
            session.cancel();
            session.join();
        }
        Ok(())
    }
}

fn lock(inner: &Mutex<Inner>) -> PrivacyResult<MutexGuard<'_, Inner>> {
    inner
        .lock()
        .map_err(|_| "Dictation is unavailable. Restart the app.")
}

/// Ends a recording's ownership of the microphone and schedules the idle unload.
fn finished(inner: &Arc<Mutex<Inner>>, session: u64) {
    let Ok(mut guard) = lock(inner) else {
        return;
    };
    if guard.current != Some(session) {
        return;
    }
    guard.current = None;
    // The terminal event is sent from the recording's last thread; dropping its handle detaches it.
    guard.session = None;
    guard.cancel_idle();
    let generation = guard.generation;
    let slot = inner.clone();
    guard.idle = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_UNLOAD).await;
        if let Ok(mut inner) = lock(&slot) {
            if inner.generation == generation && inner.current.is_none() {
                inner.model = None;
                inner.idle = None;
            }
        }
    }));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStatus {
    installed: bool,
    name: &'static str,
    bytes: u64,
    revision: &'static str,
    microphone: &'static str,
}

fn microphone_label(access: microphone::Access) -> &'static str {
    match access {
        microphone::Access::Authorized => "authorized",
        microphone::Access::Denied => "denied",
        microphone::Access::Restricted => "restricted",
        microphone::Access::NotDetermined => "notDetermined",
    }
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DictationEvent {
    State {
        session: u64,
        state: &'static str,
    },
    Level {
        session: u64,
        level: f32,
        speaking: bool,
    },
    Provisional {
        session: u64,
        utterance: u64,
        text: String,
    },
    Final {
        session: u64,
        utterance: u64,
        text: String,
        start_ms: u64,
        end_ms: u64,
    },
    Finished {
        session: u64,
    },
    Cancelled {
        session: u64,
    },
    Failed {
        session: u64,
        message: &'static str,
    },
}

fn view(session: u64, event: Event) -> DictationEvent {
    let state = |state| DictationEvent::State { session, state };
    match event {
        Event::Listening => state("listening"),
        Event::LoadingModel => state("loadingModel"),
        Event::ModelReady => state("ready"),
        Event::LimitReached => state("limitReached"),
        Event::Level { level, speaking } => DictationEvent::Level {
            session,
            level,
            speaking,
        },
        Event::Transcribed(Transcribed::Provisional { utterance, text }) => {
            DictationEvent::Provisional {
                session,
                utterance,
                text,
            }
        }
        Event::Transcribed(Transcribed::Final {
            utterance,
            text,
            start_ms,
            end_ms,
        }) => DictationEvent::Final {
            session,
            utterance,
            text,
            start_ms,
            end_ms,
        },
        Event::Finished => DictationEvent::Finished { session },
        Event::Cancelled => DictationEvent::Cancelled { session },
        Event::Failed(message) => DictationEvent::Failed { session, message },
    }
}

fn terminal(event: &Event) -> bool {
    matches!(event, Event::Finished | Event::Cancelled | Event::Failed(_))
}

#[tauri::command]
pub async fn dictation_status(state: State<'_, DictationState>) -> PrivacyResult<DictationStatus> {
    let root = state.root.clone();
    tauri::async_runtime::spawn_blocking(move || DictationStatus {
        // Hashing ~575 MB on every workspace mount is too slow; `load` verifies before use.
        installed: assets::present(&root),
        name: assets::MODEL_ID,
        bytes: assets::DOWNLOAD_BYTES,
        revision: assets::REVISION,
        microphone: microphone_label(microphone::access()),
    })
    .await
    .map_err(|_| "Dictation status is unavailable.")
}

#[tauri::command]
pub async fn install_dictation_model(
    app: AppHandle,
    state: State<'_, DictationState>,
    privacy: State<'_, PrivacyState>,
    operation: u64,
) -> PrivacyResult<()> {
    let op = privacy.begin(operation)?;
    let root = state.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        assets::install(&root, &op.cancel, |done, total| {
            progress(&app, op.id, "Downloading speech model", done, total)
        })
    })
    .await
    .map_err(|_| "Speech model installation could not finish.")?
}

#[tauri::command]
pub fn remove_dictation_model(
    state: State<'_, DictationState>,
    privacy: State<'_, PrivacyState>,
) -> PrivacyResult<()> {
    if privacy.busy()? {
        return Err("Wait for processing to finish.");
    }
    {
        let mut inner = state.lock()?;
        if inner.current.is_some() {
            return Err("Stop dictation before removing the speech model.");
        }
        inner.cancel_idle();
        inner.model = None;
    }
    assets::remove(&state.root)
}

#[tauri::command]
pub async fn start_dictation(
    state: State<'_, DictationState>,
    privacy: State<'_, PrivacyState>,
    events: Channel<DictationEvent>,
) -> PrivacyResult<u64> {
    if privacy.busy()? {
        return Err("Wait for the current operation to finish.");
    }
    let id = {
        let mut inner = state.lock()?;
        if inner.current.is_some() {
            return Err("Dictation is already running.");
        }
        inner.next += 1;
        inner.current = Some(inner.next);
        inner.cancel_idle();
        inner.next
    };
    let result = begin(&state, id, events).await;
    let mut inner = state.lock()?;
    match result {
        Ok(session) if inner.current == Some(id) => {
            inner.session = Some(session);
            Ok(id)
        }
        // A cancel or teardown arrived while the microphone was opening.
        Ok(session) => {
            drop(inner);
            session.cancel();
            Err("Dictation was cancelled.")
        }
        Err(message) => {
            if inner.current == Some(id) {
                inner.current = None;
            }
            Err(message)
        }
    }
}

async fn begin(
    state: &DictationState,
    id: u64,
    events: Channel<DictationEvent>,
) -> PrivacyResult<Session> {
    let access = match microphone::access() {
        microphone::Access::NotDetermined => {
            if tauri::async_runtime::spawn_blocking(microphone::request)
                .await
                .unwrap_or(false)
            {
                microphone::Access::Authorized
            } else {
                microphone::Access::Denied
            }
        }
        access => access,
    };
    if access != microphone::Access::Authorized {
        return Err(MICROPHONE_OFF);
    }
    let root = state.root.clone();
    let slot = state.inner.clone();
    let sink: Sink = {
        let slot = slot.clone();
        Arc::new(move |event: Event| {
            let done = terminal(&event);
            let _ = events.send(view(id, event));
            if done {
                finished(&slot, id);
            }
        })
    };
    let loader: Loader = {
        let root = root.clone();
        Box::new(move |report: &dyn Fn(Event)| {
            if let Some(model) = lock(&slot)?.model.clone() {
                return Ok(model);
            }
            report(Event::LoadingModel);
            let model = Arc::new(load(&root)?);
            let mut inner = lock(&slot)?;
            if inner.current == Some(id) {
                inner.model = Some(model.clone());
            }
            Ok(model)
        })
    };
    tauri::async_runtime::spawn_blocking(move || clinicians_veil_asr::start(&root, loader, sink))
        .await
        .map_err(|_| "Dictation could not start. Try again.")?
}

fn with_session(
    state: &DictationState,
    session: u64,
    action: impl FnOnce(&Session),
) -> PrivacyResult<()> {
    let inner = state.lock()?;
    if inner.current == Some(session) {
        if let Some(handle) = &inner.session {
            action(handle);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn stop_dictation(state: State<'_, DictationState>, session: u64) -> PrivacyResult<()> {
    with_session(&state, session, Session::stop)
}

#[tauri::command]
pub fn cancel_dictation(state: State<'_, DictationState>, session: u64) -> PrivacyResult<()> {
    let mut inner = state.lock()?;
    if inner.current != Some(session) {
        return Ok(());
    }
    match &inner.session {
        Some(handle) => handle.cancel(),
        // Still opening the microphone: `start_dictation` sees this and cancels the new session.
        None => inner.current = None,
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (tempfile::TempDir, DictationState) {
        let root = tempfile::tempdir().unwrap();
        let state = DictationState::new(root.path().into());
        (root, state)
    }

    #[test]
    fn detection_is_refused_while_recording_and_otherwise_releases_residency() {
        let (_root, state) = state();
        state.lock().unwrap().current = Some(7);
        assert_eq!(
            state.release_model(),
            Err("Stop dictation before finding identifiers.")
        );
        state.lock().unwrap().current = None;
        let before = state.lock().unwrap().generation;
        assert_eq!(state.release_model(), Ok(()));
        let inner = state.lock().unwrap();
        assert!(inner.model.is_none());
        assert!(inner.generation > before);
    }

    #[test]
    fn a_finished_recording_releases_the_microphone_and_arms_one_idle_timer() {
        let (_root, state) = state();
        state.lock().unwrap().current = Some(3);
        // Stale sessions cannot clear the current one.
        finished(&state.inner, 2);
        assert_eq!(state.lock().unwrap().current, Some(3));
        finished(&state.inner, 3);
        let generation = {
            let inner = state.lock().unwrap();
            assert_eq!(inner.current, None);
            assert!(inner.idle.is_some());
            inner.generation
        };
        // Starting again supersedes the timer.
        state.lock().unwrap().cancel_idle();
        let inner = state.lock().unwrap();
        assert!(inner.idle.is_none());
        assert!(inner.generation > generation);
    }

    #[test]
    fn events_serialise_without_audio_and_with_camel_case_fields() {
        let event = view(
            4,
            Event::Transcribed(Transcribed::Final {
                utterance: 2,
                text: "Synthetic text.".into(),
                start_ms: 10,
                end_ms: 20,
            }),
        );
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "kind": "final", "session": 4, "utterance": 2,
                "text": "Synthetic text.", "startMs": 10, "endMs": 20
            })
        );
        assert_eq!(
            serde_json::to_value(view(4, Event::Failed("Stopped."))).unwrap(),
            serde_json::json!({"kind": "failed", "session": 4, "message": "Stopped."})
        );
    }
}
