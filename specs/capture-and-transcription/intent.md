# Capture and Transcription Intent

**Status:** Push-to-talk dictation into the source text, per-document
instructions and document prompt template instructions implemented;
source-audio retention and replay planned

## Intent

Let one clinician begin a note by pasting text or speaking, then obtain a local,
audio-verifiable transcript without silently treating ASR output as fact.

## User outcome

The clinician can dictate naturally into a text field, see provisional text
become final, correct it, and continue with the same privacy-review workflow as
typed or pasted text. Replaying the relevant audio for a questionable passage is
planned.

## Included behaviour

- Show a microphone button on the new-note **Source text** field, the document
  **Additional instructions** field and the document prompt template
  **Instructions** editor. In the formatted template editor, dictated text is
  inserted as plain text at the caret; in its Markdown source view, into the
  source.
- Hold the button, or hold ⌃⌥D while the field is focused, to talk; release to
  finish. A tap shorter than a quarter of a second keeps recording until the
  next tap or ⌃⌥D press. Esc cancels the recording and restores the field to
  how it was when recording started.
- Show that the microphone is live and hearing the clinician: a pressed
  recording button, a recording dot, elapsed time and a voice meter beneath the
  field. The meter follows the input level and says **Hearing speech** only
  while voice activity detects speech, otherwise **Waiting for speech**.
- Request microphone permission at the point of use.
- Gate microphone audio with voice-activity detection before transcription.
- Produce provisional and final timestamped transcript segments locally.
  Provisional text appears only beside the field, labelled as not yet final.
  Final text is inserted at the caret, replacing any selection, and the field is
  read-only until the recording ends.
- Refuse to insert text that would exceed the field's limit; stop and say so
  rather than truncating.
- Download the pinned speech model only through an explicit Settings action.
- Allow correction before and during privacy review.
- Allow cancellation and recover cleanly from an unavailable speech model,
  permission denial, device loss, interruption, or model failure.
- Planned: keep final source audio aligned with the original transcript for 30
  days after a note is saved.

Whisper large-v3 turbo through whisper.cpp is the initial engine. The pinned
small.en model is the fallback if a representative benchmark on the target M2
shows unacceptable latency or memory use, or if clinical vocabulary accuracy is
materially worse.

## Safety invariants

- Audio and transcripts do not leave the device through dictation. Dictated
  instructions follow the same submission review as typed instructions.
- Dictation audio exists only in memory and is discarded after transcription or
  on cancellation.
- Silence is not deliberately submitted to ASR.
- Provisional text is visually distinct and cannot be saved as final unnoticed.
- Numbers, medication names, dosages, abbreviations, and negations remain easy
  to check: dictated text is inserted where the clinician can read and edit it
  before detection or sending. Checking them against aligned audio is planned.
- Pasted source text is session-only and is not retained after save or discard.

## Success criteria

- A synthetic dictation can be recorded, stopped, corrected, and passed to
  privacy detection without a network connection once the speech model is
  installed.
- Stopping or cancelling releases the microphone, streams, threads, timers and
  audio buffers; the model is released after 90 seconds idle and before
  entity detection.
- Planned: selecting a final transcript segment can locate and replay its source
  audio.
- The ASR benchmark reports weighted errors for medication names, dosages,
  numbers, negations, and clinical abbreviations on 30–60 minutes of non-patient
  speech.

## Non-goals

Speaker diarisation, mobile capture, meeting recording, background recording,
global (outside the app) hotkeys, and automatic insertion into an electronic
patient record are outside this release.
