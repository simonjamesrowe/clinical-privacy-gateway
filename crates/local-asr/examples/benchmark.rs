//! Synthetic-only speech benchmark: model load time and per-utterance latency.
//!
//! Generate input with macOS speech synthesis, never patient audio:
//! `say -o /tmp/dictation.wav --data-format=LEF32@16000 "Sertraline fifty milligrams…"`
//! Run with `/usr/bin/time -l` to report peak resident memory.
use clinicians_veil_asr::{assets, load, SileroVad};
use clinicians_veil_core::dictation::{
    clean, Action, Listener, Pass, Policy, Recogniser, Segmenter, SAMPLE_RATE,
};
use std::{
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc},
    time::Instant,
};

fn main() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (install, root, wav) = match args.as_slice() {
        [root, wav] => (false, PathBuf::from(root), PathBuf::from(wav)),
        [flag, root, wav] if flag == "--install" => (true, PathBuf::from(root), PathBuf::from(wav)),
        _ => return Err("Usage: benchmark [--install] <model-directory> <16kHz-f32-wav>"),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    if install {
        assets::install(&root, &cancel, |_, _| {})?;
    }
    let audio = read_wav(&wav)?;
    println!("audio: {:.1} s", audio.len() as f32 / SAMPLE_RATE as f32);

    let started = Instant::now();
    let model = Arc::new(load(&root)?);
    println!("load (verify + init): {} ms", started.elapsed().as_millis());
    let mut recogniser = model.recogniser(cancel.clone())?;

    let started = Instant::now();
    let mut listener = Listener::new(
        SileroVad::load(&assets::vad_path(&root))?,
        Segmenter::new(Policy::default()),
    );
    let mut actions = Vec::new();
    for chunk in audio.chunks(480) {
        listener.push(chunk, &mut actions)?;
    }
    listener.finish(&mut actions)?;
    println!("voice activity: {} ms", started.elapsed().as_millis());

    for action in &actions {
        let (audio, pass, label) = match action {
            Action::Provisional { audio, .. } => (audio, Pass::Provisional, "provisional"),
            Action::Final { audio, .. } => (audio, Pass::Final, "final"),
            _ => continue,
        };
        let started = Instant::now();
        let segments = recogniser.transcribe(audio, pass, &cancel)?;
        println!(
            "{label:>11} {:>5.1} s audio → {:>5} ms: {}",
            audio.len() as f32 / SAMPLE_RATE as f32,
            started.elapsed().as_millis(),
            clean(&segments).unwrap_or_default()
        );
    }
    for seconds in [5, 10, 15, 28] {
        let length = (seconds * SAMPLE_RATE as usize).min(audio.len());
        let started = Instant::now();
        recogniser.transcribe(&audio[..length], Pass::Final, &cancel)?;
        println!(
            "fixed {:>4.1} s → {} ms",
            length as f32 / SAMPLE_RATE as f32,
            started.elapsed().as_millis()
        );
    }
    Ok(())
}

/// Reads the `data` chunk of a mono 32-bit float WAV file.
fn read_wav(path: &PathBuf) -> Result<Vec<f32>, &'static str> {
    let bytes = std::fs::read(path).map_err(|_| "Could not read the WAV file")?;
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        if &bytes[at..at + 4] == b"data" {
            let data = bytes
                .get(at + 8..at + 8 + size)
                .ok_or("Truncated WAV file")?;
            return Ok(data
                .as_chunks::<4>()
                .0
                .iter()
                .map(|bytes| f32::from_le_bytes(*bytes))
                .collect());
        }
        at += 8 + size + (size & 1);
    }
    Err("WAV file has no data chunk")
}
