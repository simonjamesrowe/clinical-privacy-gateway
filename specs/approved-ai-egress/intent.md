# Approved AI Egress Intent

**Status:** Document-generation use case named; governance activation blocked

## Intent

Define the only route by which reviewed clinical text may leave the device,
without enabling that route before it has a justified purpose and governance
approval.

## Activation gate

External submission remains blocked until all of the following are recorded:

- a concrete task that local processing cannot adequately perform;
- the approved provider, endpoint, model, and data-processing terms;
- the employing organisation's information-governance approval;
- retention, training-use, regional-processing, and contractual answers; and
- an acceptance and rollback plan.

## Intended user outcome

Once activated, the clinician can inspect the exact reviewed payload and approve
one submission to the named service for the named purpose.

The first named use case is generation of a patient document from selected
completed reviewed notes, as specified in
[Patient Document Generation](../document-generation/intent.md). The destination
is the configured OpenAI Responses API endpoint. The model, data-processing
terms, organisational approval, and retention controls remain outstanding.

## Required behaviour

- Start from a completed, current reviewed-note revision.
- Show the exact payload, destination, model, and purpose before submission.
- Require a fresh affirmative action for every payload.
- Bind approval to a payload digest and invalidate it on any edit.
- Disable automatic redirect following and validate the parsed origin of every
  destination and redirect hop.
- Use separate application instructions and reviewed-note input with
  `store: false`, no tools, no conversation history, and foreground generation.
- Return the response for local restoration and clinician review without
  marking it reviewed or writing it into the clinical record automatically.
- Store content-free submission time, destination, purpose, digest, and outcome
  in the encrypted database.

## Safety invariants

- The default and remembered state is no submission.
- Raw source text, audio, original transcripts, detection provenance, and
  identifier mappings are ineligible for payload construction.
- Approval is never inferred from saving, copying, a prior approval, or a global
  preference.
- Network errors do not trigger an automatic retry that outlives the displayed
  approval attempt.

## Success criteria before activation

- With egress disabled, no clinical-content request can be produced even when a
  provider credential is present.
- Payload mutation, destination mutation, expiry, cancellation, and redirect to
  a disallowed origin all invalidate or block submission.
- Tests prove that request and error logging contain no payload fragments.

## Non-goals

Automatic note polishing in the cloud, reflective practice analysis, batch or
background submission, provider selection by the model, and standing consent
are outside this intent.
