# Capture and Transcription Intent

**Status:** Planned for the first release

## Intent

Let one clinician begin a note by pasting text or speaking, then obtain a local,
audio-verifiable transcript without silently treating ASR output as fact.

## User outcome

The clinician can dictate naturally, see provisional text become final, replay
the relevant audio for any questionable passage, or paste existing text into the
same privacy-review workflow.

## Included behaviour

- Request microphone permission at the point of use.
- Gate microphone audio with voice-activity detection before transcription.
- Produce provisional and final timestamped transcript segments locally.
- Keep final source audio aligned with the original transcript for 30 days after
  a note is saved.
- Allow correction before and during privacy review.
- Allow cancellation and recover cleanly from unavailable speech assets,
  permission denial, interruption, or model failure.

SpeechAnalyzer is the initial engine. WhisperKit remains a candidate only if a
representative benchmark shows a material advantage on clinical vocabulary.

## Safety invariants

- Audio and transcripts do not leave the device.
- Silence is not deliberately submitted to ASR.
- Provisional text is visually distinct and cannot be saved as final unnoticed.
- Numbers, medication names, dosages, abbreviations, and negations remain easy
  to check against their aligned audio.
- Pasted source text is session-only and is not retained after save or discard.

## Success criteria

- A synthetic dictation can be recorded, stopped, corrected, and passed to
  privacy detection without a network connection.
- Selecting a final transcript segment can locate and replay its source audio.
- Cancellation releases microphone, streams, timers, model resources, and
  temporary files.
- The ASR benchmark reports weighted errors for medication names, dosages,
  numbers, negations, and clinical abbreviations on 30–60 minutes of non-patient
  speech.

## Non-goals

Speaker diarisation, mobile capture, meeting recording, background recording,
and automatic insertion into an electronic patient record are outside this
release.
