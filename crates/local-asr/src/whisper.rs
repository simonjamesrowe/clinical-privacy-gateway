use crate::assets;
use clinicians_veil_core::dictation::{
    DictationResult, Pass, RecognisedSegment, Recogniser, SAMPLE_RATE,
};
use std::{
    ffi::c_void,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Once,
    },
};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

const MODEL_ERROR: &str =
    "The local speech model could not start. Retry or download the speech model again.";
const TRANSCRIBE_ERROR: &str = "Transcription failed. Try dictating again.";
/// whisper.cpp recommends at least one second of input; shorter utterances are padded.
const MIN_SAMPLES: usize = SAMPLE_RATE as usize * 21 / 20;
static LOGGING: Once = Once::new();

/// A verified, loaded Whisper model. Dropping it releases its weights and GPU buffers.
pub struct Model {
    context: WhisperContext,
}

/// Verifies the pinned files, then loads Whisper with Metal. Blocks for a second or more.
pub fn load(root: &Path) -> DictationResult<Model> {
    LOGGING.call_once(whisper_rs::install_logging_hooks);
    assets::verify(root)
        .map_err(|_| "Speech model files are missing or damaged. Download the speech model.")?;
    let mut params = WhisperContextParameters::default();
    params.use_gpu(true);
    let context = WhisperContext::new_with_params(assets::model_path(root), params)
        .map_err(|_| MODEL_ERROR)?;
    Ok(Model { context })
}

impl Model {
    /// A decoding state bound to this model. `cancel` interrupts a pass in progress.
    pub fn recogniser(
        self: &Arc<Self>,
        cancel: Arc<AtomicBool>,
    ) -> DictationResult<WhisperRecogniser> {
        Ok(WhisperRecogniser {
            state: self.context.create_state().map_err(|_| MODEL_ERROR)?,
            cancel,
            _model: self.clone(),
        })
    }
}

unsafe extern "C" fn abort(cancel: *mut c_void) -> bool {
    // SAFETY: the user data is always `Arc::as_ptr` of the recogniser's live cancel flag.
    unsafe { (*(cancel as *const AtomicBool)).load(Ordering::Relaxed) }
}

pub struct WhisperRecogniser {
    state: WhisperState,
    cancel: Arc<AtomicBool>,
    _model: Arc<Model>,
}

impl Recogniser for WhisperRecogniser {
    fn transcribe(
        &mut self,
        audio: &[f32],
        pass: Pass,
        cancel: &AtomicBool,
    ) -> DictationResult<Vec<RecognisedSegment>> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_translate(false);
        params.set_no_context(true);
        params.set_single_segment(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_no_speech_thold(0.6);
        params.set_temperature(0.0);
        // Provisional passes are advisory, so skip the slower temperature fallback.
        params.set_temperature_inc(match pass {
            Pass::Provisional => 0.0,
            Pass::Final => 0.2,
        });
        params.set_n_threads(4);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        // `set_abort_callback_safe` in whisper-rs 0.16 casts its boxed `dyn FnMut` to the closure
        // type, reading garbage (spurious aborts) and leaking the box on every call. Pass a plain
        // pointer to the cancel flag instead; `self.cancel` outlives the `full()` call below.
        // SAFETY: `abort` only reads an `AtomicBool` that stays alive for the whole call.
        unsafe {
            params.set_abort_callback(Some(abort));
            params.set_abort_callback_user_data(Arc::as_ptr(&self.cancel) as *mut c_void);
        }
        let padded;
        let input = if audio.len() < MIN_SAMPLES {
            padded = [audio, &vec![0.0; MIN_SAMPLES - audio.len()]].concat();
            &padded
        } else {
            audio
        };
        let result = self.state.full(params, input);
        if cancel.load(Ordering::Relaxed) {
            return Err("Operation cancelled.");
        }
        result.map_err(|_| TRANSCRIBE_ERROR)?;
        let mut segments = Vec::new();
        for segment in self.state.as_iter() {
            segments.push(RecognisedSegment {
                text: segment
                    .to_str_lossy()
                    .map_err(|_| TRANSCRIBE_ERROR)?
                    .into_owned(),
                no_speech: segment.no_speech_probability(),
            });
        }
        Ok(segments)
    }
}
