# Privacy and Security Architecture

## Trust model

Clinical material remains on the device throughout capture, transcription,
detection, transformation, review, persistence, and search. De-identification
is a defence-in-depth mechanism; the human review is the safety gate.

The system protects data at rest on a powered-off or stolen machine. It does not
claim to protect plaintext already visible in the memory or UI of a compromised,
unlocked system. FileVault remains complementary and expected.

## Data lifecycle

| Material | Retention | Searchable | Egress eligible |
| --- | --- | --- | --- |
| Pasted source text | Active review session only | No | Never |
| Recorded source audio | Encrypted for 30 days after note creation | No | Never |
| Original aligned transcript | Encrypted for the same 30 days | No | Never |
| Reviewed note | Until explicit deletion | Yes | Only through the egress gate |
| Detection provenance | Encrypted with the reviewed note | No | No |
| Operational diagnostics | Content-free and minimal | No | Non-content metadata only |

Expiry removes source audio, the original aligned transcript, alignment data,
and any derived temporary files as one operation. Deleting a note removes all
of its retained material and search entries.

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
