// Clickable composition of the target screens. Synthetic content only.
const patients = [
  {
    id: 1,
    name: "Alex Morgan",
    ref: "SYN-2048",
    notes: 3,
    documents: 1,
    redactions: 2,
  },
  {
    id: 2,
    name: "Sam Okafor",
    ref: "SYN-3117",
    notes: 1,
    documents: 0,
    redactions: 0,
  },
  {
    id: 3,
    name: "Jordan Reyes",
    ref: "",
    notes: 0,
    documents: 0,
    redactions: 1,
  },
];
const notes = [
  {
    id: 1,
    patient: 1,
    title: "Sleep review",
    saved: "24 Sep 2026",
    excerpt:
      "[PERSON_1] reported improved sleep and no change to the prescribed 10 mg dose.",
  },
  {
    id: 2,
    patient: 1,
    title: "Medication check-in",
    saved: "10 Sep 2026",
    excerpt:
      "Discussed side effects with [PERSON_1] and agreed to review in four weeks.",
  },
  {
    id: 3,
    patient: 1,
    title: "Initial assessment",
    saved: "2 Aug 2026",
    excerpt:
      "[PERSON_1] attended with [PERSON_2] at [LOCATION_1]; history taken.",
  },
  {
    id: 4,
    patient: 2,
    title: "Follow-up",
    saved: "18 Sep 2026",
    excerpt:
      "[PERSON_1] described reduced anxiety since starting the group sessions.",
  },
];
const redactions = [
  {
    patient: 1,
    phrase: "Alex Morgan",
    replacement: "[CLIENT]",
    category: "Person",
    updated: "24 Sep 2026",
    overrides: false,
  },
  {
    patient: 1,
    phrase: "Bristol",
    replacement: "[CITY]",
    category: "Location",
    updated: "10 Sep 2026",
    overrides: true,
  },
  {
    patient: 3,
    phrase: "Maple Court",
    replacement: "[RESIDENCE]",
    category: "Location",
    updated: "1 Sep 2026",
    overrides: false,
  },
  {
    patient: null,
    phrase: "Bristol",
    replacement: "[LOCATION]",
    category: "Location",
    updated: "3 Aug 2026",
  },
  {
    patient: null,
    phrase: "Riverside Clinic",
    replacement: "[CLINIC]",
    category: "Organisation",
    updated: "3 Aug 2026",
  },
];
const templates = [
  {
    name: "GP letter",
    description: "Summarise care for the GP",
    status: "Available",
  },
  {
    name: "Referral letter",
    description: "Present the reason for referral",
    status: "Available",
  },
  {
    name: "Progress report",
    description: "Summarise progress and next steps",
    status: "Available",
  },
];
let confirming = null;
let query = "";
const view = document.querySelector("#view");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const placeholders = (s) =>
  esc(s).replace(/\[([A-Z_0-9]+)\]/g, '<span class="placeholder">[$1]</span>');

function crumbs(items) {
  return `<ol class="breadcrumb" aria-label="Breadcrumb">${items
    .map(([label, href], i) =>
      i === items.length - 1
        ? `<li><span aria-current="page">${esc(label)}</span></li>`
        : `<li><a href="${href}">${esc(label)}</a></li>`,
    )
    .join("")}</ol>`;
}
function header(eyebrow, title, description, actions = "") {
  return `<header class="page-header"><div><p class="eyebrow">${eyebrow}</p><h1 class="page-title">${title}</h1>${description ? `<p class="muted">${description}</p>` : ""}</div><div class="page-actions">${actions}</div></header>`;
}
function search(label, placeholder) {
  return `<form class="search" role="search" data-search><label class="visually-hidden" for="q">${label}</label><input id="q" type="search" placeholder="${placeholder}" value="${esc(query)}" autocomplete="off" /><button class="button search__button"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="6.75" cy="6.75" r="4.75" /><path d="m10.4 10.4 3.85 3.85" /></svg>Search</button></form>`;
}
function count(shown, total, noun) {
  return query
    ? `<span class="meta muted" role="status">${shown} of ${total} ${noun} match “${esc(query)}” · <button class="link-button" data-clear>Clear search</button></span>`
    : `<span class="meta muted" role="status">${total} ${noun}</span>`;
}
function confirmRow(key, cols, subject, consequence) {
  return confirming === key
    ? `<tr class="confirm-row"><td colspan="${cols}"><div class="confirm" role="alert"><div><strong>Delete this ${subject}?</strong> Are you really sure you want to delete this? <span class="muted">${consequence}</span></div><div class="page-actions"><button class="button button--compact" data-cancel>Cancel</button><button class="button button--compact button--danger">Delete ${subject}</button></div></div></td></tr>`
    : "";
}

