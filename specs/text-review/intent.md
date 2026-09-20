# In-memory Text Review

**Status:** Initial implemented slice; synthetic evaluation only

## Intent

Provide a patient-first **De-identify text** page for pasted or typed source text,
with optional encrypted reviewed-note saving and no external AI service. Keep
human review explicit.
This slice implements part of the wider detection, transformation and review
intents; it does not claim those first-release intents are all complete.

## Included behaviour

- Up to 20,000 Unicode characters, validated in the interface and Rust core.
- Explicit one-time download of a pinned English BERT NER model (~110 MB), with
  progress, cancellation, byte-size checks and SHA-256 verification. Only model
  files are requested; source text is not part of any network request.
- Local rules for emails, UK phone numbers, postcodes, checksum-valid NHS
  numbers (and labelled NHS-shaped values), address leads, NI numbers, URLs,
  explicit dates and labelled case references.
- In-process token classification through ONNX Runtime. The whole input is
  encoded before splitting into overlapping 512-token windows. Partial-word
  detections expand to the lexical word so leftover letters are not exposed.
- Side-by-side source and proposed result with linked, keyboard-accessible
  highlights and detection provenance. Every proposal begins pending.
- Exact repeated phrases in one category share a placeholder within this
  session. Individual occurrences can be separated when names are shared.
  Aliases, nicknames and relationships are not automatically reconciled.
- The clinician starts each new note by selecting a patient. They can explicitly
  save an accepted or edited exact phrase/category mapping for all patients or
  only that patient. A patient mapping takes precedence over a global mapping.
  Saved mappings apply as accepted on a new note; the clinician can choose
  **Review saved mappings** before analysis to leave those matches pending.
- Accept, edit the bracketed placeholder, keep, or remove. Select any missed
  source phrase to open a contextual **Add to review** menu beside the
  selection. Unapplied label edits block copying.
- Placeholder typing uses uppercase. Leaving the field supplies brackets and
  converts word separators to underscores (for example `case manager` becomes
  `[CASE_MANAGER]`). Empty labels restore the existing proposal; labels beginning
  with a number receive `LABEL_`. Overlong labels have an inline error rather
  than being silently truncated. Applying a label remains an explicit decision.
- A sticky stage tracker shows Verify model → Analyse → Review → Final check,
  with measured download/window progress or an indeterminate loading indicator.
  Cancellation and failures never mark a stage complete. Review cards are pastel
  yellow while pending or carrying an unapplied edit, and pastel green once a
  decision is made, with text status labels alongside colour. Green describes
  a decision, not a privacy guarantee; deliberately kept details remain explicit.
- A final local rules + NER check of the proposed result, masking only generated
  placeholders. Kept items remain visible as deliberate retained details. New
  findings return to pending; changing a decision invalidates the final check.
- **Copy reviewed text** is gated by the native session ID, revision, resolved
  proposals and successful final check. The command accepts no caller-supplied
  output. Copying warns that clipboard managers may retain the result.
- Discard, returning Home, or closing the window clears the session. Cancelling
  detection retains the editor input for retry; it does not produce a partial
  successful review. Stale results cannot replace a discarded session.
- Review presents one unresolved group in a focused wizard above the source and
  proposed-text panes. Each decision advances to the next group, keeps the
  placeholder field ready for keyboard input, and updates a progress bar with
  actions remaining. The current group has a distinct linked highlight in both
  text panes and is centred by changing only their own scroll positions, so the
  wizard stays in view. Previous and next controls let the clinician revisit a
  reviewable decision, including an already resolved or automatically applied
  mapping. Selecting a highlighted source or result occurrence opens its group
  in the wizard for editing. Resolving the final action starts the final local
  check automatically and shows its progress overlay; new findings return to
  the wizard. Reviewed-note actions appear above the text panes and in the
  footer. Resolved groups stay in a collapsed history and can be reopened before
  the final check. Long operations use a content-free local progress overlay and
  expose cancellation only when the native operation can be cancelled.
- A passed final check can save a note with a required title and selected
  patient. The encrypted record retains original text, reviewed text, and the
  complete review state so it can reopen in the same editable workspace. Notes
  can be searched, copied, and deleted from the encrypted library.

## Privacy boundary and exclusions

Before a note is saved, pasted source text and source detections are memory-only.
The saved original text, reviewed text, title/reference, review provenance, and
explicitly saved mappings live only in the encrypted local database. Original
text, provenance, and mappings are excluded from search and never eligible for
egress. No browser storage, source files, model prompt logs,
telemetry or remote inference are introduced. Downloaded model assets remain in
Application Support. Memory-only source handling does not promise secure erasure
from OS swap, clipboard managers or a compromised device. OS-level text
selection/copy is not the reviewed-copy command.

The Llama 3.2 1B contextual sweep and cleanup remain future stages. File paths,
indirect identifying combinations, roles, generalisation, multilingual coverage,
transcription, file export and external AI are not implemented here.
The interface names these gaps and asks the clinician to review unmarked text.

## Verification

Core and adapter tests cover overlap/grouping, Unicode offsets, repeated names,
revision/copy gates, cancellation, missing/corrupt models and hostile long regex
input. Interface tests cover review states, draft labels, errors, disposal,
manual selection and rendering source text without HTML interpretation.

The [synthetic evaluation](../../docs/evaluation/text-review.md) records the
pinned model, corpus, recall/gaps and measured runtime costs. Target M2/8 GB and
organisational information-governance validation remain gates before clinical use.
