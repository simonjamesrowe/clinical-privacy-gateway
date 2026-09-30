use clinicians_veil_core::dictation::*;
use std::{
    collections::VecDeque,
    sync::{atomic::AtomicBool, Arc},
    time::Instant,
};

const SPEECH: f32 = 0.9;
const QUIET: f32 = 0.05;
const MS_PER_FRAME: usize = 32;

fn frame(value: f32) -> [f32; FRAME] {
    [value; FRAME]
}

/// Pushes `ms` of frames with one probability and returns the actions.
fn feed(segmenter: &mut Segmenter, probability: f32, ms: usize) -> Vec<Action> {
    let mut out = Vec::new();
    for _ in 0..ms.div_ceil(MS_PER_FRAME) {
        segmenter.push(&frame(probability), probability, &mut out);
    }
    out
}

fn finals(actions: &[Action]) -> Vec<(u64, usize)> {
    actions
        .iter()
        .filter_map(|action| match action {
            Action::Final {
                utterance, audio, ..
            } => Some((*utterance, audio.len())),
            _ => None,
        })
        .collect()
}

fn provisional_count(actions: &[Action]) -> usize {
    actions
        .iter()
        .filter(|a| matches!(a, Action::Provisional { .. }))
        .count()
}

#[test]
fn silence_and_short_blips_never_become_utterances() {
    let mut segmenter = Segmenter::new(Policy::default());
    assert!(feed(&mut segmenter, QUIET, 5_000).is_empty());
    let mut actions = feed(&mut segmenter, SPEECH, 200);
    actions.extend(feed(&mut segmenter, QUIET, 2_000));
    assert!(actions.is_empty());
    let mut out = Vec::new();
    segmenter.finish(&mut out);
    assert!(out.is_empty());
}

#[test]
fn speech_then_silence_gives_one_final_with_pre_roll_and_post_pad() {
    let mut segmenter = Segmenter::new(Policy::default());
    let mut actions = feed(&mut segmenter, QUIET, 1_000);
    actions.extend(feed(&mut segmenter, SPEECH, 800));
    assert_eq!(actions[0], Action::SpeechStarted);
    actions.extend(feed(&mut segmenter, QUIET, 1_000));
    let finals = finals(&actions);
    assert_eq!(finals.len(), 1);
    // 10 pre-roll frames + 25 speech frames + 7 post-pad frames.
    assert_eq!(finals[0].1, (10 + 25 + 7) * FRAME);
    let Some(Action::Final {
        start_ms, end_ms, ..
    }) = actions.iter().find(|a| matches!(a, Action::Final { .. }))
    else {
        unreachable!()
    };
    assert_eq!(*start_ms, (32 - 10) as u64 * 32);
    assert_eq!(*end_ms - *start_ms, 42 * 32);
}

#[test]
fn hysteresis_keeps_an_utterance_open_between_thresholds() {
    let mut segmenter = Segmenter::new(Policy::default());
    feed(&mut segmenter, SPEECH, 500);
    // 0.4 is below the start threshold but above the end threshold.
    let actions = feed(&mut segmenter, 0.4, 3_000);
    assert!(finals(&actions).is_empty());
    assert!(segmenter.speaking());
}

#[test]
fn provisional_snapshots_follow_the_cadence_after_a_minimum_length() {
    let mut segmenter = Segmenter::new(Policy::default());
    let actions = feed(&mut segmenter, SPEECH, 900);
    assert_eq!(provisional_count(&actions), 0);
    let actions = feed(&mut segmenter, SPEECH, 4_000);
    assert_eq!(provisional_count(&actions), 3);
}

#[test]
fn long_speech_splits_before_the_window_without_losing_or_duplicating_audio() {
    let mut segmenter = Segmenter::new(Policy::default());
    let mut actions = Vec::new();
    let mut pushed = 0;
    for index in 0..(70_000 / MS_PER_FRAME) {
        // A quieter frame every ~1.5 s gives the splitter a natural boundary.
        let probability = if index % 47 == 0 { 0.4 } else { SPEECH };
        segmenter.push(&frame(probability), probability, &mut actions);
        pushed += FRAME;
    }
    segmenter.finish(&mut actions);
    let finals = finals(&actions);
    assert!(finals.len() >= 3);
    assert!(finals.iter().all(|(_, len)| *len <= 28_000 * 16));
    assert_eq!(finals.iter().map(|(_, len)| len).sum::<usize>(), pushed);
    let ids: Vec<u64> = finals.iter().map(|(id, _)| *id).collect();
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
}

