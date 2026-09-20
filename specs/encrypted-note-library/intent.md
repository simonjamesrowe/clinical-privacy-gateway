# Encrypted Note Library Intent

**Status:** Partially implemented for pasted-text review

## Intent

Retain reviewed notes for personal retrieval while minimising the lifetime and
surface area of identifiable source material.

## User outcome

The clinician can save, search, reopen, inspect, copy, and delete reviewed notes.
Transcription/audio support remains planned.

## Included behaviour

- One SQLCipher database containing patients, reviewed notes, provenance,
  encrypted original text, reviewed text, review decisions, global and
  patient-specific identifier mappings, and search indexes.
  Audio and transcript retention remain planned.
- A random database key held in device-only Keychain storage.
- Reviewed notes retained until explicit deletion.
- Transactional note save, search-index update, and complete deletion.
- Patient deletion removes that patient's notes, their search entries, and
  patient-specific mappings in the same transaction.
- Patient and note deletion each require a modal confirmation that asks, “Are
  you really sure you want to delete this?”

## Safety invariants

- Saving a note persists its original text, reviewed text, and review decisions
  together in the SQLCipher database; none are indexed except reviewed text.
- Expired or deleted source content is removed from primary, temporary, and
  derived storage.
- An unreadable or wrongly keyed database is preserved for diagnosis rather than
  silently replaced.
- Clinical text does not appear in filenames, paths, logs, notification bodies,
  or application-window titles.
- Loss of the device-only key is explained as loss of access, not corruption.

## Success criteria

- Database pages and FTS data are not readable without the stored key.
- Restarting the application preserves reviewed notes.
- Explicit note deletion removes its record, provenance, source material, and
  search entry in an idempotent operation.
- Explicit patient deletion removes the patient, all their notes, their search
  entries, and patient-specific mappings without leaving derived data behind.

## Non-goals

Cloud backup, device migration, sync, shared libraries, client profiles, and
long-term source-audio archives are outside this release.
