use super::SAMPLE_RATE;
use std::f64::consts::PI;

/// Input samples each side of an output sample.
const HALF_WIDTH: usize = 16;
/// Low-pass cutoff as a fraction of the output Nyquist frequency.
const CUTOFF: f64 = 0.9;

/// Streaming mono resampler from a device rate to 16 kHz.
///
/// Speech needs only a band-limited decimator, so this is a direct windowed-sinc filter:
/// 32 taps per output sample, Hann-windowed, with its DC gain normalised to one.
pub struct Resampler {
    step: f64,
    cutoff: f64,
    buffer: Vec<f32>,
    position: f64,
}

impl Resampler {
    pub fn new(input_rate: u32) -> Self {
        let step = f64::from(input_rate.max(1)) / f64::from(SAMPLE_RATE);
        Self {
            step,
            cutoff: CUTOFF * 0.5 / step.max(1.0),
            buffer: Vec::with_capacity(8_192),
            position: 0.0,
        }
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.step == 1.0 {
            out.extend_from_slice(input);
            return;
        }
        self.buffer.extend_from_slice(input);
        while self.position + (HALF_WIDTH as f64) < self.buffer.len() as f64 {
            out.push(self.sample(self.position));
            self.position += self.step;
        }
        let consumed = (self.position.floor() as usize).saturating_sub(HALF_WIDTH);
        if consumed > 0 {
            self.buffer.drain(..consumed);
            self.position -= consumed as f64;
        }
    }

    fn sample(&self, at: f64) -> f32 {
        let centre = at.floor() as isize;
        let (mut total, mut weights) = (0.0, 0.0);
        for index in centre - HALF_WIDTH as isize + 1..=centre + HALF_WIDTH as isize {
            let Some(value) = usize::try_from(index).ok().and_then(|i| self.buffer.get(i)) else {
                continue;
            };
            let distance = at - index as f64;
            let window = 0.5 + 0.5 * (PI * distance / HALF_WIDTH as f64).cos();
            let x = 2.0 * self.cutoff * distance;
            let sinc = if x.abs() < 1e-9 {
                1.0
            } else {
                (PI * x).sin() / (PI * x)
            };
            let weight = sinc * window;
            total += f64::from(*value) * weight;
            weights += weight;
        }
        if weights.abs() < 1e-9 {
            0.0
        } else {
            (total / weights) as f32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, frequency: f64, seconds: f64) -> Vec<f32> {
        (0..(f64::from(rate) * seconds) as usize)
            .map(|n| (2.0 * PI * frequency * n as f64 / f64::from(rate)).sin() as f32)
            .collect()
    }

    fn resample(rate: u32, input: &[f32]) -> Vec<f32> {
        let mut resampler = Resampler::new(rate);
        let mut out = Vec::new();
        // Uneven device-sized chunks.
        for chunk in input.chunks(517) {
            resampler.process(chunk, &mut out);
        }
        out
    }

    fn crossings(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|pair| (pair[0] < 0.0) != (pair[1] < 0.0))
            .count()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn keeps_speech_band_tones_at_the_right_length_frequency_and_level() {
        for rate in [48_000, 44_100, 32_000] {
            let out = resample(rate, &tone(rate, 1_000.0, 1.0));
            assert!((out.len() as i64 - 16_000).abs() <= HALF_WIDTH as i64 + 1);
            let body = &out[100..out.len() - 100];
            let seconds = body.len() as f64 / 16_000.0;
            let measured = crossings(body) as f64 / 2.0 / seconds;
            assert!((measured - 1_000.0).abs() < 10.0, "{rate}: {measured}");
            assert!((rms(body) - std::f32::consts::FRAC_1_SQRT_2).abs() < 0.03);
        }
    }

    #[test]
    fn attenuates_tones_above_the_output_nyquist() {
        let out = resample(48_000, &tone(48_000, 12_000.0, 0.5));
        assert!(rms(&out[100..out.len() - 100]) < 0.05);
    }

    #[test]
    fn passes_sixteen_kilohertz_through() {
        let input = tone(16_000, 440.0, 0.1);
        assert_eq!(resample(16_000, &input), input);
    }
}