function patientsList() {
  const rows = patients.filter((p) =>
    (p.name + p.ref).toLowerCase().includes(query.toLowerCase()),
  );
  return `${header("Patient library", "Patients", "", `<a class="button button--primary" href="#/patients/new">Add patient</a>`)}
    <div class="table-toolbar">${search("Search patients", "Search by name or patient number")}${count(rows.length, patients.length, "patients")}</div>
    <table class="data-table"><thead><tr><th>Patient</th><th>Patient number</th><th class="hide-narrow">Notes</th><th class="hide-narrow">Documents</th><th class="hide-narrow">Redactions</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
    ${rows.map((p) => `<tr class="row-link" data-href="#/patients/${p.id}/notes"><td><strong>${esc(p.name)}</strong></td><td class="mono">${esc(p.ref || "—")}</td><td class="hide-narrow">${p.notes}</td><td class="hide-narrow">${p.documents}</td><td class="hide-narrow">${p.redactions}</td><td class="actions"><a class="button button--compact" href="#/patients/${p.id}/new-note">New note</a></td></tr>`).join("")}
    </tbody></table>`;
}

function newPatient() {
  return `${crumbs([["Patients", "#/patients"], ["New patient"]])}
    ${header("Patient library", "New patient", "Add the details you use to recognise this patient. They stay in the encrypted library on this Mac.")}
    <form class="panel">
      <div class="field"><label for="n">Patient name</label><input id="n" autocomplete="off" /></div>
      <div class="field"><label for="r">Patient number <span class="muted">(optional)</span></label><input id="r" autocomplete="off" /><span class="hint">Your local reference, for example a case number.</span></div>
      <div class="form-actions"><a class="button button--primary" href="#/patients/1/notes">Add patient</a><a class="button button--quiet" href="#/patients">Cancel</a></div>
    </form>`;
}

function ribbon(p, tab) {
  const t = (id, label, count) =>
    `<a role="tab" href="#/patients/${p.id}/${id}" aria-selected="${tab === id}">${label}${count === undefined ? "" : `<span class="count">${count}</span>`}</a>`;
  return `${crumbs([["Patients", "#/patients"], [p.name]])}
    <section class="patient-ribbon">
      ${header("Patient", `${esc(p.name)}${p.ref ? `<span class="reference">${esc(p.ref)}</span>` : ""}`, "", `<a class="button button--primary" href="#/patients/${p.id}/new-note">New note</a>`)}
      <nav class="tabs" role="tablist" aria-label="Patient sections">${t("details", "Details")}${t("notes", "Notes", p.notes)}${t("documents", "Documents", p.documents)}${t("redactions", "Redactions", p.redactions)}</nav>
    </section>`;
}

function details(p) {
  return `${ribbon(p, "details")}<section class="tab-panel" role="tabpanel">
    <form class="form-stack">
      <div class="field"><label for="n">Patient name</label><input id="n" value="${esc(p.name)}" autocomplete="off" /></div>
      <div class="field"><label for="r">Patient number <span class="muted">(optional)</span></label><input id="r" value="${esc(p.ref)}" autocomplete="off" /><span class="hint">Your local reference, for example a case number.</span></div>
      <div class="form-actions"><button type="button" class="button" disabled>Save changes</button><button type="button" class="button button--quiet" disabled>Undo changes</button></div>
    </form>
    ${
      confirming === "patient"
        ? `<div class="danger-zone notice notice--danger" role="alert"><div><strong>Delete ${esc(p.name)}?</strong> Are you really sure you want to delete this?<br /><span class="muted">Their ${p.notes} notes and ${p.redactions} patient redactions will also be deleted from the encrypted library.</span></div><div class="page-actions"><button class="button" data-cancel>Cancel</button><button class="button button--danger">Delete patient</button></div></div>`
        : `<div class="danger-zone"><div><p class="section-title">Delete patient</p><p class="muted">Removes this patient, their notes and their redactions from this Mac.</p></div><button class="button button--danger-quiet" data-confirm="patient">Delete patient…</button></div>`
    }
  </section>`;
}

