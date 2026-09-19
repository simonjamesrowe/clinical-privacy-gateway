# Native Integration Architecture

## Tauri boundary

Use the Tauri 2.11 line with WKWebView. Expose the minimum command surface and
capabilities needed for capture, processing, review, persistence, search, and
the gated egress path. The web frontend receives serialisable domain views and
progress events; it never receives database keys or arbitrary filesystem and
network primitives.

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

## Development and packaging

- Use Safari Web Inspector for WKWebView debugging; enable development tools in
  development builds only.
- Configure rust-analyzer with a separate target directory and use `cargo check`
  for ordinary check-on-save work to reduce cache invalidation and memory use.
- Evaluate a faster linker in `.cargo/config.toml` when the codebase is
  scaffolded; keep platform-specific configuration documented.
- Build locally with ad-hoc signing for this single-machine tool. Do not add
  notarisation or GitHub Actions until distribution becomes a requirement.