#[test]
fn finish_finalises_speech_and_cancel_drops_it() {
    let mut segmenter = Segmenter::new(Policy::default());
    let mut actions = feed(&mut segmenter, SPEECH, 600);
    segmenter.finish(&mut actions);
    assert_eq!(finals(&actions).len(), 1);

    let mut segmenter = Segmenter::new(Policy::default());
    let mut actions = feed(&mut segmenter, SPEECH, 600);
    segmenter.cancel();
    actions.extend(feed(&mut segmenter, SPEECH, 2_000));
    segmenter.finish(&mut actions);
    assert!(finals(&actions).is_empty());
}

#[test]
fn session_limit_finalises_and_stops_listening() {
    let mut segmenter = Segmenter::new(Policy {
        max_session_ms: 3_200,
        ..Policy::default()
    });
    let actions = feed(&mut segmenter, SPEECH, 6_000);
    assert_eq!(finals(&actions).len(), 1);
    assert_eq!(actions.last(), Some(&Action::LimitReached));
    assert_eq!(
        actions
            .iter()
            .filter(|a| **a == Action::LimitReached)
            .count(),
        1
    );
}

fn segment(text: &str) -> RecognisedSegment {
    RecognisedSegment {
        text: text.into(),
        no_speech: 0.01,
    }
}

#[test]
fn clean_drops_non_speech_tags_and_known_hallucinations_only() {
    assert_eq!(clean(&[segment(" [BLANK_AUDIO] ")]), None);
    assert_eq!(clean(&[segment("(silence)")]), None);
    assert_eq!(clean(&[segment("♪ ♪")]), None);
    assert_eq!(clean(&[segment("...")]), None);
    assert_eq!(clean(&[segment(" Thank you for watching! ")]), None);
    assert_eq!(
        clean(&[RecognisedSegment {
            text: "Sertraline 50 mg".into(),
            no_speech: 0.9
        }]),
        None
    );
    assert_eq!(
        clean(&[
            segment("Thank you for the  update."),
            segment(" Not   suicidal.")
        ])
        .as_deref(),
        Some("Thank you for the update. Not suicidal.")
    );
}

#[test]
fn clean_is_linear_on_one_hundred_thousand_characters() {
    let worst = format!("[{}", "( ".repeat(50_000));
    let started = Instant::now();
    let cleaned = clean(&[segment(&worst), segment(&"a ".repeat(50_000))]).unwrap();
    assert_eq!(cleaned.len(), 99_999);
    assert!(started.elapsed().as_secs() < 2);
}

#[test]
fn jobs_serve_finals_first_keep_only_the_latest_provisional_and_bound_backlog() {
    let jobs = Jobs::new(1_000);
    let audio: Arc<[f32]> = vec![0.0; 8_000].into();
    let provisional = |utterance| Action::Provisional {
        utterance,
        audio: audio.clone(),
    };
    let final_action = |utterance| Action::Final {
        utterance,
        audio: audio.clone(),
        start_ms: 0,
        end_ms: 500,
    };
    jobs.offer(&provisional(1)).unwrap();
    jobs.offer(&provisional(2)).unwrap();
    jobs.offer(&final_action(1)).unwrap();
    jobs.offer(&final_action(2)).unwrap();
    assert!(jobs.offer(&final_action(3)).is_err());
    assert!(matches!(jobs.next(), Some(Job::Final { utterance: 1, .. })));
    assert!(matches!(jobs.next(), Some(Job::Final { utterance: 2, .. })));
    // The final for utterance 2 superseded its provisional snapshot.
    jobs.offer(&provisional(3)).unwrap();
    jobs.offer(&provisional(4)).unwrap();
    assert!(matches!(
        jobs.next(),
        Some(Job::Provisional { utterance: 4, .. })
    ));
    jobs.offer(&provisional(5)).unwrap();
    jobs.offer(&final_action(5)).unwrap();
    jobs.close();
    assert!(matches!(jobs.next(), Some(Job::Final { utterance: 5, .. })));
    assert_eq!(jobs.next(), None);

    let cancelled = Jobs::new(1_000);
    cancelled.offer(&final_action(1)).unwrap();
    cancelled.cancel();
    assert_eq!(cancelled.next(), None);
}

