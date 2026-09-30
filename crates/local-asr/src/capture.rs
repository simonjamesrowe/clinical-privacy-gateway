use clinicians_veil_core::dictation::{downmix, DictationResult};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    ErrorKind, SampleFormat, Stream,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc, Mutex, PoisonError,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const NO_DEVICE: &str = "No microphone is available. Connect one and try again.";
const DEVICE_ERROR: &str = "The microphone could not start. Check the input device and try again.";
pub const STOPPED: &str = "The microphone stopped. Check the input device and try again.";
/// Device callbacks queued before the worker is considered too far behind (~2.5 s at 10 ms).
const QUEUE: usize = 256;

pub const BEHIND: &str = "Transcription fell behind, so dictation stopped.";

/// Signals shared by the capture, listening and recognising threads.
#[derive(Default)]
pub struct Control {
    /// Release the microphone and finish transcribing what was heard.
    pub stop: AtomicBool,
    /// Release everything and discard pending audio and text.
    pub cancel: Arc<AtomicBool>,
    failed: AtomicBool,
    failure: Mutex<Option<&'static str>>,
}

impl Control {
    pub fn done(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
            || self.cancel.load(Ordering::Relaxed)
            || self.failed.load(Ordering::Relaxed)
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Records the first content-free failure and stops every thread.
    pub fn fail(&self, message: &'static str) {
        let mut failure = self.failure.lock().unwrap_or_else(PoisonError::into_inner);
        failure.get_or_insert(message);
        self.failed.store(true, Ordering::Relaxed);
    }

    pub fn failure(&self) -> Option<&'static str> {
        *self.failure.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Opens the default input device on a dedicated thread that owns the stream. The stream is
/// dropped — turning the system microphone indicator off — as soon as `control` is done.
pub fn open(control: Arc<Control>) -> DictationResult<(JoinHandle<()>, Receiver<Vec<f32>>, u32)> {
    let (audio, received) = mpsc::sync_channel(QUEUE);
    let (opened, result) = mpsc::channel();
    let thread = thread::Builder::new()
        .name("dictation-capture".into())
        .spawn(move || match build(audio, control.clone()) {
            Ok((stream, rate)) => {
                let _ = opened.send(Ok(rate));
                while !control.done() {
                    thread::park_timeout(Duration::from_millis(20));
                }
                drop(stream);
            }
            Err(error) => {
                let _ = opened.send(Err(error));
            }
        })
        .map_err(|_| DEVICE_ERROR)?;
    let rate = result
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| DEVICE_ERROR)??;
    Ok((thread, received, rate))
}

fn build(audio: SyncSender<Vec<f32>>, control: Arc<Control>) -> DictationResult<(Stream, u32)> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or(NO_DEVICE)?;
    let supported = device.default_input_config().map_err(|_| DEVICE_ERROR)?;
    let format = supported.sample_format();
    let config = supported.config();
    let channels = usize::from(config.channels);
    let rate = config.sample_rate;
    let failed = control.clone();
    let on_error = move |error: cpal::Error| {
        // The default-device stream follows route changes by itself.
        if error.kind() != ErrorKind::DeviceChanged {
            failed.fail(STOPPED);
        }
    };
    let deliver = move |mono: Vec<f32>| {
        if let Err(TrySendError::Full(_)) = audio.try_send(mono) {
            control.fail(BEHIND);
        }
    };
    let timeout = Some(Duration::from_secs(5));
    let stream = match format {
        SampleFormat::F32 => device.build_input_stream::<f32, _, _>(
            config,
            move |data, _| {
                let mut mono = Vec::with_capacity(data.len() / channels.max(1));
                downmix(data, channels, &mut mono);
                deliver(mono);
            },
            on_error,
            timeout,
        ),
        SampleFormat::I16 => device.build_input_stream::<i16, _, _>(
            config,
            move |data, _| {
                let samples: Vec<f32> = data.iter().map(|s| f32::from(*s) / 32_768.0).collect();
                let mut mono = Vec::with_capacity(samples.len() / channels.max(1));
                downmix(&samples, channels, &mut mono);
                deliver(mono);
            },
            on_error,
            timeout,
        ),
        _ => return Err(DEVICE_ERROR),
    }
    .map_err(|error| match error.kind() {
        ErrorKind::PermissionDenied => {
            "Microphone access is off. Allow Clinician’s Veil in System Settings › Privacy & Security › Microphone."
        }
        _ => DEVICE_ERROR,
    })?;
    stream.play().map_err(|_| DEVICE_ERROR)?;
    Ok((stream, rate))
}
