use super::{milliseconds, FRAME, SAMPLE_RATE};
use std::{collections::VecDeque, sync::Arc};

/// Voice-activity thresholds and bounds. Durations are milliseconds.
#[derive(Clone, Debug)]
pub struct Policy {
    /// Probability at or above which a frame counts towards starting speech.
    pub start_threshold: f32,
    /// Probability below which a frame counts as trailing silence (hysteresis).
    pub end_threshold: f32,
    pub min_speech_ms: u32,
    pub end_silence_ms: u32,
    pub pre_roll_ms: u32,
    pub post_pad_ms: u32,
    /// Whisper decodes a 30-second window, so longer utterances are split before it.
    pub max_utterance_ms: u32,
    pub split_search_ms: u32,
    pub provisional_every_ms: u32,
    pub min_provisional_ms: u32,
    pub max_session_ms: u32,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            start_threshold: 0.5,
            end_threshold: 0.35,
            min_speech_ms: 250,
            end_silence_ms: 700,
            pre_roll_ms: 300,
            post_pad_ms: 200,
            max_utterance_ms: 28_000,
            split_search_ms: 2_000,
            provisional_every_ms: 1_200,
            min_provisional_ms: 1_000,
            max_session_ms: 600_000,
        }
    }
}

fn frames(ms: u32) -> usize {
    (ms as usize * SAMPLE_RATE as usize / 1_000)
        .div_ceil(FRAME)
        .max(1)
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    SpeechStarted,
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
    /// The recording reached its maximum length; the open utterance has been finalised.
    LimitReached,
}

struct Utterance {
    id: u64,
    /// Offset of the first sample within the recording.
    start: usize,
    audio: Vec<f32>,
    probabilities: Vec<f32>,
    silence: usize,
    since_provisional: usize,
}

/// Turns per-frame speech probabilities into utterances. Silence never becomes a job.
pub struct Segmenter {
    policy: Policy,
    min_speech: usize,
    end_silence: usize,
    post_pad: usize,
    max_utterance: usize,
    split_search: usize,
    provisional_every: usize,
    min_provisional: usize,
    max_session: usize,
    idle: VecDeque<f32>,
    idle_probabilities: VecDeque<f32>,
    idle_capacity: usize,
    run: usize,
    utterance: Option<Utterance>,
    next_id: u64,
    processed: usize,
    limited: bool,
}

impl Segmenter {
    pub fn new(policy: Policy) -> Self {
        let min_speech = frames(policy.min_speech_ms);
        let idle_capacity = frames(policy.pre_roll_ms) + min_speech;
        Self {
            min_speech,
            end_silence: frames(policy.end_silence_ms),
            post_pad: frames(policy.post_pad_ms),
            max_utterance: frames(policy.max_utterance_ms),
            split_search: frames(policy.split_search_ms),
            provisional_every: frames(policy.provisional_every_ms),
            min_provisional: frames(policy.min_provisional_ms),
            max_session: frames(policy.max_session_ms),
            idle: VecDeque::with_capacity(idle_capacity * FRAME),
            idle_probabilities: VecDeque::with_capacity(idle_capacity),
            idle_capacity,
            run: 0,
            utterance: None,
            next_id: 1,
            processed: 0,
            limited: false,
            policy,
        }
    }

    pub fn speaking(&self) -> bool {
        self.utterance.is_some()
    }

