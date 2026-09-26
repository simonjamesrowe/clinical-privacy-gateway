# Design System

**Status:** Accepted. Step 1 of the [delivery plan](#delivery-plan) is
implemented. The welcome page is the reference and does not change.

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
| [src/styles/components.css](../src/styles/components.css)   | Target components; the app adopts them in steps 2–4        |
| [design-system/index.html](../design-system/index.html)     | Principles, token specimens, components, rules, and markup |
| [design-system/screens.html](../design-system/screens.html) | Clickable screens composed only from those components      |
| This document                                               | Navigation model, decisions, copy, accessibility, and plan |

Use the canonical language in [CONTEXT.md](../CONTEXT.md). Use synthetic
content in the library and screens.

## Information architecture

```text
Welcome (unchanged)
  ├─ New note  → Patients (choose one)
  ├─ Patients
  └─ Notes

App header: [mark] Clinician’s Veil   Patients  Notes  Redactions  Settings   ● On this Mac

Patients                      /patients             searchable table
  New patient                 /patients/new         page form
  Patient                     /patients/:id         ribbon + tabs
    Details                   …/details             editable form, delete patient
    Notes                     …/notes  (default)    searchable table
    Redactions                …/redactions          patient redactions table
    New note / open note      …/notes/new, …/notes/:noteId   review workspace
Notes (all patients)          /notes                searchable table with Patient column
Redactions (all patients)     /redactions           global redactions table
Settings                      /settings             local model
```

The breadcrumb shows the path above the page title, for example
`Patients / Alex Morgan / New note`. The mark in the header returns to the
welcome page. Opening a note from the all-patients Notes table goes to that
note inside its patient, so the breadcrumb always leads back to the patient.

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

### What changes from today

| Today                                               | Proposed                                                  |
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
  menu; the existing dialogs and operation overlay use it until step 5 removes
  them.
- A new component goes into `src/styles/components.css` and gets a specimen in
  the library, with its rules, in the same change.

## Decisions

- **Redactions** is the interface name for reusable identifier replacements at
  both scopes. [CONTEXT.md](../CONTEXT.md) defines it as a **saved redaction**,
  distinct from a one-off redaction decision.
- Redactions are created only during note review and are never deleted from the
  Redactions screens. The clinician can edit the replacement text. A mistaken
  redaction keeps applying until it is edited or the clinician chooses
  **Review saved redactions** for a note.
- Deletion of a patient or note uses the inline confirmation with the same
  wording as today’s modal. Step 5 updates the note-library intent.
- The all-patients Notes page stays, because the welcome page links to it.
- The About dialog is the one modal and stays on the welcome page.

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

## Delivery plan

Each step is a focused pull request with its own tests.

1. **Tokens and library.** _Done._ Add `tokens.css`, move `app.css` and
   `review.css` onto it without behaviour changes, and add `components.css`
   with the HTML library that renders it.
2. **Shell and routing.** Import `components.css` into the app. Add the app
   header, breadcrumb, and hash routes, and split `src/privacy/page.ts` into a
   router and one module per view. Keep the
   review workspace logic intact.
3. **Patient workspace.** Add the patient ribbon, tabs, Details form, and patient
   Notes table. This needs an `update_patient` command and a `patientId` filter
   on `search_notes`.
4. **Redactions.** Rename mappings to redactions in the interface, and add the
   patient Redactions tab and the all-patients Redactions page with inline
   editing of the replacement only. Remove the create and delete controls, and
   drop the `create_*mapping` and `delete_*mapping` commands from the Tauri
   adapter. Note review keeps saving redactions through
   `save_mapping_from_review`.
5. **No overlays.** Replace the add-patient, save-note, and deletion dialogs
   and the operation overlay, and remove `window.confirm`. Update
   `specs/encrypted-note-library/intent.md` and `specs/text-review/intent.md`
   in the same change.
