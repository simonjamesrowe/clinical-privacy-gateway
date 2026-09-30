/// Averages interleaved channels into mono, appending to `out`. Trailing partial frames are ignored.
pub fn downmix(interleaved: &[f32], channels: usize, out: &mut Vec<f32>) {
    if channels <= 1 {
        out.extend_from_slice(interleaved);
        return;
    }
    let scale = 1.0 / channels as f32;
    out.extend(
        interleaved
            .chunks_exact(channels)
            .map(|frame| frame.iter().sum::<f32>() * scale),
    );
}

/// Input level for the recording meter: RMS mapped from −60..0 dBFS onto `0..=1`.
pub fn level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let power = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    if !power.is_finite() || power <= 0.0 {
        return 0.0;
    }
    let decibels = 10.0 * power.log10();
    ((decibels + 60.0) / 60.0).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_averages_complete_frames_only() {
        let mut out = Vec::new();
        downmix(&[1.0, 0.0, 0.5, 0.5, 0.25], 2, &mut out);
        assert_eq!(out, [0.5, 0.5]);
        downmix(&[0.1, 0.2], 1, &mut out);
        assert_eq!(out, [0.5, 0.5, 0.1, 0.2]);
        downmix(&[0.3], 0, &mut out);
        assert_eq!(out.len(), 5);
    }

    #[test]
    fn level_is_bounded_for_silence_clipping_and_garbage() {
        assert_eq!(level(&[]), 0.0);
        assert_eq!(level(&[0.0; 512]), 0.0);
        assert_eq!(level(&[1.0; 512]), 1.0);
        assert_eq!(level(&[4.0; 512]), 1.0);
        assert_eq!(level(&[f32::NAN; 4]), 0.0);
        let quiet = level(&[0.01; 512]);
        assert!(quiet > 0.0 && quiet < 0.5);
    }
}
