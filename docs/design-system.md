# Design System

**Status:** Implemented. The workspace follows this design system; the welcome
page is the reference and does not change.

The design system is an HTML library:
[design-system/index.html](../design-system/index.html). It shows the
principles, every token, every component with its rules and markup, and a
clickable composition of the target screens. Open it with
`npm run design-system`, which serves it at
`http://127.0.0.1:1420/design-system/`. The token specimens read
`src/styles/tokens.css` through the dev server, so they cannot drift.

| Source                                                      | Holds                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| [src/styles/tokens.css](../src/styles/tokens.css)           | Every colour, type, space, and shape value, with its use   |
| [src/styles/components.css](../src/styles/components.css)   | Components the app and the library both use                |
| [src/privacy/components.ts](../src/privacy/components.ts)   | Builders that produce the documented component markup      |
| [design-system/index.html](../design-system/index.html)     | Principles, token specimens, components, rules, and markup |
| [design-system/screens.html](../design-system/screens.html) | Clickable screens composed only from those components      |
| This document                                               | Navigation model, decisions, copy, accessibility, and plan |

Use the canonical language in [CONTEXT.md](../CONTEXT.md). Use synthetic
content in the library and screens.

## Information architecture

```text
Welcome
  ├─ Standard app header and navigation
  ├─ New patient  → patient form
  ├─ New note     → searchable patient chooser
  ├─ New document → searchable patient chooser
  └─ Patients · Notes · Documents · Redactions · Document prompt templates · Settings

App header (including Welcome): [mark] Clinician’s Veil   Patients  Notes  Documents  Redactions  Document prompt templates  Settings   ● On this Mac

Patients                      searchable table
  New patient                 page form
  Patient                     ribbon + tabs
    Details                   editable form, delete patient
    Notes (default)           searchable table
    Documents                 saved drafts/reviewed documents; new-document flow
    Redactions                patient redactions table
    New note / open note      review workspace
Notes (all patients)          searchable table with Patient column; New note
Redactions (all patients)     all-patients redactions table
Document prompt templates     create, edit, duplicate, archive, restore
Settings                      local model, OpenAI configuration, clinician details/signature
```

Screens are in-app states, not URLs: the desktop window has no back or forward
control. Tabs are buttons with `role="tab"`; the arrow, Home, and End keys move
between them.

The breadcrumb shows the path above the page title, for example
`Patients / Alex Morgan / New note`. The mark in the header returns to the
welcome page. Opening a note from the all-patients Notes table goes to that
note inside its patient, so the breadcrumb always leads back to the patient.

Leaving an unsaved review for any other screen, or for the welcome page, shows
an inline **Discard this session?** confirmation above the workspace. Saving a
note returns to that patient's Notes tab.

### Redactions at two scopes

- **All-patients redactions** apply to new notes for every patient.
- **Patient redactions** apply to new notes for one patient and take precedence
  over an all-patients redaction for the same phrase and category. The row shows
  an **Overrides all-patients** badge.
- The patient Redactions tab links to the all-patients list so the clinician can
  see everything that applies.
- Redactions are created only while reviewing a note, by choosing to save a
  replacement. The Redactions screens never add or delete them.
- The only change on a Redactions screen is **Edit**, which changes the
  replacement text. The identifier, category, and scope stay fixed because they
  decide what the redaction matches. A patient's redactions are removed only
  when the patient is deleted.
- **Review saved redactions** remains the per-note opt-out before analysis.

### What changed

| Before                                              | Now                                                       |
| --------------------------------------------------- | --------------------------------------------------------- |
| Flat nav: Home, Patients, Notes, Mappings, Settings | Header nav plus breadcrumb; patient workspace with tabs   |
| Patients table only starts notes or deletes         | Row opens the patient; **New note** stays as a row action |
| Patient name and number cannot be edited            | **Details** tab edits them in place                       |
| One Notes table across all patients                 | Patient **Notes** tab; all-patients Notes table remains   |
| Mappings page mixes global and current patient      | **Redactions** tab (patient) and Redactions page (global) |
| Add patient, save note, and delete use `<dialog>`   | Page form, inline save bar, and inline confirmation       |
| Full-screen operation overlay                       | Header activity bar; page content is `inert` while busy   |

## Token and component rules

- Components use only tokens. A raw colour, radius, or font size in a component
  stylesheet is a defect. The welcome page and About dialog keep their bespoke
  display sizes and two secondary-button colours.
- The display face is for one page title per screen and the brand. Section
  headings use the body face at 600.
- Signal is only for the focus ring and the active review highlight. Errors use
  danger.
- There are no shadows. `--shadow-float` is reserved for the anchored selection
  menu.
- A new component goes into `src/styles/components.css` and
  `src/privacy/components.ts`, and gets a specimen in the library, with its
  rules, in the same change.
- Component specimens keep headings, rules, demos and related links in
  separately padded regions. Related-link footers use muted small text with a
  readable line length rather than running against the card edge.
- Screens build DOM with `h()` from `src/privacy/dom.ts`, which turns every
  string into a text node. Patient names, titles, and clinical text never pass
  through `innerHTML`.

## Decisions

- **Redactions** is the interface name for reusable identifier replacements at
  both scopes. [CONTEXT.md](../CONTEXT.md) defines it as a **saved redaction**,
  distinct from a one-off redaction decision.
- Redactions are created only during note review and are never deleted from the
  Redactions screens. The clinician can edit the replacement text. A mistaken
  redaction keeps applying until it is edited or the clinician chooses
  **Review saved redactions** for a note.
- Deletion of a patient or note uses an inline confirmation with the wording of
  the former modal.
