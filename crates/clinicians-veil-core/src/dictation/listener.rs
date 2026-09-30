use super::{segmenter::Action, DictationResult, Segmenter, VoiceActivity, FRAME};

/// Frames per voice-activity call: 256 ms.
const HOP: usize = 8 * FRAME;

/// Feeds 16 kHz audio through voice activity into the segmenter in fixed hops.
pub struct Listener<V> {
    vad: V,
    segmenter: Segmenter,
    pending: Vec<f32>,
}

impl<V: VoiceActivity> Listener<V> {
    pub fn new(vad: V, segmenter: Segmenter) -> Self {
        Self {
            vad,
            segmenter,
            pending: Vec::with_capacity(HOP * 2),
        }
    }

    pub fn speaking(&self) -> bool {
        self.segmenter.speaking()
    }

    pub fn push(&mut self, samples: &[f32], out: &mut Vec<Action>) -> DictationResult<()> {
        self.pending.extend_from_slice(samples);
        while self.pending.len() >= HOP {
            let hop: Vec<f32> = self.pending.drain(..HOP).collect();
            self.analyse(&hop, out)?;
        }
        Ok(())
    }

    /// Analyses the remaining whole frames and finalises the open utterance.
    pub fn finish(&mut self, out: &mut Vec<Action>) -> DictationResult<()> {
        let whole = self.pending.len() / FRAME * FRAME;
        let rest: Vec<f32> = self.pending.drain(..whole).collect();
        self.pending.clear();
        if !rest.is_empty() {
            self.analyse(&rest, out)?;
        }
        self.segmenter.finish(out);
        Ok(())
    }

    pub fn cancel(&mut self) {
        self.pending.clear();
        self.segmenter.cancel();
    }

    fn analyse(&mut self, samples: &[f32], out: &mut Vec<Action>) -> DictationResult<()> {
        let probabilities = self.vad.probabilities(samples)?;
        if probabilities.len() != samples.len() / FRAME {
            return Err("Voice detection failed. Try dictating again.");
        }
        for (frame, probability) in samples.as_chunks::<FRAME>().0.iter().zip(probabilities) {
            self.segmenter.push(frame, probability, out);
        }
        Ok(())
    }
}
