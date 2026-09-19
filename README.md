# Clinical Privacy Gateway

A local-first macOS tool for capturing clinical notes, detecting identifying
information, reviewing privacy transformations, and searching an encrypted
personal note library.

This repository contains the initial macOS shell and the architecture for a
personal, single-user tool. It is not a clinical product or an autonomous
anonymisation system.

## Current app shell

The first runnable build is **Clinician’s Veil**: a local-only welcome screen
with native macOS menus and build information. It deliberately has no clinical
material entry, microphone, persistence, model, or network capability yet.

### Run locally

Install a current Node.js LTS release and Rust, including the Apple Silicon
target when building on another platform. Then run:

```sh
npm ci
npm run tauri dev
```

The web interface can also be previewed without a native bridge with
`npm run dev`. It labels itself as a local development build in that mode.

### Pull requests and releases

Pull requests run formatting, linting, unit tests, and an arm64 production DMG
build on GitHub-hosted macOS. The `Quality gate` check is required before merge
to `main`.

Every successful push to `main` updates the **Latest main build** prerelease and
replaces its unsigned arm64 DMG. This is the stable download point for trying the
newest merged build. Versioned releases remain available: update the package
version and push a matching `vX.Y.Z` tag to create a permanent GitHub Release.
Both flows upload the DMG as a workflow artifact and a GitHub Release asset.

The DMG is intentionally unsigned and not notarised. On first use macOS may
block it; inspect the downloaded release, then use Finder’s **Open** action or
System Settings’ explicit **Open Anyway** control to launch it. Do not bypass
Gatekeeper for an artifact whose source or checksum you cannot verify.

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
