# Storage and Search Architecture

## Database boundary

Use `rusqlite` and a bundled SQLCipher build rather than macOS system SQLite.
This fixes the SQLite version and compile options, supplies page-level
encryption, and permits the required virtual-table extensions. On Apple targets,
the bundled SQLCipher feature can use the system Security framework. See the
[rusqlite build documentation](https://github.com/rusqlite/rusqlite#notes-on-building-rusqlite-and-libsqlite3-sys).

The SQLite adapter owns connections, pragmas, schema migrations, transactions,
and extension registration. The Rust core depends on repository interfaces, not
SQL or `rusqlite` types.

## One encrypted store

The database contains:

- patient records, source text, reviewed notes, and revision metadata;
- encrypted detection and review snapshots, sufficient to reopen the same
  editable review workspace;
- encrypted global and patient-specific identifier mappings, including their
  matched phrase and clinician-approved placeholder;
- temporary source audio, original transcript segments, and alignments;
- expiry metadata and deletion tombstones while a transaction completes; and
- the FTS5 index over reviewed-note text, title, and legacy optional patient
  reference.

When a clinician saves a pasted-text note, its source text is committed with the
reviewed text and review snapshot in the same encrypted record. Source text is
not indexed. Audio and original ASR transcripts expire 30 days after the
reviewed note is created, even if the note is retained.

Writes that save a note, provenance, retention schedule, and FTS entry are one
transaction. Expiry and explicit deletion are idempotent and remove primary and
derived records together. Deleting a patient transactionally removes their
notes, corresponding FTS entries, and patient-specific mappings before deleting
the patient record.

## Keyword search

The first release uses FTS5 with BM25 ranking over reviewed-note text, title,
and a legacy optional patient reference. Patient names are relational metadata,
shown with a note but excluded from the search index. Queries execute locally and
never reach an analytics or external search service. Search results reveal only
content the unlocked application could already display.

Source text, original transcripts, audio, identifier mappings, and detection
evidence are excluded from the index.

## Semantic-search seam

Semantic search is deferred until observed keyword-search failures justify it.
Keep storage interfaces capable of attaching derived vectors to reviewed-note
revisions, but create no vector tables or embeddings in the first release.

`sqlite-vec` is the planned experimental extension because it is pure C and can
compile statically into the same SQLite process. Its Rust binding builds the
extension with `SQLITE_CORE` and registers it through `sqlite3_auto_extension`.
It remains pre-v1 and requires a compatibility spike with the chosen SQLCipher
build before adoption. See [sqlite-vec](https://github.com/asg017/sqlite-vec).

## Recovery and migration

- Create the database under the app's Application Support directory, never in
  the signed application bundle.
- Run forward-only, transactional schema migrations after the key is available.
- Fail closed on a wrong key, corrupt database, missing required extension, or
  incomplete migration; never replace an unreadable database automatically.
- Test deletion, expiry, and migration against FTS shadow tables so removed
  content cannot survive in derived storage.
- Treat backup and device migration as future product decisions because the
  device-only Keychain item intentionally does not migrate.
