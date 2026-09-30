use super::{segmenter::Action, DictationResult, SAMPLE_RATE};
use std::{
    collections::VecDeque,
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError},
};

#[derive(Clone, Debug, PartialEq)]
pub enum Job {
    Provisional {
        utterance: u64,
        audio: Arc<[f32]>,
    },
    Final {
        utterance: u64,
        audio: Arc<[f32]>,
        start_ms: u64,
        end_ms: u64,
    },
}

impl Job {
    pub fn audio(&self) -> &[f32] {
        match self {
            Self::Provisional { audio, .. } | Self::Final { audio, .. } => audio,
        }
    }
}

#[derive(Default)]
struct Inner {
    finals: VecDeque<Job>,
    provisional: Option<Job>,
    pending: usize,
    closed: bool,
}

/// Recognition work between the listening and recognising threads.
///
/// Final utterances are never dropped and are always served first. Only the latest provisional
/// snapshot is kept. Queued final audio is bounded so a slow model cannot grow memory unchecked.
pub struct Jobs {
    inner: Mutex<Inner>,
    ready: Condvar,
    max_pending: usize,
}

impl Jobs {
    pub fn new(max_pending_ms: u32) -> Self {
        Self {
            inner: Mutex::default(),
            ready: Condvar::new(),
            max_pending: max_pending_ms as usize * SAMPLE_RATE as usize / 1_000,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Queues recognition for a segmenter action. Fails when final audio is backing up.
    pub fn offer(&self, action: &Action) -> DictationResult<()> {
        let mut inner = self.lock();
        if inner.closed {
            return Ok(());
        }
        match action {
            Action::Provisional { utterance, audio } => {
                inner.provisional = Some(Job::Provisional {
                    utterance: *utterance,
                    audio: audio.clone(),
                });
            }
            Action::Final {
                utterance,
                audio,
                start_ms,
                end_ms,
            } => {
                if inner.pending + audio.len() > self.max_pending {
                    return Err("Transcription fell behind, so dictation stopped.");
                }
                inner.pending += audio.len();
                if matches!(&inner.provisional, Some(Job::Provisional { utterance: u, .. }) if u == utterance)
                {
                    inner.provisional = None;
                }
                inner.finals.push_back(Job::Final {
                    utterance: *utterance,
                    audio: audio.clone(),
                    start_ms: *start_ms,
                    end_ms: *end_ms,
                });
            }
            Action::SpeechStarted | Action::LimitReached => return Ok(()),
        }
        self.ready.notify_one();
        Ok(())
    }

    /// Blocks until work is available. Returns `None` once closed and every final is served.
    pub fn next(&self) -> Option<Job> {
        let mut inner = self.lock();
        loop {
            if let Some(job) = inner.finals.pop_front() {
                inner.pending -= job.audio().len();
                return Some(job);
            }
            if inner.closed {
                inner.provisional = None;
                return None;
            }
            if let Some(job) = inner.provisional.take() {
                return Some(job);
            }
            inner = self
                .ready
                .wait(inner)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    /// No more audio will arrive: serve the queued finals, then stop.
    pub fn close(&self) {
        self.lock().closed = true;
        self.ready.notify_all();
    }

    /// Drops all queued audio and stops.
    pub fn cancel(&self) {
        let mut inner = self.lock();
        inner.finals.clear();
        inner.provisional = None;
        inner.pending = 0;
        inner.closed = true;
        drop(inner);
        self.ready.notify_all();
    }
}