#[test]
fn transcript_ignores_stale_provisional_results_and_bounds_length() {
    let mut transcript = Transcript::new();
    let audio: Arc<[f32]> = vec![0.0; 16].into();
    let final_job = |utterance| Job::Final {
        utterance,
        audio: audio.clone(),
        start_ms: 0,
        end_ms: 1,
    };
    let provisional_job = Job::Provisional {
        utterance: 1,
        audio: audio.clone(),
    };
    assert!(transcript
        .accept(&provisional_job, &[segment("Ten")])
        .unwrap()
        .is_some());
    assert!(transcript
        .accept(&final_job(1), &[segment("Ten mg.")])
        .unwrap()
        .is_some());
    assert_eq!(
        transcript.accept(&provisional_job, &[segment("Ten")]),
        Ok(None)
    );
    let long = "a".repeat(99_995);
    assert!(transcript.accept(&final_job(2), &[segment(&long)]).is_err());
}

struct FakeVad(VecDeque<f32>);
impl VoiceActivity for FakeVad {
    fn probabilities(&mut self, samples: &[f32]) -> DictationResult<Vec<f32>> {
        Ok((0..samples.len() / FRAME)
            .map(|_| self.0.pop_front().unwrap_or(QUIET))
            .collect())
    }
}

struct FakeRecogniser(Vec<Pass>);
impl Recogniser for FakeRecogniser {
    fn transcribe(
        &mut self,
        audio: &[f32],
        pass: Pass,
        _: &AtomicBool,
    ) -> DictationResult<Vec<RecognisedSegment>> {
        self.0.push(pass);
        Ok(vec![segment(&format!("{} ms", milliseconds(audio.len())))])
    }
}

#[test]
fn listener_and_recogniser_turn_speech_into_ordered_final_text() {
    let script: VecDeque<f32> = [
        vec![QUIET; 20],
        vec![SPEECH; 60],
        vec![QUIET; 30],
        vec![SPEECH; 40],
    ]
    .concat()
    .into();
    let frames = script.len();
    let mut listener = Listener::new(FakeVad(script), Segmenter::new(Policy::default()));
    let jobs = Jobs::new(60_000);
    let mut actions = Vec::new();
    // Deliver audio in uneven device-sized chunks.
    let audio = vec![0.1; frames * FRAME + 100];
    for chunk in audio.chunks(1_234) {
        listener.push(chunk, &mut actions).unwrap();
    }
    listener.finish(&mut actions).unwrap();
    for action in &actions {
        jobs.offer(action).unwrap();
    }
    jobs.close();
    let mut recogniser = FakeRecogniser(Vec::new());
    let mut results = Vec::new();
    recognise(&jobs, &mut recogniser, &AtomicBool::new(false), |r| {
        results.push(r)
    })
    .unwrap();
    let texts: Vec<String> = results
        .iter()
        .map(|r| match r {
            Transcribed::Final { text, .. } => text.clone(),
            Transcribed::Provisional { .. } => unreachable!("closed queues drop provisionals"),
        })
        .collect();
    // (10 pre-roll + 60 speech + 7 post-pad) frames. The first 22 quiet frames end that
    // utterance, so only the remaining 8 become pre-roll for the next: 8 + 40 frames.
    assert_eq!(texts, ["2464 ms", "1536 ms"]);
    assert_eq!(recogniser.0, [Pass::Final, Pass::Final]);
}

#[test]
fn cancelled_recognition_stops_before_transcribing() {
    let jobs = Jobs::new(1_000);
    jobs.offer(&Action::Final {
        utterance: 1,
        audio: vec![0.0; 16].into(),
        start_ms: 0,
        end_ms: 1,
    })
    .unwrap();
    let mut recogniser = FakeRecogniser(Vec::new());
    let result = recognise(&jobs, &mut recogniser, &AtomicBool::new(true), |_| {});
    assert_eq!(result, Err("Operation cancelled."));
    assert!(recogniser.0.is_empty());
}
