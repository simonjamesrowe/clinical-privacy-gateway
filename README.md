# Clinical Privacy Gateway

A local-first macOS tool for capturing clinical notes, detecting identifying
information, reviewing privacy transformations, and searching an encrypted
personal note library.

This repository contains the macOS app, an in-memory text-review workspace, and
the architecture for a personal, single-user tool. It is not a clinical product
or an autonomous anonymisation system.

## Current app

**Clinician’s Veil** opens with a welcome screen, native macOS menus and build
information. Choose **De-identify text** to type or paste source text (up to
20,000 characters). Download the English BERT NER model once (~110 MB), then
process text offline using local rules and the embedded model.

Review highlighted proposals alongside the source. Accept, edit a placeholder,
keep or remove each group; separate same-name occurrences when they refer to
different people. Select missed phrases to add manual replacements. Complete the
final local check before using **Copy reviewed text**. Discard or return Home to
clear the session. Nothing is saved apart from the downloaded model files.

The local Llama contextual sweep and cleanup are not included yet. Initials,
partial organisations, file paths and indirect identifying combinations require
manual attention. No detections is not proof of de-identification. See the
[feature scope](specs/text-review/intent.md) and
[synthetic evaluation](docs/evaluation/text-review.md) before use. Clipboard
managers may retain copied text. Use synthetic material until the required
organisational and target-device validation has been completed.

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
replaces its arm64 DMG containing an ad-hoc-signed app. This is the stable
download point for trying the newest merged build. Versioned releases remain
available: update the package version and push a matching `vX.Y.Z` tag to create
a permanent GitHub Release.
Both flows upload the DMG as a workflow artifact and a GitHub Release asset.

The app bundle is ad-hoc signed before packaging, and both workflows mount the
finished DMG read-only and verify its integrity and the enclosed app's signature
before uploading it. A linker-signed executable alone is not a valid signature
for the completed app bundle and can produce macOS's misleading “damaged” error.

Ad-hoc signing does not establish an Apple-verified developer identity. The DMG
is not notarised, so macOS may still block first launch. After verifying the
release's source and checksum, follow Apple's [Open Anyway instructions](https://support.apple.com/en-gb/102445)
in System Settings → Privacy & Security. Do not disable Gatekeeper globally.
Developer ID signing and notarisation are needed for a normal verified download
without that manual exception; they require Apple Developer credentials in CI.

To run the same packaging check locally after a release build:

```sh
bash scripts/verify-macos-dmg.sh target/aarch64-apple-darwin/release/bundle/dmg/*.dmg
```

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
