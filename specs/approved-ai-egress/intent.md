# Approved AI Egress Intent

**Status:** Specified but blocked

## Intent

Define the only route by which reviewed clinical text may leave the device,
without enabling that route before it has a justified purpose and governance
approval.

## Activation gate

Implementation and use remain blocked until all of the following are recorded:

- a concrete task that local processing cannot adequately perform;
- the approved provider, endpoint, model, and data-processing terms;
- the employing organisation's information-governance approval;
- retention, training-use, regional-processing, and contractual answers; and
- an acceptance and rollback plan.

## Intended user outcome

Once activated, the clinician can inspect the exact reviewed payload and approve
one submission to the named service for the named purpose.

## Required behaviour

- Start from a completed, current reviewed-note revision.
- Show the exact payload, destination, model, and purpose before submission.
- Require a fresh affirmative action for every payload.
- Bind approval to a payload digest and invalidate it on any edit.
- Disable automatic redirect following and validate the parsed origin of every
  destination and redirect hop.
- Return the response for clinician review without writing it into the clinical
  record automatically.
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

Automatic note polishing in the cloud, workflow prompt templates, reflective
practice analysis, batch or background submission, provider selection by the
model, and standing consent are outside this intent.
