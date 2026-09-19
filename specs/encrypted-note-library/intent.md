# Encrypted Note Library Intent

**Status:** Planned for the first release

## Intent

Retain reviewed notes for personal retrieval while minimising the lifetime and
surface area of identifiable source material.

## User outcome

The clinician can save, reopen, inspect, and delete reviewed notes, and can check
recent transcriptions against their encrypted source audio.

## Included behaviour

- One SQLCipher database containing reviewed notes, provenance, temporary audio,
  original transcript alignment, retention metadata, and search indexes.
- A random database key held in device-only Keychain storage.
- Reviewed notes retained until explicit deletion.
- Source audio and the original aligned transcript automatically removed 30 days
  after note creation.
- Clear display of the audio expiry date and manual early deletion.
- Transactional note save, expiry, and complete deletion.
- Startup recovery for interrupted cleanup without restoring expired content.

## Safety invariants

- Pasted source text is never persisted.
- Expired or deleted source content is removed from primary, temporary, and
  derived storage.
- An unreadable or wrongly keyed database is preserved for diagnosis rather than
  silently replaced.
- Clinical text does not appear in filenames, paths, logs, notification bodies,
  or application-window titles.
- Loss of the device-only key is explained as loss of access, not corruption.

## Success criteria

- Database pages and FTS data are not readable without the stored key.
- Restarting the application preserves reviewed notes and pending expiry dates.
- Advancing past 30 days removes audio, original transcript, and alignment while
  retaining the reviewed note.
- Explicit note deletion removes its record, provenance, source material, and
  search entry in an idempotent operation.

## Non-goals

Cloud backup, device migration, sync, shared libraries, client profiles, and
long-term source-audio archives are outside this release.
