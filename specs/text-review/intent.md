# In-memory Text Review

**Status:** Initial implemented slice; synthetic evaluation only

## Intent

Provide a separate **De-identify text** page for pasted or typed source text,
without saving notes or adding an external AI service. Keep human review explicit.
This slice implements part of the wider detection, transformation and review
intents; it does not claim those first-release intents are all complete.

## Included behaviour

- Up to 20,000 Unicode characters, validated in the interface and Rust core.
- Explicit one-time download of a pinned English BERT NER model (~110 MB), with
  progress, cancellation, byte-size checks and SHA-256 verification. Only model
  files are requested; source text is not part of any network request.
- Local rules for emails, UK phone numbers, postcodes, checksum-valid NHS
  numbers, NI numbers, URLs, explicit dates and labelled case references.
- In-process token classification through ONNX Runtime. The whole input is
  encoded before splitting into overlapping 512-token windows. Partial-word
  detections expand to the lexical word so leftover letters are not exposed.
- Side-by-side source and proposed result with linked, keyboard-accessible
  highlights and detection provenance. Every proposal begins pending.
- Exact repeated phrases in one category share a placeholder within this
  session. Individual occurrences can be separated when names are shared.
  Aliases, nicknames and relationships are not automatically reconciled.
- Accept, edit the bracketed placeholder, keep, or remove. Select any missed
  source phrase to add a manual proposal. Unapplied label edits block copying.
- A final local rules + NER check of the proposed result, masking only generated
  placeholders. Kept items remain visible as deliberate retained details. New
  findings return to pending; changing a decision invalidates the final check.
- **Copy reviewed text** is gated by the native session ID, revision, resolved
  proposals and successful final check. The command accepts no caller-supplied
  output. Copying warns that clipboard managers may retain the result.
- Discard, returning Home, or closing the window clears the session. Cancelling
  detection retains the editor input for retry; it does not produce a partial
  successful review. Stale results cannot replace a discarded session.

## Privacy boundary and exclusions

Source text, detections and placeholder mappings are memory-only. No note
database, browser storage, source files, model prompt logs, telemetry or remote
inference are introduced. Downloaded model assets remain in Application Support.
Memory-only does not promise secure erasure from OS swap, clipboard managers or a
compromised device. OS-level text selection/copy is not the reviewed-copy command.

The Llama 3.2 1B contextual sweep and cleanup remain future stages. File paths,
indirect identifying combinations, roles, generalisation, multilingual coverage,
transcription, saved notes, file export and external AI are not implemented here.
The interface names these gaps and asks the clinician to review unmarked text.

## Verification

Core and adapter tests cover overlap/grouping, Unicode offsets, repeated names,
revision/copy gates, cancellation, missing/corrupt models and hostile long regex
input. Interface tests cover review states, draft labels, errors, disposal,
manual selection and rendering source text without HTML interpretation.

The [synthetic evaluation](../../docs/evaluation/text-review.md) records the
pinned model, corpus, recall/gaps and measured runtime costs. Target M2/8 GB and
organisational information-governance validation remain gates before clinical use.
