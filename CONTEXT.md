# Clinical Privacy Gateway

This context describes the privacy transformation and clinician-controlled
handling of clinical material in a personal local tool.

## Clinical material

**Clinical material**:
Information captured during clinical work that may contain personal, health,
family, safeguarding, or professional information.
_Avoid_: Data, content

**Source text**:
The identifiable text typed or pasted by the clinician, extracted from an
imported document, or produced directly by transcription before privacy
transformation.
_Avoid_: Raw note, original note

**Original document**:
The exact imported text, Word, or PDF file, retained with its reviewed note in
the encrypted library. Editing extracted source text does not modify this file.
_Avoid_: Attachment copy, sanitised document

**Source audio**:
The recording from which a transcript was produced, retained temporarily so the
clinician can verify transcription accuracy.
_Avoid_: Voice note

**Dictation**:
Speaking into a text field through the microphone while the clinician holds or
latches the dictation control. Its audio exists only in memory until
transcribed; its final text becomes ordinary field text.
_Avoid_: Voice note, recording

**Provisional transcript**:
Interim recognition of speech that is still being spoken. It is shown as not yet
final and is never inserted, saved or sent.
_Avoid_: Draft text, live text

**Final transcript**:
The recognition of a completed utterance, inserted at the caret for the
clinician to check.
_Avoid_: Verified transcript

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

## Patient documents

**Document prompt template**:
Reusable clinician-authored instructions for creating one kind of patient
document. It contains a name, description, and instructions; it is not a
provider-hosted prompt or a form-field template.
_Avoid_: Workflow prompt, prompt preset

**Prepared submission**:
The exact, immutable instructions and pseudonymised reviewed-note input bound to
one model, destination, purpose, source-revision set, and payload digest before
an egress approval.
_Avoid_: Draft request, approved prompt

**Patient document**:
An independently saved patient record created from selected reviewed notes and
edited by the clinician. It is draft or reviewed and is not rewritten when its
source template or clinician profile changes.
_Avoid_: Generated note, AI report

**Local restoration**:
Single-pass replacement of recognised request-specific tokens with the exact
source details recorded for that submission. It never consults the saved
redaction library or infers a missing detail.
_Avoid_: Re-identification, de-tokenisation
