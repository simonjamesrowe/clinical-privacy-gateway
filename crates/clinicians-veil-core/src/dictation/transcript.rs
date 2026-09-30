use super::{jobs::Job, DictationResult, Jobs, Pass, Recogniser};
use crate::privacy::MAX_CHARACTERS;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

/// One decoded segment as reported by the speech engine.
#[derive(Clone, Debug, PartialEq)]
pub struct RecognisedSegment {
    pub text: String,
    /// The engine's probability that the segment contains no speech.
    pub no_speech: f32,
}

/// Whole-utterance outputs Whisper is known to produce from noise. Compared case-folded,
/// ignoring punctuation. Genuine dictation containing these words alongside others is kept.
const HALLUCINATIONS: [&str; 6] = [
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "like and subscribe",
    "subtitles by the amaraorg community",
    "subtitles by the amara org community",
];

const NO_SPEECH_LIMIT: f32 = 0.6;

/// Joins recognised segments into one line of text, dropping likely non-speech output.
///
/// Iterates characters only, so its cost is linear in the input and it has no regex.
pub fn clean(segments: &[RecognisedSegment]) -> Option<String> {
    let mut text = String::new();
    for segment in segments {
        if segment.no_speech > NO_SPEECH_LIMIT || non_speech(&segment.text) {
            continue;
        }
        for word in segment.text.split_whitespace() {
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(word);
        }
    }
    if text.is_empty() || hallucination(&text) {
        None
    } else {
        Some(text)
    }
}

/// A bracketed tag such as `[BLANK_AUDIO]` or `(silence)`, or text with no letters or digits.
fn non_speech(text: &str) -> bool {
    let text = text.trim();
    let bracketed = (text.starts_with('[') && text.ends_with(']'))
        || (text.starts_with('(') && text.ends_with(')'));
    bracketed || !text.chars().any(char::is_alphanumeric)
}

fn hallucination(text: &str) -> bool {
    let mut folded = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_alphanumeric() {
            folded.extend(c.to_lowercase());
        } else if c.is_whitespace() && !folded.ends_with(' ') {
            folded.push(' ');
        }
    }
    let folded = folded.trim();
    HALLUCINATIONS.contains(&folded)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Transcribed {
    #[serde(rename_all = "camelCase")]
    Provisional { utterance: u64, text: String },
    #[serde(rename_all = "camelCase")]
    Final {
        utterance: u64,
        text: String,
        start_ms: u64,
        end_ms: u64,
    },
}

/// Orders recognition results and bounds the text produced by one recording.
pub struct Transcript {
    last_final: u64,
    characters: usize,
}

impl Default for Transcript {
    fn default() -> Self {
        Self::new()
    }
}

impl Transcript {
    pub fn new() -> Self {
        Self {
            last_final: 0,
            characters: 0,
        }
    }

    pub fn accept(
        &mut self,
        job: &Job,
        segments: &[RecognisedSegment],
    ) -> DictationResult<Option<Transcribed>> {
        match job {
            Job::Provisional { utterance, .. } => Ok((*utterance > self.last_final)
                .then(|| clean(segments))
                .flatten()
                .map(|text| Transcribed::Provisional {
                    utterance: *utterance,
                    text,
                })),
            Job::Final {
                utterance,
                start_ms,
                end_ms,
                ..
            } => {
                self.last_final = self.last_final.max(*utterance);
                let Some(text) = clean(segments) else {
                    return Ok(None);
                };
                self.characters += text.chars().count() + 1;
                if self.characters > MAX_CHARACTERS {
                    return Err("This dictation reached the maximum note length.");
                }
                Ok(Some(Transcribed::Final {
                    utterance: *utterance,
                    text,
                    start_ms: *start_ms,
                    end_ms: *end_ms,
                }))
            }
        }
    }
}

/// Serves recognition jobs until the queue closes, reporting each accepted result.
pub fn recognise<R: Recogniser>(
    jobs: &Jobs,
    recogniser: &mut R,
    cancel: &AtomicBool,
    mut report: impl FnMut(Transcribed),
) -> DictationResult<()> {
    let mut transcript = Transcript::new();
    while let Some(job) = jobs.next() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Operation cancelled.");
        }
        let pass = match job {
            Job::Provisional { .. } => Pass::Provisional,
            Job::Final { .. } => Pass::Final,
        };
        let segments = recogniser.transcribe(job.audio(), pass, cancel)?;
        if let Some(result) = transcript.accept(&job, &segments)? {
            report(result);
        }
    }
    Ok(())
}
