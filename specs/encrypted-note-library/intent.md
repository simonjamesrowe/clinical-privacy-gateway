# Encrypted Note Library Intent

**Status:** Implemented for pasted and imported text; audio remains planned

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
- Reviewed notes and their exact original documents retained until explicit deletion.
- An optional original document is saved atomically with its note and retained
  through edits. It can be previewed locally after the external file disappears.
- Transactional note save, search-index update, and complete deletion.
- Patient deletion removes that patient's notes, their search entries, and
  patient-specific redactions in the same transaction.
- Patient and note deletion each require an inline confirmation, in place of
  the row or the patient's Delete patient section, that asks, “Are you really
  sure you want to delete this?” and states the consequence. There are no
  modal dialogs.
- A patient's name and patient number can be edited on their Details tab.
  Notes, search entries, and redactions stay attached through the patient.
- The all-patients Notes library exposes **New note**. It first opens the same
  searchable patient chooser used by the welcome action; that chooser also
  provides **New patient** when the required patient does not yet exist.
- Saved redactions are created only while reviewing a note. The Redactions
  screens can change a redaction's replacement but cannot add or delete one.
  Patient redactions are deleted with their patient; all-patients redactions
  have no deletion path in this release.

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
