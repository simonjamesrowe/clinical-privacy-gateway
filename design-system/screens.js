// Clickable composition of the target screens. Synthetic content only.
const patients = [
  { id: 1, name: "Alex Morgan", ref: "SYN-2048", notes: 3, redactions: 2 },
  { id: 2, name: "Sam Okafor", ref: "SYN-3117", notes: 1, redactions: 0 },
  { id: 3, name: "Jordan Reyes", ref: "", notes: 0, redactions: 1 },
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
    <table class="data-table"><thead><tr><th>Patient</th><th>Patient number</th><th class="hide-narrow">Notes</th><th class="hide-narrow">Redactions</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
    ${rows.map((p) => `<tr class="row-link" data-href="#/patients/${p.id}/notes"><td><strong>${esc(p.name)}</strong></td><td class="mono">${esc(p.ref || "—")}</td><td class="hide-narrow">${p.notes}</td><td class="hide-narrow">${p.redactions}</td><td class="actions"><a class="button button--compact" href="#/patients/${p.id}/new-note">New note</a></td></tr>`).join("")}
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
      <nav class="tabs" role="tablist" aria-label="Patient sections">${t("details", "Details")}${t("notes", "Notes", p.notes)}${t("redactions", "Redactions", p.redactions)}</nav>
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
    <section class="panel"><div><p class="section-title">Local detection model</p><p class="muted">BERT NER · English · installed</p></div><div class="page-actions"><button class="button">Verify model</button><button class="button">Replace model</button><button class="button button--danger-quiet">Remove model…</button></div></section>`;
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
        : section === "settings"
          ? settings()
          : id === "new"
            ? newPatient()
            : p && sub === "details"
              ? details(p)
              : p && sub === "redactions"
                ? patientRedactions(p)
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