    /// Consumes one [`FRAME`] of 16 kHz audio and its speech probability.
    pub fn push(&mut self, frame: &[f32; FRAME], probability: f32, out: &mut Vec<Action>) {
        if self.limited {
            return;
        }
        self.processed += 1;
        match self.utterance.as_mut() {
            None => {
                self.idle.extend(frame);
                self.idle_probabilities.push_back(probability);
                while self.idle_probabilities.len() > self.idle_capacity {
                    self.idle_probabilities.pop_front();
                    self.idle.drain(..FRAME);
                }
                self.run = if probability >= self.policy.start_threshold {
                    self.run + 1
                } else {
                    0
                };
                if self.run >= self.min_speech {
                    let audio: Vec<f32> = self.idle.drain(..).collect();
                    self.utterance = Some(Utterance {
                        id: self.next_id,
                        start: self.processed * FRAME - audio.len(),
                        audio,
                        probabilities: self.idle_probabilities.drain(..).collect(),
                        silence: 0,
                        since_provisional: 0,
                    });
                    self.next_id += 1;
                    self.run = 0;
                    out.push(Action::SpeechStarted);
                }
            }
            Some(utterance) => {
                utterance.audio.extend_from_slice(frame);
                utterance.probabilities.push(probability);
                utterance.since_provisional += 1;
                utterance.silence = if probability < self.policy.end_threshold {
                    utterance.silence + 1
                } else {
                    0
                };
                if utterance.silence >= self.end_silence {
                    self.finalise(out);
                } else if utterance.probabilities.len() >= self.max_utterance {
                    self.split(out);
                } else if utterance.since_provisional >= self.provisional_every
                    && utterance.probabilities.len() >= self.min_provisional
                {
                    utterance.since_provisional = 0;
                    out.push(Action::Provisional {
                        utterance: utterance.id,
                        audio: utterance.audio.as_slice().into(),
                    });
                }
            }
        }
        if self.processed >= self.max_session {
            self.finish(out);
            self.limited = true;
            out.push(Action::LimitReached);
        }
    }

    /// Finalises an open utterance that contains enough speech; drops a trailing blip.
    pub fn finish(&mut self, out: &mut Vec<Action>) {
        if let Some(utterance) = &self.utterance {
            if utterance.probabilities.len() - utterance.silence >= self.min_speech {
                self.finalise(out);
            }
        }
        self.reset();
    }

    /// Drops every buffer without emitting anything.
    pub fn cancel(&mut self) {
        self.reset();
        self.limited = true;
    }

    fn reset(&mut self) {
        self.utterance = None;
        self.idle.clear();
        self.idle_probabilities.clear();
        self.run = 0;
    }

    fn finalise(&mut self, out: &mut Vec<Action>) {
        let Some(mut utterance) = self.utterance.take() else {
            return;
        };
        let kept = utterance.probabilities.len() - utterance.silence
            + utterance.silence.min(self.post_pad);
        utterance.audio.truncate(kept * FRAME);
        out.push(final_action(&utterance));
        self.idle.clear();
        self.idle_probabilities.clear();
        self.run = 0;
    }

    /// Cuts a long utterance at its quietest recent frame and keeps the remainder open.
    fn split(&mut self, out: &mut Vec<Action>) {
        let Some(mut utterance) = self.utterance.take() else {
            return;
        };
        let length = utterance.probabilities.len();
        let from = length.saturating_sub(self.split_search).max(1);
        let mut at = from;
        for (index, probability) in utterance.probabilities.iter().enumerate().skip(from) {
            if *probability <= utterance.probabilities[at] {
                at = index;
            }
        }
        let audio = utterance.audio.split_off(at * FRAME);
        let probabilities = utterance.probabilities.split_off(at);
        out.push(final_action(&utterance));
        let silence = probabilities
            .iter()
            .rev()
            .take_while(|p| **p < self.policy.end_threshold)
            .count();
        self.utterance = Some(Utterance {
            id: self.next_id,
            start: utterance.start + at * FRAME,
            audio,
            probabilities,
            silence,
            since_provisional: 0,
        });
        self.next_id += 1;
    }
}

fn final_action(utterance: &Utterance) -> Action {
    Action::Final {
        utterance: utterance.id,
        start_ms: milliseconds(utterance.start),
        end_ms: milliseconds(utterance.start + utterance.audio.len()),
        audio: utterance.audio.as_slice().into(),
    }
}
