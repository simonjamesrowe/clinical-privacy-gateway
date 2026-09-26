# Agent Instructions

## Start here

Read [the architecture index](docs/architecture.md) before designing or changing
the system. Then follow the relevant architecture branch:

- **Privacy or egress:** read
  [privacy and security](docs/architecture/privacy-security.md) before handling
  content, logging, keys, retention, deletion, exports, or network access.
- **Detection or transformation:** read
  [the processing pipeline](docs/architecture/processing-pipeline.md) before
  changing transcription, rules, NER, local models, cleanup, or review data.
- **Persistence or retrieval:** read
  [storage and search](docs/architecture/storage-search.md) before changing
  SQLite, encryption, audio retention, indexing, or search.
- **Screens, styles, or interface copy:** read
  [the design system](docs/design-system.md) before changing navigation,
  layout, tokens, components, or wording.
- **Desktop or Apple integration:** read
  [native integration](docs/architecture/native-integration.md) before changing
  Tauri commands, capabilities, WKWebView, Swift, SpeechAnalyzer, or packaging.

Feature intent documents live at `specs/<feature>/intent.md`. Read the relevant
intent before implementing a feature and update it when the user-facing intent
changes. The architecture is authoritative for cross-cutting decisions. The
preserved source brief is reference material, not an active specification.

Use the canonical language in [CONTEXT.md](CONTEXT.md).

## Safety invariants

- Use synthetic clinical content in code, fixtures, tests, documentation,
  issues, commits, and pull requests.
- Keep clinical content local by default. Treat every network egress as an
  explicit, payload-scoped user action.
- Keep content out of operational logs, telemetry, crash reports, and error
  messages. Put detection provenance inside the encrypted note record.
- Present privacy transformations for human review. Describe output as
  de-identified or pseudonymised, never anonymous, safe, or compliant.
- Exercise regexes over unbounded content against a 100,000-character
  worst-case input and use bounded or possessive matching where supported.

## Change discipline

- Preserve the Tauri-independent Rust core; adapters own framework, database,
  model-runtime, and Apple-platform details.
- Update the relevant architecture document in the same change as an
  architectural decision. Add an ADR only when a hard-to-reverse, surprising
  trade-off needs its own history.
- Use branches named `<type>/<scope>/<slug>` and commits prefixed with the
  matching uppercase type, such as `[DOCS]` or `[FEAT]`.
- Keep each change focused and include its tests. Do not add CI, cloud services,
  or distribution machinery without an explicit requirement.
