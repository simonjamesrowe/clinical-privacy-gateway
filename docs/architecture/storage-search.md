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
- original document bytes and basename/format/length metadata in `note_documents`;
- encrypted detection and review snapshots, sufficient to reopen the same
  editable review workspace;
- encrypted global and patient-specific identifier mappings, including their
  matched phrase and clinician-approved placeholder;
- temporary source audio, original transcript segments, and alignments;
- expiry metadata and deletion tombstones while a transaction completes; and
- the FTS5 index over reviewed-note text, title, and legacy optional patient
  reference.
- versioned document prompt templates, patient document revisions and their
  selected source-note references;
- prepared/submitted/returned document text, exact local restoration records,
  and content-free submission outcomes; and
- clinician details, signature bytes, and reviewed-document profile/signature
  snapshots.

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
evidence are excluded from the index. Patient-document bodies, submission text,
restoration records, clinician details, and signatures are also excluded.

Deleting a patient transactionally removes their documents and associated
prepared submissions. Deleting a selected source note detaches its source
record and removes associated prepared restoration material while retaining the
independent patient document with a deletion warning. Exported files are outside
the database lifecycle and remain under the clinician's control.

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

## Original documents

Migration 2 transactionally adds `note_documents`. Its `note_id` primary key
and cascading foreign key enforce one original per note and deletion with that
note. Bytes and filename are protected by SQLCipher; a length check constrains
each file to 25 MiB. Existing notes require no backfill. Save commits the note,
original, provenance and FTS entry together, rolling back all on failure. Edits
to reviewed notes preserve the existing original. Search uses only attachment
metadata, never the BLOB, and does not index original bytes, source text or
filenames. Original retrieval happens only for an explicit in-app preview.

## Document usage accounting

A transactional migration adds `document_usage_reports` and
`document_generation_usage`. A unique nullable document foreign key links a
report's attempts while the document exists; `ON DELETE SET NULL` detaches it
without losing historical spend. Opaque report keys prevent reused SQLite
row IDs from merging a new report with a deleted one. No patient foreign key or
clinical strings enter the accounting records.

Consuming a prepared submission and inserting its unique attempt ID is atomic.
An unfinished attempt retains unknown cost after a crash. Completion updates the
attempt once and sets the report's first-success timestamp once. Failed attempts
with returned usage remain billable; unknown usage never becomes zero.
Costs use integer USD nanodollars and the attempt's saved price snapshot, with
cached input subtracted from ordinary input and reasoning already included in
output. New price catalogues do not change past costs. Report counts use the
first-success date, while attempts and spend use the attempt date.