function notesTable(rows, withPatient) {
  if (!rows.length && !query)
    return `<div class="empty-state"><p class="section-title">No notes yet</p><p class="muted">Start a note to de-identify text for this patient.</p><a class="button button--primary" href="#/patients/2/new-note">New note</a></div>`;
  const cols = withPatient ? 5 : 4;
  return `<table class="data-table"><thead><tr>${withPatient ? "<th>Patient</th>" : ""}<th>Title</th><th class="hide-narrow">Reviewed text</th><th>Saved</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
    ${
      rows
        .map((n) => {
          const p = patients.find((x) => x.id === n.patient);
          return `<tr class="row-link" data-href="#/patients/${n.patient}/new-note">${withPatient ? `<td>${esc(p.name)}</td>` : ""}<td><strong>${esc(n.title)}</strong></td><td class="excerpt">${placeholders(n.excerpt)}</td><td class="mono">${n.saved}</td><td class="actions"><button class="button button--compact button--danger-quiet" data-confirm="note-${n.id}">Delete</button></td></tr>${confirmRow(`note-${n.id}`, cols, "note", "Its original text, reviewed text and review record will be deleted.")}`;
        })
        .join("") ||
      `<tr><td colspan="${cols}" class="muted">No notes match “${esc(query)}”.</td></tr>`
    }
    </tbody></table>`;
}
const matchNote = (n) =>
  (n.title + n.excerpt).toLowerCase().includes(query.toLowerCase());

function patientNotes(p) {
  const rows = notes.filter((n) => n.patient === p.id && matchNote(n));
  return `${ribbon(p, "notes")}<section class="tab-panel" role="tabpanel">
    ${p.notes ? `<div class="table-toolbar">${search("Search notes", "Search titles and reviewed text")}${count(rows.length, p.notes, "notes")}</div>` : ""}
    ${notesTable(rows, false)}</section>`;
}

function allNotes() {
  const rows = notes.filter(matchNote);
  return `${header("Encrypted library", "Notes", "Reviewed notes for every patient. Open a patient to start a new note.")}
    <div class="table-toolbar">${search("Search notes", "Search titles and reviewed text")}${count(rows.length, notes.length, "notes")}</div>
    ${notesTable(rows, true)}`;
}

