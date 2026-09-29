# Native Integration Architecture

## Tauri boundary

Use the Tauri 2.11 line with WKWebView. Expose the minimum command surface and
capabilities needed for capture, processing, review, persistence, search, and
the gated egress path. The web frontend receives serialisable domain views and
progress events; it never receives database keys or arbitrary filesystem and
network primitives.

Patient-document submission accepts a backend-owned preparation identifier,
not frontend-provided instructions or note text. The native egress adapter is
restricted to the configured `https://api.openai.com` origin, rejects redirects,
bounds request/response sizes and duration, and performs no automatic retries.
It uses the Responses API in the foreground with separate instructions and
input, `store: false`, no tools, and no conversation state. The adapter remains
unreachable while the governance-backed clinical-sending flag is false.

Document export commands use a native save picker and consume only the saved
reviewed revision. Word and PDF generation is local. Opaque document IDs are
the default filenames; patient names and clinical text never appear in paths.

Tauri commands are adapters into the plain Rust core. Long-running capture and
processing report progress through bounded channels and support cancellation.
Resources—microphone sessions, timers, model handles, streams, and temporary
files—are released at completion as well as on cancellation or failure.

Tauri's documented command mechanism supports frontend-to-Rust calls. Its
documented Swift plugin template targets iOS rather than macOS desktop, so the
desktop Swift link is a required spike rather than an assumed Tauri feature.
See [Tauri commands](https://v2.tauri.app/develop/calling-rust/) and
[plugin development](https://v2.tauri.app/develop/plugins/).

## Swift speech adapter

The Swift adapter owns only Apple-platform speech concerns:

- microphone/audio-buffer integration required by the Speech framework;
- SpeechDetector, SpeechAnalyzer, and SpeechTranscriber lifecycle;
- installation/status of locale-specific Apple model assets; and
- timestamped provisional and final transcript results.

It contains no privacy detection, transformation, retention, search, or egress
policy. Cross-language values remain small and explicit; stream audio within the
native boundary rather than serialising it through the webview.

The bridge spike must prove compilation, linking, cancellation, error mapping,
permissions, streaming transcript events, and release packaging on the target
M2 Mac before feature implementation proceeds.

## Other model adapters

NER and local-LLM adapters run in-process through Rust-compatible runtimes. They
may download or import model assets only through an explicit setup flow that
contains no clinical material. Pin model identity and checksum, support offline
use after provisioning, and expose load/unload boundaries to the core.

No Python runtime, Docker service, localhost HTTP server, or model daemon is
part of the application architecture.

The first text-review adapter is `crates/local-ner`. It statically links ONNX
Runtime; the DMG must not depend on a developer-installed runtime library.
Only its explicit asset installer has an HTTP client. It uses fixed pinned URLs,
validates every parsed redirect origin, bounds download sizes/timeouts, verifies
hashes before installation and removes its known partial files after failure or
on startup. The source-text command cannot accept a URL or model path.

The Tauri adapter owns one in-memory review and one cancellable operation. Copy
uses the backend-owned reviewed revision. Input and model errors are mapped to
content-free messages; progress events carry only stage/count/operation metadata.

## Development and packaging

- The primary macOS window is maximized from native setup, after AppKit has
  created it, preserving the macOS menu bar and dock rather than entering a
  separate full-screen space. Do not combine config-time centring and
  maximisation; that can leave the window offset from the available desktop.
- Use Safari Web Inspector for WKWebView debugging; enable development tools in
  development builds only.
- Configure rust-analyzer with a separate target directory and use `cargo check`
  for ordinary check-on-save work to reduce cache invalidation and memory use.
- Evaluate a faster linker in `.cargo/config.toml` when the codebase is
  scaffolded; keep platform-specific configuration documented.
- Build locally with ad-hoc signing for this single-machine tool. GitHub Actions
  validates pull requests and, after every successful push to `main`, updates a
  rolling `main-latest` prerelease with an arm64 DMG containing an ad-hoc-signed
  app. Tauri signs the completed bundle using `signingIdentity: "-"`, not just
  the executable's automatic linker signature. Both PR and release workflows
  mount the finished DMG read-only and verify its checksum and the enclosed
  bundle's signature before uploading. This checks integrity, not Apple trust;
  Gatekeeper acceptance requires Developer ID signing and notarisation.
  Matching `vX.Y.Z` tags create permanent versioned releases. The GitHub Release
  and workflow artifact are the distribution point for the target M2 Mac. The user must
  explicitly complete macOS’s Gatekeeper flow on first launch; Developer ID
  signing and notarisation remain deferred until broader distribution is required.

## Document adapters

The framework-independent core owns document formats, character/file limits,
original-file values and structured preview views. Native adapters own the
file chooser (`rfd`), bounded ZIP/XML parsing (`zip` and `quick-xml`), and PDFKit
extraction/rendering through `objc2-pdf-kit`. No Swift bridge, subprocess,
Python runtime, Office installation or network service is required.

Commands import from a native picker, release an import handle, open a saved
note or import preview, request one PDF page and close the preview. The webview
cannot supply filesystem paths. Import handles bind the patient and staged
original; detection validates that binding and warning acknowledgment before
creating a review. One cancellable operation is active at a time. PDFKit runs
on blocking workers with scoped autorelease pools and cancellation between
pages. A single native page operation cannot be interrupted mid-call; its
result is discarded if cancelled. PDF images are rendered on demand at a
bounded 400–1600-pixel requested width, without disk caches or active content.

Document settings return the supported priced model catalogue. Preparation accepts
an explicit per-document model and an optional existing document ID, validates
patient ownership, and returns that document ID and a local cost estimate alongside
the exact payload. Submission fixes Standard processing and a 4,096-token output
cap, captures usage even for incomplete or cancelled responses when available,
and returns restoration results with per-document costs. `document_usage` is a
read-only IPC query for local date bounds and an optional document ID. No command
accepts client-supplied billing rates, usage, or successful-report counts.
