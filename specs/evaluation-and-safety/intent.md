# Evaluation and Safety Intent

**Status:** Required before clinical use

## Intent

Make transcription, privacy detection, transformation, retention, and egress
claims measurable without using identifiable patient material.

## Evaluation corpora

- Build 20–50 synthetic notes spanning progress notes, family work, paediatric
  and adult cases, care settings, safeguarding, education, email threads, and
  report excerpts.
- Annotate every direct identifier, relationship, intended replacement, and
  indirect-risk combination to form a gold set.
- Record 30–60 minutes of the intended user's non-patient dictation for ASR
  comparison, including invented medication names, dosages, numbers,
  abbreviations, and negations.
- Keep all corpora local unless their synthetic status has been manually
  verified before publication.

## Measures

- Detection recall, false-negative rate, false-positive rate, and contribution
  by stage.
- Replacement consistency and loss of clinically meaningful information.
- Review time and number of manual corrections.
- Weighted ASR errors for high-consequence token classes, plus ordinary word
  error rate.
- Peak resident memory and stage unload behaviour on the target M2/8 GB Mac.
- Search relevance on fixed keyword queries.

## Adversarial scenarios

- Names that are ordinary words, ambiguous places, initials, nicknames,
  misspellings, shared surnames, and repeated identifiers.
- Email signatures, quoted and forwarded messages, URLs, file paths, long
  transcripts, and hundreds of repeated matches.
- Rare diagnosis plus age, date, location, school, occupation, legal event, or
  distinctive incident.
- Silence, background noise, interruption, partial ASR results, stage failure,
  model cancellation, restart during expiry, and corrupt encrypted storage.
- Regex inputs of at least 100,000 characters shaped for worst-case matching.
- Egress payload edits, stale approvals, disallowed origins, redirect chains,
  retries, timeouts, and diagnostic errors.

## Release gates

- Every known direct identifier in the gold corpus is either detected or has a
  documented detector gap visible to the reviewer.
- The clinician can trace every transformation to its stages and decision.
- No clinical text appears in network traffic, operational logs, crash output,
  filenames, or unencrypted storage during security inspection.
- Audio and aligned source transcripts expire together after 30 days.
- Each model stage fits the measured memory budget and releases resources on
  completion, failure, and cancellation.
- Organisational information-governance approval precedes any trial with real
  clinical material; approved AI egress satisfies its separate activation gate.

## Non-goals

Regulatory certification, proof of anonymisation, clinical-outcome validation,
and evaluation on unapproved live records are outside this project.
