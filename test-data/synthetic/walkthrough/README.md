# Walkthrough patient: Isla Penrose (SYN-0011)

**All people, places, organisations and clinical details are fictional.** The same conventions as
the rest of this kit: `SYN-` reference, `.invalid` email, `07700 900xxx` number, fictional places.

This is the material behind the in-app Help videos and the walkthrough on simonrowe.dev: one
patient with three notes that build on each other, so the second and third notes show saved
redactions being applied and only new people and places needing review.

| File | Used as |
| --- | --- |
| `note-1-initial-assessment.docx` | Note 1, imported as a Word document (`.txt` is its extracted text) |
| `note-2-follow-up.txt` | Note 2, pasted. Adds her partner, Tom Penrose, and her employer |
| `note-3-phone-call.txt` | Note 3, dictated in the video; paste it to try the same note without a microphone |
| `template-gp-progress.md` | The "Progress update for the GP" document prompt template |

The clinician in the videos is Dr Morgan Hale, Clinical Psychologist, Exampleford Community Therapy,
also fictional.

## Try it

1. In **Settings**, add the clinician details and a signature, then a **Patients** entry for Isla
   Penrose with reference `SYN-0011`.
2. **New note** → **Import document** → `note-1-initial-assessment.docx`. Expect the test banner
   ("SYNTHETIC", sometimes "DATA") and "GP" to be proposed; keep them. "Isla" on its own gets a
   separate label; apply her full name's label to it. Add the missed `SYN-0011` by selecting it.
3. **New note** → paste `note-2-follow-up.txt`. Her name is already replaced from her saved
   redactions; review Tom Penrose, Harbourline Logistics and the dates.
4. **New note** → dictate or paste `note-3-phone-call.txt`.
5. Create a template from `template-gp-progress.md` (paste it in **Markdown source**), then a new
   document from it with all three notes selected.
