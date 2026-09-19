# Clinician Review Intent

**Status:** Planned for the first release

## Intent

Make human review the explicit control point between automated proposals and a
reviewed note.

## User outcome

The clinician can understand, verify, change, and complete every privacy and
cleanup proposal without losing sight of the source wording.

## Included behaviour

- Side-by-side source and working text with linked highlights.
- A review list that distinguishes direct identifiers, probable identifiers,
  indirect-risk combinations, cleanup changes, and retained details.
- Item-level decisions: accept, edit, keep, or remove.
- Explanations and contributing detection stages for every flagged item.
- Audio replay for transcribed source while the 30-day source retention exists.
- A final local rescan and structured residual-risk summary.
- Copy of reviewed text and optional plain `.txt` or `.md` export.

Saving a reviewed note and approving external egress are separate actions.

## Safety invariants

- The default state for unresolved items is pending, not accepted.
- Colour is supplemented by text and icons.
- The interface reports counts and named residual concerns, not a compliance or
  anonymity score.
- Editing after a final scan invalidates that scan until it is run again.
- Egress remains unavailable from an incomplete or stale review.

## Success criteria

- The clinician can navigate every proposed change without relying on colour.
- A wrongly flagged phrase can be restored and a missed identifier manually
  transformed.
- The final summary distinguishes remaining direct detections, indirect risks,
  unavailable stages, and deliberately retained items.
- Familiar users can complete a typical synthetic progress-note review within
  30 seconds after automatic processing, without hiding unresolved items.

## Non-goals

Multi-reviewer approval, team comments, remote review, and legal certification
are outside this release.
