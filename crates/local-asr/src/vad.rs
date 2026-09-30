use clinicians_veil_core::dictation::{DictationResult, VoiceActivity, FRAME};
use std::path::Path;
use whisper_rs::{WhisperVadContext, WhisperVadContextParams};

const VAD_ERROR: &str = "Voice detection failed. Try dictating again.";
/// whisper.cpp clears Silero's recurrent state on every call, so each hop is analysed with the
/// preceding 0.5 s to give its first frames context.
const TAIL: usize = 16 * FRAME;

pub struct SileroVad {
    context: WhisperVadContext,
    tail: Vec<f32>,
}

impl SileroVad {
    /// Loads the pinned Silero model. whisper-rs 0.16 leaks the path's `CString` (~100 bytes)
    /// on each load; one load per recording keeps that bounded and immaterial.
    pub fn load(path: &Path) -> DictationResult<Self> {
        let path = path.to_str().ok_or(VAD_ERROR)?;
        let mut params = WhisperVadContextParams::new();
        params.set_n_threads(1);
        params.set_use_gpu(false);
        Ok(Self {
            context: WhisperVadContext::new(path, params).map_err(|_| VAD_ERROR)?,
            tail: Vec::with_capacity(TAIL),
        })
    }
}

impl VoiceActivity for SileroVad {
    fn probabilities(&mut self, samples: &[f32]) -> DictationResult<Vec<f32>> {
        let frames = samples.len() / FRAME;
        let skip = self.tail.len() / FRAME;
        let mut input = Vec::with_capacity(self.tail.len() + frames * FRAME);
        input.extend_from_slice(&self.tail);
        input.extend_from_slice(&samples[..frames * FRAME]);
        self.context.detect_speech(&input).map_err(|_| VAD_ERROR)?;
        let probabilities = self
            .context
            .probabilities()
            .get(skip..skip + frames)
            .ok_or(VAD_ERROR)?
            .iter()
            .map(|p| {
                if p.is_finite() {
                    p.clamp(0.0, 1.0)
                } else {
                    0.0
                }
            })
            .collect();
        let keep = input.len().min(TAIL);
        self.tail.clear();
        self.tail.extend_from_slice(&input[input.len() - keep..]);
        Ok(probabilities)
    }
}
