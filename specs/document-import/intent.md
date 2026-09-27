# Notes from documents

**Status:** Implemented; synthetic verification. M2/8 GB validation remains pending.

## Intent

A clinician can create a note for a patient from a local `.txt`, `.docx`, or PDF
with selectable text, inspect and correct the extracted source text, and use the
existing identifier review and final-check workflow. Import does not start
analysis or save a note automatically.

## Behaviour

- One native file selection per note; a maximum of 25 MiB per file, 100 MiB
  expanded DOCX data, 500 PDF pages, and 100,000 Unicode scalar values of source
  text. Oversize input is rejected, never silently truncated.
- Plain text supports strict UTF-8 (optional BOM) and BOM-marked UTF-16.
- Word extraction includes paragraphs, headings, lists, tables, headers,
  footers, footnotes, and endnotes. Current revision text includes insertions
  and excludes deletions. Comments, images, text boxes and embedded objects
  are not included in the simplified preview; detected omissions and tracked
  revisions are disclosed and require acknowledgment. Nested tables are
  rejected with guidance to simplify the document.
- PDFs are extracted page by page using local PDFKit. Password-protected PDFs,
  extraction-restricted PDFs, image-only PDFs, and unreadable files are rejected.
  Missing-text pages in mixed PDFs are identified. Acknowledgment of PDF
  extraction limitations is required, including checking image content and
  reading order. There is no OCR.
- Imported source text can be edited before analysis. The exact original bytes
  remain unchanged. A replacement file is committed to the session only after
  successful extraction; cancellation and failure preserve the previous input.
- Switching input methods or replacing existing material requires the inline
  discard confirmation. Leaving an unsaved import uses the same confirmation
  as leaving an unsaved pasted-text review.
- Saving after final review atomically retains the original file, source text,
  reviewed note, review decisions and search entry in SQLCipher. The external
  file can subsequently move or disappear. Titles do not come from filenames.
- Patient Notes and all-patient Notes show an Original column with a separate
  TXT, DOCX or PDF icon button. Notes without documents show a dash.
- Preview is a dedicated in-app view: readable Word structure, original text,
  or inert PDF page images with paging and zoom. It is explicitly identified
  as original source material without privacy transformations. Returning
  restores the note editor or search query, filter, scroll and trigger focus.

## Privacy and lifecycle

Unsaved originals and previews remain in memory. Only a basename is retained,
inside the encrypted store; no source path is persisted. The original,
filename, extracted text and extraction warnings never enter the search index,
logs or network requests. Document links, scripts and external relationships
are never followed. The original is never eligible for reviewed-text copying
or egress. Deleting the note or patient also deletes its original. Discard and
window closure release in-memory originals and preview state. As with source
text, this does not promise secure erasure from OS swap or a compromised Mac.

## Verification and exclusions

Synthetic tests cover extraction and format limits, malformed inputs, Unicode,
warning gates, patient/session binding, cancellation, safe DOM rendering,
atomic saves, encryption, migration, retention, deletion and search exclusions.
Native PDFKit tests cover extraction, page order and in-memory PNG rendering.
The interactive design-system specimen exercises the production UI with
synthetic bridge responses; it does not read files or run native detection.

Legacy `.doc`, OCR, multiple attachments, batch import, original-file export,
external-app opening and faithful Word pagination are excluded.
