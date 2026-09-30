//! Local dictation adapter: microphone capture, Silero voice activity and Whisper transcription.
//!
//! Audio stays in memory and is dropped as each utterance is transcribed. Nothing here logs,
//! writes audio to disk or opens a network connection; model files arrive only through
//! [`assets::install`].
pub mod assets;
mod capture;
mod engine;
pub mod microphone;
mod vad;
mod whisper;

pub use engine::{replay, start, Event, Loader, Session, Sink};
pub use vad::SileroVad;
pub use whisper::{load, Model, WhisperRecogniser};
