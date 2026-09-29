# Synthetic local testing kit

**All people, addresses, organisations and clinical scenarios are fictional.**
Nothing was copied from a patient record. These are software test fixtures, not
clinical advice or validated report prompts. Contact emails use `.invalid`;
phone numbers use the reserved fictional `07700 900xxx` range. Addresses and
postcodes are deliberately fictional, so postcode detection is not expected.

There are 40 examples: 10 Word documents, 10 selectable-text PDFs, 10 plain-text
notes and 10 Markdown document prompt templates. Word/PDF/text versions share
ten cases so you can compare extraction. Each case contains two dated visits,
source identifiers, reported observations and explicit missing information.

## Try the workflow

1. Create a test patient using a name and `SYN-` reference from `manifest.json`.
2. In **New note**, paste a file from `notes/`, or import its matching Word/PDF
   from `word/` or `pdf/`. Compare the extraction with the original preview.
3. Review identifiers and save. To test multiple notes, paste each dated visit
   into a separate note for the same test patient.
4. In **Document prompt templates**, create a template and paste a file from
   `templates/` using **Markdown source**, then switch to **Formatted editor**.
5. Select the saved notes and try different per-document models. Clinical sending
   remains subject to the app's activation gate; these fixtures do not enable it.
6. Try a typed or drawn fictional clinician signature in Settings, save, reopen,
   replace and remove it. The fixtures contain no real clinician signature.

## What to look for

- Cases 1–5: names, dates, references, email and phone detection; distinct visit dates.
- Case 6: Unicode names and a dose whose missing medication name must not be invented.
- Case 7: two people with the same name; review placeholder grouping explicitly.
- Case 8: employer-facing scope and recorded consent limits.
- Case 9: missing examination findings and unspecified urgency.
- Case 10: completed and incomplete goals in the same episode.
- Every case: the literal `[CLIENT]` text should not be mistaken for a generated token.

## Regeneration

Run `python generate.py` with `python-docx` and `reportlab` installed. The generator
is local and never reads app storage, credentials, clinical files or the network.
Documents use a restrained business-brief style with an A4 page override.
Generated files are checked in so no Python setup is needed for manual testing.
