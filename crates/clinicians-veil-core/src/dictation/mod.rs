//! Push-to-talk dictation: voice-activity segmentation, recognition jobs and transcript clean-up.
//!
//! Audio is 16 kHz mono `f32`. It exists only in memory and is dropped as soon as an utterance is
//! transcribed or the recording is cancelled. The speech engine, voice-activity model and
//! microphone are adapter concerns behind [`VoiceActivity`] and [`Recogniser`].
mod audio;
mod jobs;
mod listener;
mod resample;
mod segmenter;
mod transcript;

pub use audio::{downmix, level};
pub use jobs::{Job, Jobs};
pub use listener::Listener;
pub use resample::Resampler;
pub use segmenter::{Action, Policy, Segmenter};
pub use transcript::{clean, recognise, RecognisedSegment, Transcribed, Transcript};

use crate::privacy::PrivacyResult;
use std::sync::atomic::AtomicBool;

pub const SAMPLE_RATE: u32 = 16_000;
/// One voice-activity frame: 32 ms at 16 kHz.
pub const FRAME: usize = 512;

pub type DictationResult<T> = PrivacyResult<T>;

/// Returns one speech probability in `0..=1` for each complete [`FRAME`] in `samples`.
pub trait VoiceActivity {
    fn probabilities(&mut self, samples: &[f32]) -> DictationResult<Vec<f32>>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pass {
    /// A cheap interim pass over an utterance that is still being spoken.
    Provisional,
    /// The authoritative pass over a completed utterance.
    Final,
}

pub trait Recogniser {
    fn transcribe(
        &mut self,
        audio: &[f32],
        pass: Pass,
        cancel: &AtomicBool,
    ) -> DictationResult<Vec<RecognisedSegment>>;
}

pub fn milliseconds(samples: usize) -> u64 {
    samples as u64 * 1_000 / SAMPLE_RATE as u64
}
