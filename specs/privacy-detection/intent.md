# Privacy Detection Intent

**Status:** Planned for the first release

## Intent

Find direct identifiers and combinations of indirect details locally, explain
why they matter, and favour a reviewable false positive over silent disclosure.

## User outcome

The clinician receives one coherent list of possible identifiers with visible
evidence, suggested actions, and the stage or stages that found each item.

## Included behaviour

- Deterministic recognition of structured identifiers, including checksum
  validation where available.
- Embedded NER for people, relationships, locations, organisations, facilities,
  dates, and professional roles.
- A local LLM sweep for residual free-text leakage and identifying combinations.
- Merging of repeated and overlapping detections without losing provenance.
- A final local rescan after clinician edits.
- Content-free aggregate metrics for local evaluation; detailed provenance stays
  encrypted with the note.

A detection records a stable ID, evidence location, category/subtype,
confidence, contributing stages, explanation, proposed action, and review state.

## Safety invariants

- Detection runs without submitting clinical material to a service or sidecar.
- A stage that fails is shown as unavailable; its absence does not produce a
  successful privacy status.
- Contextual warnings are recommendations, not legal or clinical conclusions.
- The system never claims that zero detections means anonymous text.
- Rules over unbounded input are mechanically bounded and stress-tested.

## Success criteria

- Synthetic cases exercise names, aliases, initials, NHS numbers, phone numbers,
  emails, postcodes, dates, URLs, organisations, locations, and case references.
- Synthetic combinations exercise rare diagnoses, exact age/date/location,
  unusual incidents, occupations, schools, legal details, and safeguarding
  narratives.
- The evaluation reports recall, false-negative rate, false-positive rate, stage
  contribution, and failures rather than a single privacy score.
- Every regex suite completes on a shaped input of at least 100,000 characters
  without stack exhaustion or catastrophic backtracking.

## Dependencies and decision gates

Select the token-classification model and Rust-compatible runtime using the
synthetic gold corpus. Presidio is a design reference, not a runtime dependency.

## Non-goals

Guaranteed anonymisation, automated disclosure decisions, face/image redaction,
and use of live patient records for model training are outside this release.