- Because redactions cannot be deleted from the library, a patient's redactions
  last until the patient is deleted and all-patients redactions have no
  deletion path. [Privacy and security](architecture/privacy-security.md)
  records this retention.
- Search excerpts show placeholders as chips, so full-text search no longer
  marks matches with brackets.
- The all-patients Notes page stays, because the welcome page links to it.
- The About dialog is the one modal and stays on the welcome page.

### Patient documents

- The document flow uses three explicit steps: **Choose notes**, **Review
  submission**, and **Review document**.
- New documents can add optional instructions that apply only to that
  generation. Document details occupy the left pane and the full-height
  additional-instructions field occupies the right pane, stacking at narrow
  widths. Submission review labels its two columns **Instructions** and
  **Reviewed notes**, using standard section titles and muted supporting copy.
- Submission and generated-document actions share one split action row: the
  back/regenerate action on the left and the primary save/send actions on the
  right, stacking at narrow widths.
- The outgoing review names OpenAI, the configured model, destination and
  purpose. During network activity, the header says **Sending to OpenAI** rather
  than **Working locally**.
- Signature insertion is off for each document. Clinician details and the
  drawing are previewed beneath the letter only when selected and are appended
  locally after generation.
- A reviewed document exposes **Copy text**, **Export Word**, and **Export PDF**.
  Any edit returns it to draft.
- The current governance-blocked state is a notice, not a disabled control with
  no explanation. Saving a provider key never implies that sending is enabled.
- Settings gives clinical sending its own bordered section. Four standard
  checkbox rows record the required confirmations; the enable action remains
  disabled until all four are selected and a provider key is already saved.
- **Documents** is a first-class top-level library. Its table follows Patients
  and Notes: one search field, a count/status line, row openers, patient context,
  review status, and latest/total generation cost columns.

## Copy

- Sentence case. Buttons name the outcome: **Save changes**, **Delete note**,
  **Save note**. The status that follows repeats the verb: “Changes saved.”
- One name per thing. Use **patient number** and **redaction** everywhere.
  **Note title** is not “reference”.
- Errors say what happened and what to do next. They never contain clinical text.
- Deletion asks, “Are you really sure you want to delete this?” and states the
  consequence underneath.
- Never describe output as safe, anonymous, or compliant.

## Accessibility floor

- Everything works by keyboard. Tabs, table rows, and inline confirmations have
  visible focus.
- When a view changes, focus moves to its `<h1>`. When an inline confirmation
  opens, focus moves to **Cancel**, and **Escape** closes it and restores focus.
- While an operation runs, page content is `inert` and the activity status is
  announced with `role="status"`.
- Text contrast meets WCAG AA on paper and surface. Colour never carries state
  alone.
- Reduced motion is respected. The only motion is the welcome mark and the
  activity bar.

## Delivery

The plan shipped in two steps: tokens with the library, then the patient
workspace, redactions, and in-page flows, with `update_patient`, a `patientId`
filter on `search_notes`, and replacement-only redaction updates in the Tauri
adapter. The create and delete redaction commands were removed; note review
still saves redactions through `save_mapping_from_review`.

Follow-up: split the screens in `src/privacy/page.ts` into one module per
screen. The shared builders already live in `src/privacy/components.ts`.

## Document notes

New note offers **Type or paste** and **Import document** tabs. The import
picker accepts TXT, DOCX and text PDFs. The selected-document toolbar shows the
basename, format, **Preview**, and **Change document**. Extraction limitations
appear inline with an acknowledgment checkbox before **Find identifiers**.
The source counter uses 100,000 Unicode characters for both input modes.

Both note tables include an **Original** column. `documentButton` shows the
file-format icon with a format-specific accessible label and tooltip. It is a
separate action from opening the reviewed note. Preview replaces the page
content rather than opening a modal. It labels source material explicitly,
uses a simplified Word layout or inert PDF page images, and returns to the
previous query/filter, editor, scroll and focus. `document-toolbar`,
`document-content`, `document-paragraph`, `document-page` and `document-tabs`
use the shared component tokens. The [interactive document specimen](../design-system/documents.html)
uses the production page with synthetic bridge responses.

### Document models and usage

Use the existing labelled select and data-table components for model selection
and usage; no new visual component or palette is required. Settings labels its
selector **Default model**; document creation labels it **Model** and states
whether it uses the default or a per-document override. Show input/output prices
in each option and the cached-input rates and price-check date in Settings.

**Usage and costs** lives in Settings with a labelled **Period** selector for
**This month** and **All time**. Show **Reports created**, **Generation attempts**,
**Estimated spend in this app**, and **Average cost per report**. Preserve
sub-cent precision. Partial totals explicitly add **unknown costs**, and never
render missing usage as a zero-cost request. The patient Documents table adds
**Latest cost** and **Total cost** columns. The existing design-system screens
include synthetic examples of the selectors, usage table and cross-patient
Documents library.

### Template and settings configuration

The [configuration specimen](../design-system/configuration.html) runs the actual
screen components with memory-only synthetic fixtures. Template editing uses a
one-third metadata / two-thirds writing layout, stacking on narrow windows.
`markdown-editor.ts` provides restricted rich Markdown editing; `signature-pad.ts`
provides local drawing, typed signatures and replacement/removal controls.
Settings uses separate bordered sections and the standard `.field` input sizing.
All component styling remains in `components.css` and uses design tokens.

The template toolbar uses local SVG icons for paragraph, heading, bold, italic,
bullets, undo/redo and Markdown source. Every icon has an accessible name and
tooltip. Formatting reflects the current selection with a bordered pressed state;
unavailable commands are disabled. Bullet formatting toggles on and off.
