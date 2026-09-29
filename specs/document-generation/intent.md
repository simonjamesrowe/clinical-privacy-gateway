# Patient Document Generation Intent

**Status:** Local workflow implemented; external generation blocked

## Intent

Let a clinician create a patient-centred document from selected completed
reviewed notes while keeping identifying details, clinician details, signature,
and restoration records on this Mac.

## Intended user outcome

The clinician chooses saved notes and a document prompt template, inspects the
exact pseudonymised submission, explicitly sends it to the configured OpenAI
model once governance requirements are met, reviews the locally restored
result, edits it, and saves or exports a reviewed document.

## Required behaviour

- Seed editable GP letter, referral letter, and progress report templates.
- Restrict source selection to completed notes belonging to the document's
  patient and preserve their order.
- Build submissions from saved reviewed text and its review snapshot in the
  Rust core. Existing **Keep** decisions remain unchanged.
- Exchange eligible replacement spans for request-specific tokens. Bind every
  token to exactly one source item and restore only recognised exact tokens in
  one pass.
- Leave removed and generalised details absent. Present unknown or altered
  returned tokens for resolution or explicit removal before review.
- Bind a prepared submission to exact instructions, note revisions, template
  version, model, destination, purpose, and payload digest. It is single-use.
- Keep prompt-template instructions within the exact outgoing-payload review.
- Persist document revisions, source links, submitted/returned text,
  restoration data, profile snapshots, and content-free outcomes in SQLCipher.
- Save clinician details and signature with a reviewed revision so later
  profile changes cannot rewrite it.
- Keep restored document bodies and signatures out of note search.

## Activation gate

The local template, settings, document, preparation, and restoration seams may
exist before external generation is activated. No command may load selected
note text or construct an outbound request while clinical sending is disabled.
An API key and model alone never activate clinical sending.

Activation additionally requires every item in
[Approved AI Egress](../approved-ai-egress/intent.md), including the approved
OpenAI endpoint, model and applicable data controls.

## Document format

Documents use a constrained block format: headings, paragraphs, bold runs, and
bulleted lists. It cannot represent executable HTML, scripts, remote images, or
external resources. Word and PDF exporters consume this format locally and use
an A4 layout. A signature block is appended locally and kept together across
page breaks.

## Safety invariants

- Patient metadata, note titles, source snapshots, review provenance,
  restoration mappings, clinician details, signatures, and API keys never enter
  the provider request.
- Clinical strings and signature bytes do not appear in operational logs,
  errors, telemetry, filenames, or debug formatting.
- No automatic retries, redirects, silent truncation, background generation,
  tools, conversation history, or provider-side response storage.
- Documents are described as reviewed and de-identified or pseudonymised,
  never anonymous, safe, compliant, or approved.

## Current limitations

External submission, rich document editing, signature drawing, and Word/PDF
export remain unavailable while clinical sending is blocked. The screens make
that state explicit and the native command fails closed before clinical text is
read.

## Success criteria

- Repeated visible labels and distinct people receive distinct request tokens.
- Unicode originals restore exactly; literal bracketed text stays untouched.
- Removed/generalised details never reappear and altered tokens remain visible.
- Token scanning is bounded on at least 100,000 characters.
- Template/profile changes do not mutate an existing document revision.
- Deleting a patient removes all documents; deleting a source note detaches its
  source record and removes prepared restoration material while retaining the
  document warning.

## Model selection and costs

- Settings stores a supported default model. New documents copy that selection;
  per-document changes never update the Settings default. Unsupported legacy
  selections stay visible and require an explicit replacement, never a fallback.
- The initial curated options are pinned GPT-4.1 mini and GPT-4.1 snapshots.
  Mini is the lower-cost starting selection, not a claim of clinical validation.
  Provider access and organisational approval must cover each selected model.
- Before sending, show a local estimate for the exact prepared instructions and
  notes. Use UTF-8 byte length plus a message-framing allowance and 4,096 output
  tokens, at uncached Standard rates. Label it an estimate, not a billing quote.
  No token-counting request or clinical-content egress happens for estimation.
- Record each consumed preparation as one generation attempt before the network
  request; duplicate submission cannot duplicate accounting. Capture the price
  snapshot at that point and calculate cost from returned input, cached-input,
  and output usage. Output usage already includes any reasoning tokens.
- Missing, invalid or unfamiliar usage/pricing is **Cost unknown**, including
  timeouts. Billable failures and discarded results still contribute to spend.
  Historical prices and costs do not change when the model catalogue changes.
- A report counts once on its first successful generation; generating it again
  adds an attempt and cost but not another report. Empty/manual drafts, edits,
  saves, copies and exports do not increase generated-report counts.
- Settings shows This month (local calendar boundaries) and All time totals for
  reports, attempts, estimated spend and average spend per report. Unknown costs
  are shown separately; averages are unavailable when costs are incomplete.
- Patient document lists show latest-attempt and cumulative costs. Totals are in
  USD and describe this installation only, not the whole OpenAI account bill.
- Content-free accounting survives document/patient deletion with the document
  link cleared. It never retains names, titles, source text, prompts or output.

Pricing sources, checked 28 September 2026:
[GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini),
[GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), and
[Responses usage](https://developers.openai.com/api/reference/cli/resources/responses/methods/retrieve).
Standard USD rates per million tokens are respectively 0.40/0.10/1.60 and
2.00/0.50/8.00 for uncached input/cached input/output. Rates are bundled; updating
prices requires a catalogue update and does not recalculate prior receipts.
