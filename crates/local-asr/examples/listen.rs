//! Manual end-to-end check of the dictation engine.
//!
//! `listen [--request] <models> <seconds>` records the default microphone: speak (or play
//! synthetic speech with `say "…"`) and the engine stops after `seconds`. It needs microphone
//! access for the terminal; without `--request` it exits instead of showing the macOS prompt.
//! `listen --replay <models> <16kHz-f32-wav>` feeds a synthetic WAV through the same threads.
//! Each event is printed. Never use patient speech.
use clinicians_veil_asr::{load, microphone, replay, start, Event, Loader, Sink};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

fn main() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (mode, root, value) = match args.as_slice() {
        [root, seconds] => ("", root, seconds),
        [flag, root, value] if flag == "--request" || flag == "--replay" => {
            (flag.as_str(), root, value)
        }
        _ => return Err("Usage: listen [--request] <models> <seconds> | --replay <models> <wav>"),
    };
    let root = PathBuf::from(root);
    let wav = match mode {
        "--replay" => Some(read_wav(&PathBuf::from(value))?),
        _ => None,
    };
    let seconds: u64 = match &wav {
        Some(samples) => samples.len() as u64 / 16_000 + 2,
        None => value.parse().map_err(|_| "Seconds must be a number")?,
    };
    if wav.is_none() {
        let access = microphone::access();
        println!("microphone: {access:?}");
        if access != microphone::Access::Authorized
            && !(mode == "--request" && microphone::request())
        {
            return Err("Microphone access is not granted to this process.");
        }
    }
    let started = Instant::now();
    let (done, finished) = mpsc::channel();
    let sink: Sink = Arc::new(move |event: Event| {
        let terminal = matches!(event, Event::Finished | Event::Cancelled | Event::Failed(_));
        if !matches!(event, Event::Level { .. }) {
            println!("{:>6} ms {event:?}", started.elapsed().as_millis());
        }
        if terminal {
            let _ = done.send(());
        }
    });
    let model_root = root.clone();
    let loader: Loader = Box::new(move |report| {
        report(Event::LoadingModel);
        Ok(Arc::new(load(&model_root)?))
    });
    let session = match wav {
        Some(samples) => replay(&root, samples, 16_000, loader, sink)?,
        None => start(&root, loader, sink)?,
    };
    std::thread::sleep(Duration::from_secs(seconds));
    println!("{:>6} ms stop", started.elapsed().as_millis());
    session.stop();
    finished
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| "No terminal event")?;
    session.join();
    Ok(())
}

/// Reads the `data` chunk of a mono 16 kHz 32-bit float WAV file.
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
