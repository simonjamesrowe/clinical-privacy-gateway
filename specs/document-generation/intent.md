# Patient Document Generation Intent

**Status:** Local workflow implemented; external generation governance-gated

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
- Edit template metadata on the left and Markdown instructions in a large rich
  text editor on the right; support headings, bold, italic and lists with a
  source view. Rendering never instantiates HTML, links or remote images.
- Divide Settings into connection, generation, clinician, signature and usage
  sections. Draw or type a signature, undo strokes, replace or remove it; save
  changes explicitly and preserve signatures already saved with documents.
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
Settings provides four explicit local confirmations for these requirements.
All must be selected in one action; removing the key or changing the saved key
or default model disables sending and requires a fresh confirmation.

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
- The API key is retrieved from Keychain at most once per app process and kept
  only in a process-memory session cache; explicit removal clears both copies.
- Clinical strings and signature bytes do not appear in operational logs,
  errors, telemetry, filenames, or debug formatting.
- No automatic retries, redirects, silent truncation, background generation,
  tools, conversation history, or provider-side response storage.
- Documents are described as reviewed and de-identified or pseudonymised,
  never anonymous, safe, compliant, or approved.

## Current limitations

External submission remains unavailable until clinical sending is explicitly
enabled. Rich generated-document editing and Word/PDF export remain incomplete.
Template rich text and local signature editing are available independently of
the gate. The screens make the state explicit and the native command fails
closed before clinical text is read.

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
- The curated options include GPT-6 Luna, Sol and Astra, GPT-5.6 Luna, pinned
  GPT-5.4 mini and the existing pinned GPT-4.1 mini / GPT-4.1 snapshots.
  GPT-6 Luna is the lowest-cost initial selection; existing defaults are retained.
  This is not a claim of clinical validation.
  Provider access and organisational approval must cover each selected model.
- Before sending, show a local estimate for the exact prepared instructions and
  notes. Use UTF-8 byte length plus a message-framing allowance and 4,096 output
  tokens, at uncached Standard rates. Include a cache-write allowance for GPT-6
  and GPT-5.6, and apply their long-context multipliers above 272,000 input
  tokens (2× input, 1.5× output). Label it an estimate, not a billing quote.
  No token-counting request or clinical-content egress happens for estimation.
- Record each consumed preparation as one generation attempt before the network
  request; duplicate submission cannot duplicate accounting. Capture the price
  snapshot at that point and calculate cost from returned input, cached-input,
  and output usage. Output usage already includes any reasoning tokens.
- Request no reasoning for GPT-6 Luna/Sol, GPT-5.6 Luna and GPT-5.4 mini; use
  the supported minimum (low) for GPT-6 Astra. The output cap includes reasoning.
- Missing, invalid or unfamiliar usage/pricing is **Cost unknown**, including
  timeouts and nonzero cache-write token usage that cannot yet be priced from
  the receipt. Billable failures and discarded results still contribute to spend.
  Historical prices and costs do not change when the model catalogue changes.
- A report counts once on its first successful generation; generating it again
  adds an attempt and cost but not another report. Empty/manual drafts, edits,
  saves, copies and exports do not increase generated-report counts.
- Settings shows This month (local calendar boundaries) and All time totals for
  reports, attempts, estimated spend and average spend per report. Unknown costs
  are shown separately; averages are unavailable when costs are incomplete.
- Patient document lists show latest-attempt and cumulative costs. Totals are in
  USD and describe this installation only, not the whole OpenAI account bill.
- The global Documents library searches title, patient identity and template,
  and opens the owning patient's Documents tab. New-document actions on the
  welcome page and global library first ask the clinician to choose a patient.
- Content-free accounting survives document/patient deletion with the document
  link cleared. It never retains names, titles, source text, prompts or output.

Pricing sources, checked 29 September 2026:

| Model | Input / cached input / output, USD per million |
| --- | --- |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 0.10 / 0.01 / 0.50 |
| [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) | 2.00 / 0.20 / 10.00 |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) | 10.00 / 1.00 / 50.00 |
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 0.20 / 0.02 / 1.20 |
| [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | 0.75 / 0.075 / 4.50 |
| [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) | 0.40 / 0.10 / 1.60 |
| [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) | 2.00 / 0.50 / 8.00 |

Standard rates are bundled; updating prices does not recalculate prior receipts.
GPT-6 and GPT-5.6 aliases can evolve upstream; the chosen ID and local price
snapshot remain attached to each preparation and attempt. Access depends on the
configured OpenAI project; the selector does not claim account availability.

Local testing examples: [synthetic kit](../../test-data/synthetic/README.md).
