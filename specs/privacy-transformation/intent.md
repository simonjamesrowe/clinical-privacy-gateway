# Privacy Transformation Intent

**Status:** Planned for the first release

The [in-memory text-review slice](../text-review/intent.md) implements explicit
placeholders and removal, not automatic roles, generalisation or LLM cleanup.

## Intent

Turn detections into consistent, clinically meaningful proposals while leaving
the clinician in control of every change.

## User outcome

The transformed note retains relationships, chronology, diagnosis, function,
and treatment meaning without unnecessarily retaining identifying precision.

## Included behaviour

- Role-based pseudonyms such as `[CLIENT]`, `[MOTHER]`, `[CASE_MANAGER]`, and
  `[COLLEGE]`.
- Consistent substitution of aliases and repeated entities within one note.
- Redaction where no clinically useful replacement exists.
- Generalisation of dates, ages, locations, organisations, occupations, and
  distinctive circumstances at an item level.
- Local LLM cleanup for punctuation, grammar, clarity, and concision, displayed
  as a separate diff.
- Manual insertion of a missed redaction or replacement.

## Safety invariants

- Transformations are proposals until reviewed.
- Cleanup preserves clinical uncertainty and does not silently change numbers,
  dosage, chronology, negation, diagnosis, risk, or speaker attribution.
- Replacement consistency is scoped to one note unless the clinician explicitly
  saves an accepted or edited exact phrase/category mapping in the encrypted
  global library or for the selected patient. A saved mapping applies as an
  accepted exact-match decision on later notes, unless the clinician chooses to
  review saved mappings for that note. It never acts as hidden client profiling.
- Generalisation preserves clinically relevant detail when the clinician keeps
  it deliberately.

## Success criteria

- Multiple aliases for one synthetic person receive one role label.
- People sharing names or surnames remain separately reviewable.
- Exact dates and ages can be kept, generalised, edited, or removed.
- Cleanup changes are independently reversible from privacy transformations.
- The final text contains no hidden source metadata when copied or exported.

## Non-goals

Client profiles, preset minimal/standard/maximum privacy modes,
automatic report generation, diagnostic reasoning, and stylistic rewriting
beyond constrained cleanup are outside this release.