function patientDocuments(p) {
  const rows =
    p.id === 1
      ? `<tr><td><strong>GP progress letter</strong></td><td>GP letter</td><td class="mono">24 Sep 2026</td><td><span class="badge">Reviewed</span></td></tr>`
      : "";
  return `${ribbon(p, "documents")}<section class="tab-panel" role="tabpanel">
    <div class="table-toolbar"><span class="meta muted">${p.documents} documents</span><a class="button button--primary" href="#/patients/${p.id}/new-document">New document</a></div>
    ${rows ? `<table class="data-table"><thead><tr><th>Title</th><th>Template</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty-state"><p class="section-title">No documents yet</p><p class="muted">Create a document from this patient’s completed reviewed notes.</p><a class="button button--primary" href="#/patients/${p.id}/new-document">New document</a></div>`}
  </section>`;
}

function newDocument(p) {
  const patientNotes = notes.filter((note) => note.patient === p.id);
  return `${crumbs([["Patients", "#/patients"], [p.name, `#/patients/${p.id}/documents`], ["Documents", `#/patients/${p.id}/documents`], ["New document"]])}
    ${header("Patient document", "New document", `${esc(p.name)} · Patient number ${esc(p.ref)}`)}
    <ol class="workflow-steps" aria-label="Document progress"><li aria-current="step">Choose notes</li><li>Review submission</li><li>Review document</li></ol>
    <form class="form-stack document-create">
      <div class="document-create-grid">
        <section class="form-stack" aria-label="Document details">
          <label class="field"><span>Document title</span><input value="GP progress letter" /></label>
          <label class="field"><span>Template</span><select><option>GP letter</option><option>Referral letter</option><option>Progress report</option></select></label>
          <label class="field"><span>Model</span><select><option>GPT-4.1 mini · Lower cost — US$0.40 in / US$1.60 out per 1M tokens</option><option>GPT-4.1 — US$2.00 in / US$8.00 out per 1M tokens</option></select><span class="hint">Using your Settings default. Changing this selection affects only this document.</span></label>
          <p class="muted">Estimated generation cost appears during submission review, before anything is sent.</p>
        </section>
        <label class="field field--wide document-custom-instructions"><span>Additional instructions (optional)</span><textarea rows="12" placeholder="For example: Focus on agreed next steps."></textarea><span class="hint">Added to this document only. You will review it before anything is sent.</span></label>
      </div>
      <fieldset class="choice-list"><legend class="section-title">Select notes</legend>${patientNotes.map((note, index) => `<label class="choice-row"><input type="checkbox" ${index < 2 ? "checked" : ""} /><span>${esc(note.title)}</span><span class="mono muted">${note.saved}</span></label>`).join("")}</fieldset>
      <p class="meta muted">2 notes selected · Ordered oldest first</p>
      <p class="notice"><strong>Clinical sending is not enabled.</strong> You can inspect this workflow, but no clinical material can leave this Mac until the information-governance setup requirements are recorded.</p>
      <div class="form-actions form-actions--split"><a class="button" href="#/patients/${p.id}/documents">Cancel</a><button class="button button--primary">Review submission</button></div>
    </form>`;
}

function templateList() {
  return `${header("Global instructions", "Document prompt templates", "Instructions available for every patient. Editing a template does not change existing documents.", `<button class="button button--primary">New template</button>`)}
    <div class="table-toolbar">${search("Search templates", "Search templates")}${count(templates.length, templates.length, "templates")}</div>
    <table class="data-table"><thead><tr><th>Name</th><th>Description</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${templates.map((template) => `<tr><td><strong>${template.name}</strong></td><td>${template.description}</td><td>${template.status}</td><td class="actions"><button class="link-button">Edit</button> · <button class="link-button">Duplicate</button> · <button class="link-button">Archive</button></td></tr>`).join("")}</tbody></table>
    <form class="panel form-stack template-form"><h2 class="section-title">Edit template</h2><label class="field"><span>Name</span><input value="GP letter" /></label><label class="field"><span>Description</span><input value="Summarise care for the GP" /></label><label class="field"><span>Instructions</span><textarea rows="6">Write a letter using only the supplied notes. Include presentation, relevant history, progress, and next steps. Use professional British English. Do not invent missing details.</textarea></label><div class="form-actions form-actions--split"><button class="button">Cancel</button><button class="button button--primary">Save changes</button></div></form>`;
}

function redactionTable(rows, scope) {
  const matches = rows.filter((r) =>
    (r.phrase + r.replacement).toLowerCase().includes(query.toLowerCase()),
  );
  const row = (r, i) => {
    const key = `edit-${scope}-${i}`;
    const identifier = `<td><strong>${esc(r.phrase)}</strong>${r.overrides ? ` <span class="badge">Overrides all-patients</span>` : ""}</td>`;
    return confirming === key
      ? `<tr class="edit-row">${identifier}<td><label class="visually-hidden" for="${key}">Replace ${esc(r.phrase)} with</label><input id="${key}" class="mono inline-input" value="${esc(r.replacement)}" spellcheck="false" autocomplete="off" /></td><td class="hide-narrow">${r.category}</td><td class="mono">${r.updated}</td><td class="actions"><button class="button button--compact button--quiet" data-cancel>Cancel</button> <button class="button button--compact">Save</button></td></tr>`
      : `<tr>${identifier}<td>${placeholders(r.replacement)}</td><td class="hide-narrow">${r.category}</td><td class="mono">${r.updated}</td><td class="actions"><button class="button button--compact" data-confirm="${key}">Edit</button></td></tr>`;
  };
  return `<div class="table-toolbar">${search("Search redactions", "Search identifiers and replacements")}${count(matches.length, rows.length, "redactions")}</div>
    ${
      rows.length
        ? `<table class="data-table"><thead><tr><th>Identifier</th><th>Replaced with</th><th class="hide-narrow">Category</th><th>Updated</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
        ${matches.map((r) => row(r, rows.indexOf(r))).join("") || `<tr><td colspan="5" class="muted">No redactions match “${esc(query)}”.</td></tr>`}
        </tbody></table>`
        : `<div class="empty-state"><p class="section-title">No redactions yet</p><p class="muted">While you review a note, choose to save a replacement and it will appear here.</p></div>`
    }`;
}

function patientRedactions(p) {
  const rows = redactions.filter((r) => r.patient === p.id);
  const globals = redactions.filter((r) => r.patient === null).length;
  return `${ribbon(p, "redactions")}<section class="tab-panel" role="tabpanel">
    <p class="notice">Applied automatically to new notes for ${esc(p.name)}. These take precedence over the ${globals} <a href="#/redactions">all-patients redactions</a>, which also apply.</p>
    ${redactionTable(rows, "p")}</section>`;
}

function globalRedactions() {
  return `${header("Reusable defaults", "Redactions", "Applied automatically to new notes for every patient. A patient’s own redactions take precedence.")}
    ${redactionTable(
      redactions.filter((r) => r.patient === null),
      "g",
    )}`;
}

function newNote(p) {
  return `${crumbs([["Patients", "#/patients"], [p.name, `#/patients/${p.id}/notes`], ["New note"]])}
    ${header(`New note · ${esc(p.name)}`, "De-identify text", "Find possible identifiers, review each change, then save the reviewed note.", `<a class="button button--quiet" href="#/patients/${p.id}/notes">Discard</a>`)}
    <ol class="stepper" aria-label="Review stages"><li data-state="complete">1 · Analyse</li><li data-state="current" aria-current="step">2 · Review <span class="badge badge--pending">2 left</span></li><li>3 · Final check</li><li>4 · Save</li></ol>
    <article class="review-card"><div><p class="eyebrow">Person · 2 occurrences · To review</p><p class="section-title">Alex Morgan</p><p class="muted">Found by: local model, saved redaction.</p></div>
      <div class="form-stack"><div class="field"><label for="ph">Replace with</label><input id="ph" class="mono" value="[CLIENT]" /></div><div class="page-actions"><button class="button button--primary">Accept</button><button class="button">Keep</button><button class="button">Remove</button></div></div></article>
    <div class="split"><section class="pane"><h3>Source text</h3><mark>Alex Morgan</mark> attended a review in <mark data-decided>Bristol</mark>. <mark>Alex Morgan</mark> reported improved sleep.</section><section class="pane"><h3>Proposed result</h3><mark>[CLIENT]</mark> attended a review in <mark data-decided>[CITY]</mark>. <mark>[CLIENT]</mark> reported improved sleep.</section></div>
    <section class="save-bar" aria-label="Save reviewed note"><div class="field"><label for="t">Note title</label><input id="t" value="Sleep review" /><span class="hint">Saving is available after the final check.</span></div><div class="page-actions"><button class="button" disabled>Copy reviewed text</button><button class="button button--primary" disabled>Save note</button></div></section>`;
}

function settings() {
  return `${header("Local configuration", "Settings", "Model files are the only files this app downloads. Source text is never included.")}
    <section class="panel"><div><p class="section-title">Local detection model</p><p class="muted">BERT NER · English · installed</p></div><div class="page-actions"><button class="button">Verify model</button><button class="button">Replace model</button><button class="button button--danger-quiet">Remove model…</button></div></section>
    <form class="panel form-stack settings-documents"><h2 class="section-title">OpenAI</h2><div class="settings-row"><div><strong>API key</strong><p class="muted">Saved in macOS Keychain</p></div><input type="password" placeholder="Enter a replacement key" /><button class="button button--compact">Remove key</button><button class="button button--compact">Test connection</button></div><label class="field"><span>Default model</span><select data-default-model><option value="mini">GPT-4.1 mini · Lower cost — US$0.40 in / US$1.60 out per 1M tokens</option><option value="standard">GPT-4.1 — US$2.00 in / US$8.00 out per 1M tokens</option></select><span class="hint">Used for new documents. Each document can choose a different model.</span></label><p class="notice"><strong>Clinical sending:</strong> Not enabled — setup requirements outstanding. Saving an API key does not enable submissions.</p><h2 class="section-title">Clinician details</h2><label class="field"><span>Display name</span><input value="Dr Jamie Ellis" /></label><label class="field"><span>Role</span><input value="Clinical psychologist" /></label><label class="field"><span>Qualifications</span><input /></label><h2 class="section-title">Signature</h2><div class="signature-pad">Draw with mouse or trackpad</div><p class="muted">Your details and signature are added on this Mac after generation.</p><div class="form-actions"><button class="button button--primary">Save changes</button></div></form>
    <section class="panel form-stack"><h2 class="section-title">Usage and costs</h2><p class="hint">Synthetic example totals</p><label class="field"><span>Period</span><select><option>This month</option><option>All time</option></select></label>
    <table class="data-table"><thead><tr><th>Metric</th><th>Total</th></tr></thead><tbody><tr><td>Reports created</td><td class="mono">12</td></tr><tr><td>Generation attempts</td><td class="mono">15</td></tr><tr><td>Estimated spend in this app</td><td class="mono">US$0.18</td></tr><tr><td>Average cost per report</td><td class="mono">US$0.015</td></tr></tbody></table><p class="muted">Costs use returned token usage and the prices recorded for each attempt.</p><p class="hint">Reports count once on first successful generation. Regenerations add attempts and cost. This is not your whole OpenAI account bill.</p></section>`;
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [section, id, sub] = parts;
  const p = patients.find((x) => String(x.id) === id);
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === (section || "patients"))
      a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.querySelector("[data-activity]").hidden = sub !== "new-note";
  view.innerHTML =
    section === "notes"
      ? allNotes()
      : section === "redactions"
        ? globalRedactions()
        : section === "templates"
          ? templateList()
          : section === "settings"
            ? settings()
            : id === "new"
              ? newPatient()
              : p && sub === "details"
                ? details(p)
                : p && sub === "redactions"
                  ? patientRedactions(p)
                  : p && sub === "documents"
                    ? patientDocuments(p)
                    : p && sub === "new-document"
                      ? newDocument(p)
                      : p && sub === "new-note"
                        ? newNote(p)
                        : p
                          ? patientNotes(p)
                          : patientsList();
  const q = view.querySelector("#q");
  view.querySelector("[data-search]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    query = q.value.trim();
    route();
    view.querySelector("#q").focus();
  });
}
view.addEventListener("click", (e) => {
  const c = e.target.closest("[data-confirm]");
  if (c) {
    e.stopPropagation();
    confirming = c.dataset.confirm;
    route();
    const input = view.querySelector(".inline-input");
    if (input) {
      input.focus();
      input.select();
    }
    return;
  }
  if (e.target.closest("[data-clear]")) {
    query = "";
    route();
    return view.querySelector("#q").focus();
  }
  if (e.target.closest("[data-cancel]")) {
    confirming = null;
    return route();
  }
  const row = e.target.closest("[data-href]");
  if (row && !e.target.closest("a,button,input,select"))
    location.hash = row.dataset.href;
});
view.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && confirming) {
    confirming = null;
    route();
  }
});
addEventListener("hashchange", () => {
  confirming = null;
  query = "";
  route();
});
route();
