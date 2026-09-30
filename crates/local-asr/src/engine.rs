use crate::{
    assets,
    capture::{self, Control},
    vad::SileroVad,
    Model,
};
use clinicians_veil_core::dictation::{
    level, recognise, Action, DictationResult, Jobs, Listener, Policy, Resampler, Segmenter,
    Transcribed,
};
use std::{
    path::Path,
    sync::{
        atomic::Ordering,
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

/// Queued final audio allowed while the model loads or falls behind.
const MAX_PENDING_MS: u32 = 60_000;
/// Samples per level report: 64 ms, about 15 reports a second.
const LEVEL_WINDOW: usize = 1_024;

/// Content-free progress, plus transcript text for the view that started the recording.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Listening,
    LoadingModel,
    ModelReady,
    Level {
        level: f32,
        speaking: bool,
    },
    Transcribed(Transcribed),
    LimitReached,
    /// Terminal: every queued utterance was transcribed and every resource released.
    Finished,
    /// Terminal: pending audio and text were discarded.
    Cancelled,
    /// Terminal: a content-free reason. Text already reported stays reported.
    Failed(&'static str),
}

pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;
/// Returns the resident model or loads it, reporting [`Event::LoadingModel`] through the sink.
pub type Loader = Box<dyn FnOnce(&dyn Fn(Event)) -> DictationResult<Arc<Model>> + Send>;

/// One recording. Exactly one terminal event is reported, after every thread has finished.
pub struct Session {
    control: Arc<Control>,
    jobs: Arc<Jobs>,
    recogniser: Option<JoinHandle<()>>,
}

impl Session {
    /// Releases the microphone and transcribes what was already heard.
    pub fn stop(&self) {
        self.control.stop.store(true, Ordering::Relaxed);
    }

    /// Releases everything and discards pending audio and text.
    pub fn cancel(&self) {
        self.control.cancel.store(true, Ordering::Relaxed);
        self.jobs.cancel();
    }

    /// Waits for every thread; used during app teardown after [`Session::cancel`].
    pub fn join(mut self) {
        if let Some(thread) = self.recogniser.take() {
            let _ = thread.join();
        }
    }
}

/// Opens the microphone and starts listening immediately, while `load` provides the model in
/// parallel so the first words are queued rather than lost.
pub fn start(root: &Path, load: Loader, sink: Sink) -> DictationResult<Session> {
    run(root, load, sink, capture::open)
}

/// Runs the same pipeline over prerecorded synthetic audio at real-time pace instead of the
/// microphone. For benchmarks and end-to-end checks; never pass patient audio.
pub fn replay(
    root: &Path,
    samples: Vec<f32>,
    rate: u32,
    load: Loader,
    sink: Sink,
) -> DictationResult<Session> {
    run(root, load, sink, move |control| {
        let (sender, audio) = mpsc::sync_channel(256);
        let thread = thread::Builder::new()
            .name("dictation-replay".into())
            .spawn(move || {
                let chunk = (rate / 100).max(1) as usize;
                for samples in samples.chunks(chunk) {
                    if control.done() || sender.send(samples.to_vec()).is_err() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                while !control.done() {
                    thread::park_timeout(Duration::from_millis(20));
                }
            })
            .map_err(|_| "Dictation could not start. Try again.")?;
        Ok((thread, audio, rate))
    })
}

fn run(
    root: &Path,
    load: Loader,
    sink: Sink,
    source: impl FnOnce(Arc<Control>) -> DictationResult<(JoinHandle<()>, Receiver<Vec<f32>>, u32)>,
) -> DictationResult<Session> {
    assets::verify_vad(root)
        .map_err(|_| "Speech model files are missing or damaged. Download the speech model.")?;
    let control = Arc::new(Control::default());
    let jobs = Arc::new(Jobs::new(MAX_PENDING_MS));
    let (capture, audio, rate) = source(control.clone())?;
    sink(Event::Listening);
    let worker = {
        let (control, jobs, sink) = (control.clone(), jobs.clone(), sink.clone());
        let vad = assets::vad_path(root);
        thread::Builder::new()
            .name("dictation-listener".into())
            .spawn(
                move || match listen(&vad, audio, rate, &control, &jobs, &*sink) {
                    Ok(()) => jobs.close(),
                    Err(message) => {
                        control.fail(message);
                        jobs.cancel();
                    }
                },
            )
    };
    let worker = match worker {
        Ok(worker) => worker,
        Err(_) => {
            control.cancel.store(true, Ordering::Relaxed);
            let _ = capture.join();
            return Err("Dictation could not start. Try again.");
        }
    };
    let recogniser = {
        let (control, jobs) = (control.clone(), jobs.clone());
        thread::Builder::new()
            .name("dictation-recogniser".into())
            .spawn(move || {
                let result = transcribe(load, &control, &jobs, &*sink);
                if let Err(message) = result {
                    if !control.cancelled() {
                        control.fail(message);
                    }
                    jobs.cancel();
                }
                let _ = worker.join();
                let _ = capture.join();
                sink(if control.cancelled() {
                    Event::Cancelled
                } else if let Some(message) = control.failure() {
                    Event::Failed(message)
                } else {
                    Event::Finished
                });
            })
    };
    match recogniser {
        Ok(recogniser) => Ok(Session {
            control,
            jobs,
            recogniser: Some(recogniser),
        }),
        Err(_) => {
            control.cancel.store(true, Ordering::Relaxed);
            jobs.cancel();
            Err("Dictation could not start. Try again.")
        }
    }
}

fn listen(
    vad: &Path,
    audio: Receiver<Vec<f32>>,
    rate: u32,
    control: &Control,
    jobs: &Jobs,
    sink: &dyn Fn(Event),
) -> DictationResult<()> {
    let mut listener = Listener::new(SileroVad::load(vad)?, Segmenter::new(Policy::default()));
    let mut resampler = Resampler::new(rate);
    let (mut samples, mut meter, mut actions) = (Vec::new(), Vec::new(), Vec::new());
    loop {
        if control.cancelled() {
            listener.cancel();
            return Ok(());
        }
        if let Some(message) = control.failure() {
            return Err(message);
        }
        match audio.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                samples.clear();
                resampler.process(&chunk, &mut samples);
                listener.push(&samples, &mut actions)?;
                meter.extend_from_slice(&samples);
                if meter.len() >= LEVEL_WINDOW {
                    sink(Event::Level {
                        level: level(&meter),
                        speaking: listener.speaking(),
                    });
                    meter.clear();
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            // The capture thread dropped the stream after a stop.
            Err(RecvTimeoutError::Disconnected) => {
                if control.cancelled() {
                    listener.cancel();
                    return Ok(());
                }
                listener.finish(&mut actions)?;
                return offer(&mut actions, control, jobs, sink);
            }
        }
        offer(&mut actions, control, jobs, sink)?;
    }
}

fn offer(
    actions: &mut Vec<Action>,
    control: &Control,
    jobs: &Jobs,
    sink: &dyn Fn(Event),
) -> DictationResult<()> {
    for action in actions.drain(..) {
        if action == Action::LimitReached {
            control.stop.store(true, Ordering::Relaxed);
            sink(Event::LimitReached);
        }
        jobs.offer(&action)?;
    }
    Ok(())
}

fn transcribe(
    load: Loader,
    control: &Control,
    jobs: &Jobs,
    sink: &dyn Fn(Event),
) -> DictationResult<()> {
    let model = load(sink)?;
    if control.cancelled() {
        return Err("Operation cancelled.");
    }
    let mut recogniser = model.recogniser(control.cancel.clone())?;
    drop(model);
    sink(Event::ModelReady);
    recognise(jobs, &mut recogniser, &control.cancel, |result| {
        sink(Event::Transcribed(result))
    })
}
