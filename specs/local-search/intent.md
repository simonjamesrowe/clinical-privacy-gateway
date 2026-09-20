# Local Search Intent

**Status:** Implemented for reviewed pasted-text notes

## Intent

Help the clinician retrieve retained reviewed notes quickly without creating a
second plaintext index or sending queries elsewhere.

## User outcome

The clinician can enter ordinary keywords and receive relevant reviewed notes
ranked locally.

## Included behaviour

- FTS5 indexing of reviewed-note text, title, and optional legacy patient reference
  inside the SQLCipher database.
- BM25-ranked keyword and phrase search.
- Snippets and highlighting derived only while the database is unlocked.
- Index updates in the same transaction as note save, edit, or deletion.
- Empty, punctuation-only, and unsupported queries handled without failure.

## Safety invariants

- Only reviewed-note text, title, and optional legacy patient reference are indexed.
- Queries and results remain local and are excluded from operational logs.
- Source text, original transcripts, audio, detections, and identifier mappings
  are not searchable.
- Locked or unreadable storage yields no search results.

## Success criteria

- Synthetic notes can be found by exact term and phrase with deterministic BM25
  ordering for a fixed corpus.
- Editing or deleting a note removes stale matches transactionally.
- Search continues to work offline and reveals no standalone plaintext index.

## Dependencies and decision gates

Record real keyword-search failures during personal use before proposing
semantic search. If justified later, benchmark an embedding model and
`sqlite-vec` against the same retrieval corpus before changing this intent.

## Non-goals

Semantic similarity, remote search, cross-device search, and search over raw
source material are outside this release.
