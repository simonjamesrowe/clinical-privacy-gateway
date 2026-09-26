# Clinical Privacy Gateway

This context describes the privacy transformation and clinician-controlled
handling of clinical material in a personal local tool.

## Clinical material

**Clinical material**:
Information captured during clinical work that may contain personal, health,
family, safeguarding, or professional information.
_Avoid_: Data, content

**Source text**:
The identifiable text pasted by the clinician or produced directly by
transcription before privacy transformation.
_Avoid_: Raw note, original note

**Source audio**:
The recording from which a transcript was produced, retained temporarily so the
clinician can verify transcription accuracy.
_Avoid_: Voice note

**Reviewed note**:
The clinician-approved text saved to the note library after transcription,
privacy transformation, and manual editing.
_Avoid_: Clean note, safe note, anonymised note

## Privacy transformation

**Identifier**:
A direct or indirect detail that may identify a person alone or in combination
with other details.
_Avoid_: PII token

**Detection**:
A located span or contextual combination presented as a possible identifier,
with its category, provenance, confidence, rationale, and proposed action.
_Avoid_: Finding, match

**Redaction**:
Removal of identifying information without a replacement that preserves its
role.
_Avoid_: Deletion

**Saved redaction**:
A clinician-approved rule, saved during review, that applies the same
replacement to an exact phrase and category in new notes for one patient or for
all patients. A patient's saved redaction takes precedence over an
all-patients one.
_Avoid_: Mapping, default

**Pseudonymisation**:
Consistent replacement of identifying information with meaningful labels or
aliases while retaining enough structure for clinical use.
_Avoid_: Anonymisation, masking

**De-identification**:
Reduction of information that could reasonably identify a person, including
redaction, pseudonymisation, and generalisation.
_Avoid_: Anonymisation, sanitisation

**Generalisation**:
Replacement of a precise detail with a less identifying but clinically useful
description, such as an exact date with relative timing.
_Avoid_: Redaction

**Residual risk**:
The possibility that remaining details, especially in combination, could still
identify someone after privacy transformation.
_Avoid_: Privacy score

## Clinician control

**Review decision**:
The clinician's item-level choice to accept, edit, keep, or remove a proposed
transformation.
_Avoid_: Approval

**Reviewed payload**:
The exact text displayed for inspection immediately before an external
submission.
_Avoid_: Safe payload, anonymised payload

**Egress approval**:
A fresh affirmative action authorising one reviewed payload to leave the
device for one named destination and purpose.
_Avoid_: Consent, preference
