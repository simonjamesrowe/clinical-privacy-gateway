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

Document export commands use a native save picker and consume only a saved
document revision loaded by opaque ID. PDF generation is local; exported drafts
carry a visible `DRAFT — NOT YET REVIEWED` marker. The configured header,
clinician details and selected signature are added after generation and never
enter the provider request. Opaque document IDs are the default filenames;
patient names and clinical text never appear in paths. Word export is pending.

Tauri commands are adapters into the plain Rust core. Long-running capture and
processing report progress through bounded channels and support cancellation.
Resources—microphone sessions, timers, model handles, streams, and temporary
files—are released at completion as well as on cancellation or failure.
Dictation streams its events over a per-recording channel instead.

Tauri's documented command mechanism supports frontend-to-Rust calls. See
[Tauri commands](https://v2.tauri.app/develop/calling-rust/) and
[calling the frontend](https://v2.tauri.app/develop/calling-frontend/) for
per-call channels.

## Speech adapter

Dictation uses Whisper in-process rather than SpeechAnalyzer. SpeechAnalyzer is
a Swift-only API that needs macOS 26 on the target Mac and a Swift bridge that
Tauri does not provide for desktop; Whisper runs through the same
Rust-compatible, statically linked adapter shape as the NER model. The
framework-independent core owns voice-activity segmentation, the
provisional/final job queue, resampling, transcript clean-up and length bounds
(`clinicians_veil_core::dictation`). `crates/local-asr` owns the platform and
model details:

- **Capture.** `cpal` opens the default CoreAudio input on a dedicated thread
  that owns the stream and drops it as soon as the recording stops, is
  cancelled or fails, so the macOS microphone indicator turns off immediately.
  The device callback only downmixes and `try_send`s into a bounded queue;
  overflow stops the recording with a content-free message.
- **Voice activity.** whisper.cpp's standalone Silero VAD (`WhisperVadContext`)
  scores 32 ms frames. `FullParams` VAD is not used: it is ignored by
  `whisper_full_with_state`. whisper.cpp clears Silero's recurrent state on every
  call, so each 256 ms hop is scored with the preceding 0.5 s.
- **Recognition.** `whisper-rs` 0.16 with Metal. whisper.cpp 1.8.3 and ggml are
  linked statically with the Metal library embedded; the DMG needs no
  developer-installed library. Decoding is greedy at temperature 0, English,
  single-segment and context-free, with blank and non-speech tokens suppressed.
  whisper-rs's `set_abort_callback_safe` is unsound in 0.16, so cancellation uses
  the raw abort callback over the recogniser's cancel flag. Native logging is
  discarded.
- **Threads.** A listener thread resamples to 16 kHz, reports level at up to
  15 Hz, and runs VAD and segmentation. A recogniser thread serves final
  utterances before the latest provisional snapshot. It emits exactly one
  terminal event after joining the listener and capture threads, so every
  resource is released before the view hears that the recording ended.
- **IPC.** `start_dictation` takes a `tauri::ipc::Channel`; level, provisional,
  final and terminal events go only to the view that started the recording.
  `stop_dictation` finishes what was heard; `cancel_dictation` discards it.
  Audio never crosses the webview boundary. Errors are content-free
  `&'static str` values.
- **Residency.** Capture begins immediately while the model loads in parallel;
  up to 60 s of final audio queues meanwhile. The model stays resident for 90 s
  after a recording (an aborted, generation-checked timer) and is dropped before
  any NER run. Detection is refused while a recording is active.
- **Permission and packaging.** `src-tauri/Info.plist` supplies
  `NSMicrophoneUsageDescription`; without it TCC terminates the app on first
  access. `src-tauri/Entitlements.plist` grants
  `com.apple.security.device.audio-input`, which the hardened runtime requires.
  Authorisation is requested through `AVCaptureDevice` at the point of use, off
  the main thread. TCC binds the grant to the code signature's designated
  requirement: every ad-hoc CI build is a new identity to macOS, while
  `npm run tauri:local-dmg` keeps the grant across rebuilds. Under `tauri dev`,
  macOS attributes the microphone to the launching terminal.
- **Minimum macOS.** `bundle.macOS.minimumSystemVersion` is 11.0, the first
  release for Apple Silicon. Tauri's 10.13 default cannot compile ggml, which
  uses `std::filesystem`. Building requires CMake. A local build that first ran
  with the old target keeps it in whisper-rs-sys's CMake cache until that
  crate's build directory is removed.

## Other model adapters

NER and local-LLM adapters run in-process through Rust-compatible runtimes. They
may download or import model assets only through an explicit setup flow that
contains no clinical material. Pin model identity and checksum, support offline
use after provisioning, and expose load/unload boundaries to the core.

No Python runtime, Docker service, localhost HTTP server, or model daemon is
part of the application architecture.

The first text-review adapter is `crates/local-ner`. It statically links ONNX
Runtime; the DMG must not depend on a developer-installed runtime library.
The NER and speech models share one explicit installer, `crates/model-assets`,
the only model code with an HTTP client. Callers supply static manifests of
pinned Hugging Face repository, revision, size and SHA-256; URLs are built from
a fixed template, every parsed redirect origin is validated, download sizes and
timeouts are bounded (the ~575 MB speech download gets a longer overall limit),
hashes are verified before installation and known partial files are removed
after failure or on startup. No command accepts a URL or model path.

The Tauri adapter owns one in-memory review and one cancellable operation. Copy
uses the backend-owned reviewed revision. Input and model errors are mapped to
content-free messages; progress events carry only stage/count/operation metadata.

## Help menu and bundled films

The native menu bar has a **Help** menu: "Clinician’s Veil Help" opens the Help
screen, and one "Watch:" item per film opens it at that film. A click emits
`show-help` with the film's slug (or none), and the frontend opens the Help
screen, from the Welcome screen if no workspace is open. The slugs are listed
once in Rust (`HELP_FILMS` in `src-tauri/src/lib.rs`) and once in
`src/privacy/help.ts`, and a Rust test asserts that every film's MP4, WebVTT
captions and WebP poster are present in `src-tauri/resources/help/`.

The films are bundle resources (`help/` in the app's Resources), not part of the
embedded frontend, and the web view loads them through Tauri's asset protocol
(`convertFileSrc` on `resolveResource`). WKWebView streams MP4 with HTTP Range
requests, which the asset protocol answers. The protocol is enabled only for
`$RESOURCE/help/*`, and the CSP adds `asset:` sources for media and images and
nothing else, so no other file on the Mac becomes readable from the web view.
The films are about 22 MB, play only when asked, and never autoplay; nothing is
fetched from the network.

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
- GitHub Actions validates pull requests and, after every successful push to
  `main`, updates a
  rolling `main-latest` prerelease with an arm64 DMG containing an ad-hoc-signed
  app. Tauri signs the completed bundle using `signingIdentity: "-"`, not just
  the executable's automatic linker signature. Both PR and release workflows
  mount the finished DMG read-only and verify its checksum and the enclosed
  bundle's signature, the microphone usage description, the signed
  audio-input entitlement, and that only system libraries are linked, before
  uploading. This checks integrity, not Apple trust;
  Gatekeeper acceptance requires Developer ID signing and notarisation.
  Matching `vX.Y.Z` tags create permanent versioned releases. The GitHub Release
  and workflow artifact are the distribution point for the target M2 Mac. The user must
  explicitly complete macOS’s Gatekeeper flow on first launch; Developer ID
  signing and notarisation remain deferred until broader distribution is required.
- Repeated local test builds use `npm run tauri:local-dmg`, which creates a
  device-local code-signing identity outside the repository and reuses it for
  subsequent DMGs. This keeps the app's designated requirement stable so macOS
  Keychain can remember an explicit “Always Allow” decision across rebuilds.
  The identity is trusted only for code signing and never leaves that Mac. CI
  remains ad-hoc signed until Developer ID signing is configured.

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
