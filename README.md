# Clinical Privacy Gateway

A local-first macOS tool for capturing clinical notes, detecting identifying
information, reviewing privacy transformations, and searching an encrypted
personal note library.

This repository is currently documentation-only. It describes a personal,
single-user tool, not a clinical product or an autonomous anonymisation system.

## First release

The intended first release combines:

- pasted text and microphone dictation;
- on-device transcription with source audio retained temporarily for checking;
- deterministic, named-entity, and contextual privacy detection;
- role-preserving pseudonymisation and clinician-controlled cleanup;
- explicit review of every proposed transformation;
- encrypted note storage and local keyword search; and
- a designed, but governance-gated, route for approved external AI use.

Clinical content stays on the device unless the clinician reviews a specific
payload and explicitly approves that individual submission. De-identification
reduces risk; it does not make a document anonymous or establish legal
compliance.

## Documentation

- [Architecture](docs/architecture.md) is the authoritative system design and
  decision index.
- [Domain language](CONTEXT.md) defines the terms used throughout the project.
- Feature intentions live in [`specs/`](specs/).
- The [original product brief](docs/reference/local-clinical-ai-privacy-gateway-mvp.md)
  is preserved as source material. Curated architecture and feature intents
  supersede it where the scope differs.

## Safety boundary

Only synthetic clinical material belongs in source control, tests, examples,
issues, or pull requests. Use of real patient information requires prior
approval from the relevant employing organisation's information-governance
route; this project does not provide that approval.

## Licence

Licensed under the [Apache License 2.0](LICENSE).
