# Privacy and Security Architecture

## Trust model

Clinical material remains on the device throughout capture, transcription,
detection, transformation, review, persistence, and search. De-identification
is a defence-in-depth mechanism; the human review is the safety gate.

The system protects data at rest on a powered-off or stolen machine. It does not
claim to protect plaintext already visible in the memory or UI of a compromised,
unlocked system. FileVault remains complementary and expected.

## Data lifecycle

| Material                         | Retention                                  | Searchable | Egress eligible              |
| -------------------------------- | ------------------------------------------ | ---------- | ---------------------------- |
| Original document and filename | Until its reviewed note is deleted | No | Never |
| Saved source text                | Until its reviewed note is deleted         | No         | Never                        |
| Recorded source audio            | Encrypted for 30 days after note creation  | No         | Never                        |
| Original aligned transcript      | Encrypted for the same 30 days             | No         | Never                        |
| Reviewed note                    | Until explicit deletion                    | Yes        | Only through the egress gate |
| Detection provenance             | Encrypted with the reviewed note           | No         | No                           |
| Patient-specific saved redaction | Until its patient is deleted               | No         | Never                        |
| All-patients saved redaction     | Retained; no deletion path in this release | No         | Never                        |
| Operational diagnostics          | Content-free and minimal                   | No         | Non-content metadata only    |
| Document prompt templates        | Until archived; editable and restorable    | No         | Only inside reviewed payload |
| Patient document revisions       | Until document or patient deletion         | No         | Never automatically          |
| Submission/restoration records   | With their patient document                | No         | Never                        |
| Clinician profile and signature  | Until replaced or removed                  | No         | Never                        |

Expiry removes source audio, the original aligned transcript, alignment data,
and any derived temporary files as one operation. Deleting a note removes its
encrypted original document, source text, reviewed text, review record, and search entries together.

## Storage encryption and keys

Use one SQLCipher database in Application Support for notes, provenance, FTS5,
and audio. Generate a random 32-byte database key at first launch and store it
in Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, which makes it
available only while the device is unlocked and prevents migration to another
device. See [Apple's accessibility documentation](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly).

Secure Enclave wrapping is a technical spike, not a claim that the database key
never enters application memory. The enclave can protect a wrapping or
key-agreement private key, but SQLCipher requires usable key material in process
memory while opening the database. Minimise that lifetime and avoid copies.

Loss of the device-bound key makes the database unrecoverable. The UI must make
that consequence clear before backup or migration features are considered.

## Egress gate

External AI is unavailable until a named use case, destination, data-processing
terms, and organisational approval have been recorded. Enabling it does not
create standing consent.

Every submission must:

1. originate from a reviewed-note revision;
2. display the exact payload and destination;
3. require a fresh affirmative action;
4. bind approval to a digest of that payload and revision;
5. cancel if the payload changes; and
6. record content-free outcome metadata inside the encrypted database.

For patient-document generation, the core replaces eligible reviewed
placeholder spans with request-specific tokens derived from saved review
provenance. Exact local restoration uses only that submission's token map. It
does not perform broad replacement from the saved-redaction library. Kept text
is authoritative; removed and generalised details are not reconstructed.

Provider credentials use a separate Keychain item. The encrypted database key,
provider credential, clinical material, source metadata, token map, clinician
profile, and signature have separate lifecycles and are never combined in logs.
Recording a credential does not enable clinical sending.

Redirects must not bypass destination validation. Validate each parsed origin
and each redirect hop before sending. Raw source text, source audio, original
transcripts, identifier mappings, and detection provenance are never eligible.

## Diagnostics and failure behaviour

- Operational logs contain event names, durations, counts, and opaque local
  IDs—not clinical text, model prompts, replacements, paths containing names,
  clipboard contents, or model output.
- Remote telemetry and crash reporting are absent by default. A future
  diagnostic export must be local, explicit, scrubbed, previewable, and
  deletable.
- Processing uses memory where practical. Temporary files use the protected app
  container and are deleted on success, cancellation, startup recovery, and
  failure.
- Unavailable or failed detection stages make uncertainty visible and block any
  claim that the privacy review is complete. Saving a draft may remain possible;
  egress does not.
- Clipboard export warns that third-party clipboard managers may retain data;
  optional timed clearing must never erase unrelated newer clipboard contents.

## Governance language

The application presents detections and residual risks, never a percentage
privacy score. It describes output as reviewed and de-identified or
pseudonymised, not anonymous, GDPR safe, compliant, or approved.

Before real clinical use, the clinician must follow the employing organisation's
information-governance route. Pseudonymised health data remains personal data.

## Imported documents

Import and preview use memory only. Original bytes and the basename are saved
in SQLCipher in the same transaction as the note and review record. External
paths are not persisted. A note has at most one original; it is never modified
by source-text edits or note review. Originals and filenames are excluded from
FTS and egress. PDFKit renders inert page images, while Word/text previews are
structured text nodes. Neither path follows document links, external XML
relationships, scripts, actions or embedded objects. No plaintext preview
files or browser persistence are created. Native handles and buffers are
released on success, discard, cancellation, failure and window destruction.

Model selection and usage accounting are local. The curated model selector does
not enable egress or imply that every model is organisationally approved. A
per-document choice is frozen into the prepared submission; changing Settings'
default affects only subsequent documents. Preparation estimates use local
bytes, never a provider token-counting endpoint. Prices and content-free usage
receipts remain in SQLCipher. Accounting totals survive deletion after their
link to the document is cleared; clinical material and patient metadata do not.
