import type {
  Detection,
  MappingView,
  ModelStatus,
  NoteSummary,
  NoteView,
  OpenedNote,
  PatientView,
  PrivacyBridge,
  ReviewSession,
} from "./types";
import "../styles/review.css";
import { normalisePlaceholder, placeholderError } from "./placeholder";
import type { Progress } from "./types";

type Work = "download" | "analysis" | "rescan" | "review" | "copy";
type Screen = "patients" | "review" | "notes" | "mappings" | "settings";

const EXAMPLE =
  "Alex Morgan attended a review in Bristol on 12 March 2026. Alex Morgan reported improved sleep and no change to the prescribed 10 mg dose. Contact: alex.morgan@example.invalid. Case reference: SYN-2048.";

const DECISION_LABEL = {
  pending: "pending",
  accept: "accepted",
  edit: "edited",
  keep: "kept",
  remove: "removed",
};
const STAGE_LABEL: Record<string, string> = {
  ner: "local model",
  rules: "identifier patterns",
  manual: "manual selection",
  library: "saved mapping",
};

export class TextReviewPage {
  private source = "";
  private session: ReviewSession | null = null;
  private model: ModelStatus | null = null;
  private drafts = new Map<number, string>();
  private busy = false;
  private operation = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  private dismissDiscard?: () => void;
  private selection: { start: number; end: number } | null = null;
  private message = "";
  private error = "";
  private initialising = false;
  private work: Work | null = null;
  private workProgress: Progress | null = null;
  private cancelling = false;
  private screen: Screen = "review";
  private resolvedOpen = false;
  private notes: NoteSummary[] = [];
  private savedTitle: string | null = null;
  private noteQuery = "";
  private mappings: MappingView[] = [];
  private patientMappings: MappingView[] = [];
  private reviewSavedMappings = false;
  private wizardGroup: number | null = null;
  private wizardGroupIds: number[] = [];
  private editingMapping: MappingView | null = null;
  private editingPatientMapping = false;
  private patients: PatientView[] = [];
  private patient: PatientView | null = null;
  constructor(
    private root: HTMLElement,
    private bridge: PrivacyBridge,
    private onHome: () => void,
    initialScreen: Screen = "review",
  ) {
    this.screen = initialScreen;
  }

  async mount(): Promise<void> {
    this.initialising = this.bridge.available;
    this.render();
    if (!this.bridge.available) return;
    try {
      const unsubscribe = await this.bridge.progress((event) => {
        if (this.disposed || event.operation !== this.operation || !this.busy)
          return;
        if (this.cancelling) return;
        this.workProgress = event;
        const percentage = this.progressPercent();
        this.message =
          percentage === null
            ? event.stage
            : `${event.stage} · ${Math.floor(percentage)}%`;
        this.updateStatus();
      });
      if (this.disposed) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
      this.model = await this.bridge.call<ModelStatus>("model_status");
    } catch {
      this.error = "Model status is unavailable. Reopen this page to retry.";
    }
    this.initialising = false;
    if (!this.disposed) {
      if (this.screen === "patients") await this.loadPatients();
      else if (this.screen === "notes") await this.loadNotes();
      else this.render();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.dismissDiscard?.();
    this.unsubscribe?.();
    this.source = "";
    this.session = null;
    this.selection = null;
    this.drafts.clear();
    this.workProgress = null;
    this.work = null;
    this.root.replaceChildren();
  }
  private el<T extends Element>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }
  private bind(selector: string, action: () => void): void {
    this.el(selector).addEventListener("click", action);
  }
  private updateStatus(): void {
    if (this.disposed) return;
    if (this.screen !== "review") {
      this.updateOverlay();
      return;
    }
    this.el<HTMLElement>("[data-status]").textContent = this.message;
    this.el<HTMLElement>("[data-error]").textContent = this.error;
    this.updateWorkflow();
    this.updateOverlay();
  }
  private progressPercent(): number | null {
    const progress = this.workProgress;
    return progress &&
      Number.isFinite(progress.total) &&
      progress.total > 0 &&
      Number.isFinite(progress.completed)
      ? Math.max(0, Math.min(100, (100 * progress.completed) / progress.total))
      : null;
  }
  private updateWorkflow(): void {
    const pending = (this.session?.pending ?? 0) > 0 || this.drafts.size > 0;
    const checked = this.session?.checked === true && !pending;
    const current =
      this.initialising || this.work === "download" || !this.model?.installed
        ? 0
        : !this.session
          ? 1
          : pending
            ? 2
            : 3;
    const complete = checked && !this.initialising && this.work !== "download";
    this.root
      .querySelectorAll<HTMLElement>("[data-step]")
      .forEach((step, index) => {
        const state =
          index < current || complete
            ? "complete"
            : index === current
              ? "current"
              : "upcoming";
        step.dataset.state = state;
        if (state === "current") step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
        step.querySelector("[data-step-number]")!.textContent =
          state === "complete" ? "✓" : String(index + 1);
        step.querySelector("[data-step-status]")!.textContent =
          state === "complete"
            ? "Complete"
            : state === "current"
              ? "Current step"
              : "Upcoming";
      });
    const running =
      this.initialising ||
      (this.busy &&
        ["download", "analysis", "rescan"].includes(this.work ?? ""));
    const progress = this.el<HTMLProgressElement>("[data-progress]");
    progress.hidden = !running;
    const percentage = this.cancelling ? null : this.progressPercent();
    if (percentage === null) progress.removeAttribute("value");
    else progress.value = percentage;
    progress.setAttribute(
      "aria-label",
      this.work === "download"
        ? "Model download progress"
        : this.work === "rescan"
          ? "Final check progress"
          : "Analysis progress",
    );
    this.el<HTMLButtonElement>("[data-cancel]").hidden =
      !running || this.initialising;
    this.el<HTMLButtonElement>("[data-cancel]").disabled = this.cancelling;
    const guidance = !this.bridge.available
      ? "Open the macOS app to start local processing."
      : this.initialising
        ? "Verifying the local model…"
        : current === 0
          ? "Download and verify the model once to get started."
          : current === 1
            ? "Enter source text, then choose Find identifiers."
            : current === 2
              ? "Review the yellow cards. Green cards have a decision."
              : checked
                ? "Final check complete. Reviewed text is ready to copy."
                : "Decisions complete. Run the final check before copying.";
    this.el<HTMLElement>("[data-status]").textContent =
      this.message || guidance;
    this.el<HTMLElement>("[data-work-detail]").textContent = running
      ? this.cancelling
        ? "Waiting for the current local operation to stop."
        : this.workProgress &&
            this.work !== "download" &&
            this.workProgress.total > 0
          ? `Section ${Math.min(this.workProgress.completed, this.workProgress.total)} of ${this.workProgress.total} · Processing on this Mac`
          : this.work === "download"
            ? "Downloading model files only; source text stays on this Mac."
            : "Processing on this Mac. Loading can take a moment."
      : "";
  }
  private render(): void {
    // A model-status reply must not replace an open confirmation dialog.
    if (this.disposed || this.dismissDiscard) return;
    if (this.screen === "notes") {
      this.renderNotes();
      return;
    }
    if (this.screen === "patients") {
      this.renderPatients();
      return;
    }
    if (this.screen === "mappings") {
      this.renderMappings();
      return;
    }
    if (this.screen === "settings") {
      this.renderSettings();
      return;
    }
    this.root.innerHTML = `
      <section class="review-page" aria-labelledby="review-title">
        <nav class="review-nav" aria-label="Application"><button type="button" data-home>← Home</button><button type="button" data-route="patients">Patients</button><button type="button" data-route="notes">Notes</button><button type="button" data-route="mappings">Mappings</button><button type="button" data-route="settings">Settings</button><span class="local-indicator">On this Mac</span></nav>
        <header class="review-heading"><div><p class="eyebrow">${this.savedTitle ? `Editing note · ${this.patient?.name ?? "Patient"}` : `New note · ${this.patient?.name ?? "Choose a patient"}`}</p><h1 id="review-title">De-identify text</h1><p>Find possible identifiers. Review each change. Keep the wording that matters.</p></div><button type="button" data-discard>Discard session</button></header>
        <section class="workflow-panel" aria-label="Text review stages"><ol class="workflow-steps">${["Verify model", "Analyse", "Review", "Final check"].map((name, index) => `<li data-step><span class="step-number" data-step-number aria-hidden="true">${index + 1}</span><span>${name}<span class="visually-hidden" data-step-status></span></span></li>`).join("")}</ol><div class="workflow-activity"><div><p class="review-status" role="status" data-status></p><p class="work-detail" data-work-detail></p></div><button type="button" data-cancel hidden>Cancel processing</button></div><progress data-progress max="100" hidden></progress><p class="review-error" role="alert" data-error></p></section>
        <aside class="model-panel" data-model-panel aria-label="Local detection model"><div><strong data-model-title></strong><p data-model-description></p></div><button type="button" data-install>Open Settings</button></aside>
        <div class="review-toolbar"><p>Source text stays in this session. After the final check, you can save the reviewed note.</p></div>
        <div data-workspace aria-busy="${this.busy}"></div>
        <aside class="scope-note"><strong>What this check covers</strong><p>Identifier patterns and possible names, places and organisations. Initials, nicknames, misspellings and parts of organisation names can be missed; model proposals can include clinical terms. File paths and indirect identifying combinations are not checked in this version. Review the whole text, including unmarked phrases.</p></aside>
      </section>${this.overlayMarkup()}`;
    this.bind("[data-home]", () => {
      void this.leave(true);
    });
    this.bind("[data-discard]", () => {
      void this.leave(false);
    });
    this.bind("[data-cancel]", () => {
      void this.cancel();
    });
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-route]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () => void this.navigate(button.dataset.route as Screen),
        ),
      );
    this.root
      .querySelector<HTMLButtonElement>("[data-overlay-cancel]")
      ?.addEventListener("click", () => void this.cancel());
    const ready = this.model?.installed === true;
    this.el<HTMLElement>("[data-model-title]").textContent = ready
      ? "Local detection is ready"
      : "Set up local detection";
    this.el<HTMLElement>("[data-model-description]").textContent = !this.bridge
      .available
      ? "Open the macOS app to download the model and process text. This browser preview does not run detection."
      : ready
        ? "Rules + BERT NER · English · Works offline"
        : "Download BERT NER once (110 MB) from Hugging Face. Only model files are downloaded; source text is never sent.";
    this.el<HTMLButtonElement>("[data-install]").textContent = "Open Settings";
    this.el<HTMLButtonElement>("[data-install]").disabled =
      this.busy || !this.bridge.available || !this.model;
    this.el<HTMLButtonElement>("[data-install]").hidden = ready;
    this.el<HTMLElement>("[data-model-panel]").hidden = ready;
    this.el<HTMLButtonElement>("[data-install]").onclick = () =>
      void this.navigate("settings");
    this.el<HTMLButtonElement>("[data-home]").disabled = this.busy;
    this.el<HTMLButtonElement>("[data-discard]").disabled = this.busy;
    if (this.session) this.renderReview(this.session);
    else this.renderInput(ready);
    this.updateStatus();
  }
  private navigation(): string {
    return `<nav class="review-nav" aria-label="Application"><button type="button" data-home>← Home</button><button type="button" data-route="patients">Patients</button><button type="button" data-route="notes">Notes</button><button type="button" data-route="mappings">Mappings</button><button type="button" data-route="settings">Settings</button><span class="local-indicator">On this Mac</span></nav>`;
  }
  private overlayMarkup(): string {
    return `<div class="operation-overlay" data-overlay hidden><section role="status" aria-live="polite"><p class="eyebrow">Working locally</p><h2 data-overlay-title></h2><p data-overlay-detail></p><progress data-overlay-progress max="100"></progress><button type="button" data-overlay-cancel>Cancel</button></section></div>`;
  }
  private bindNavigation(): void {
    this.bind("[data-home]", () => void this.leave(true));
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-route]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () => void this.navigate(button.dataset.route as Screen),
        ),
      );
    this.root
      .querySelector<HTMLButtonElement>("[data-overlay-cancel]")
      ?.addEventListener("click", () => void this.cancel());
  }
  private updateOverlay(): void {
    const overlay = this.root.querySelector<HTMLElement>("[data-overlay]");
    if (!overlay) return;
    const workspace = this.root.querySelector<HTMLElement>(".review-page");
    if (workspace) workspace.inert = this.busy;
    overlay.hidden = !this.busy;
    if (!this.busy) return;
    overlay.querySelector<HTMLElement>("[data-overlay-title]")!.textContent =
      this.message || "Working locally";
    overlay.querySelector<HTMLElement>("[data-overlay-detail]")!.textContent =
      this.cancelling
        ? "Waiting for the current operation to stop."
        : this.workProgress && this.workProgress.total > 0
          ? `${Math.floor(this.progressPercent() ?? 0)}% complete`
          : "This stays on this Mac.";
    const progress = overlay.querySelector<HTMLProgressElement>(
      "[data-overlay-progress]",
    )!;
    const percentage = this.progressPercent();
    if (percentage === null) progress.removeAttribute("value");
    else progress.value = percentage;
    const cancellable = ["download", "analysis", "rescan"].includes(
      this.work ?? "",
    );
    const cancel = overlay.querySelector<HTMLButtonElement>(
      "[data-overlay-cancel]",
    )!;
    cancel.hidden = !cancellable;
    cancel.disabled = this.cancelling;
  }
  private async navigate(screen: Screen): Promise<void> {
    if (this.busy || this.disposed) return;
    if (screen === "review" && !this.patient) {
      this.error = "Choose a patient before starting a new note.";
      this.screen = "patients";
      await this.loadPatients();
      return;
    }
    this.screen = screen;
    this.error = "";
    if (screen === "patients") await this.loadPatients();
    if (screen === "notes") await this.loadNotes();
    if (screen === "mappings") await this.loadMappings();
    if (screen === "settings" && this.bridge.available) {
      try {
        this.model = await this.bridge.call<ModelStatus>("model_status");
      } catch {
        this.error = "Model status is unavailable. Try again.";
      }
    }
    this.render();
  }
  private renderPatients(): void {
    this.root.innerHTML = `<section class="review-page library-page" aria-labelledby="patients-title">${this.navigation()}<header class="review-heading"><div><p class="eyebrow">Patient workspace</p><h1 id="patients-title">Patients</h1><p>Choose a patient before creating a new note.</p></div><button type="button" class="primary" data-add-patient>Add patient</button></header><p class="review-error" data-error role="alert"></p><section data-patient-list></section></section>${this.overlayMarkup()}`;
    this.bindNavigation();
    this.el<HTMLElement>("[data-error]").textContent = this.error;
    this.el<HTMLButtonElement>("[data-add-patient]").onclick = () =>
      this.addPatientDialog();
    const list = this.el<HTMLElement>("[data-patient-list]");
    if (!this.patients.length)
      list.innerHTML = `<p class="empty-state">Add a patient to create their first note.</p>`;
    else {
      const table = document.createElement("table");
      table.className = "notes-table patients-table";
      table.innerHTML = `<thead><tr><th>Patient</th><th>Patient number</th><th><span class="visually-hidden">Actions</span></th></tr></thead>`;
      const body = document.createElement("tbody");
      for (const patient of this.patients) {
        const row = document.createElement("tr");
        row.innerHTML = `<td></td><td></td><td></td>`;
        row.cells[0].textContent = patient.name;
        row.cells[1].textContent = patient.patientReference ?? "—";
        const start = document.createElement("button");
        start.type = "button";
        start.textContent = "New note";
        start.onclick = () => this.startNote(patient);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.onclick = () => void this.removePatient(patient);
        row.cells[2].append(start, remove);
        body.append(row);
      }
      table.append(body);
      list.append(table);
    }
    this.updateOverlay();
  }
  private async loadPatients(): Promise<void> {
    const result = await this.perform("Loading patients…", () =>
      this.bridge.call<PatientView[]>("list_patients"),
    );
    if (result) this.patients = result;
    this.render();
  }
  private async createPatient(
    name: string,
    patientReference: string | undefined,
  ): Promise<void> {
    const result = await this.perform("Adding patient…", () =>
      this.bridge.call<PatientView>("create_patient", {
        name,
        patientReference,
      }),
    );
    if (result) {
      this.startNote(result);
      return;
    } else this.screen = "patients";
    this.render();
  }
  private addPatientDialog(): void {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-labelledby", "add-patient-title");
    dialog.innerHTML = `<form method="dialog" class="save-note-form"><h2 id="add-patient-title">Add patient</h2><label>Patient name <input data-patient-name autocomplete="off" required maxlength="160" /></label><label>Patient number <input data-patient-reference autocomplete="off" maxlength="128" /></label><p class="review-error" data-patient-error role="alert"></p><div class="decision-buttons"><button type="button" data-cancel-patient>Cancel</button><button class="primary">Add patient</button></div></form>`;
    this.root.append(dialog);
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.querySelector<HTMLButtonElement>("[data-cancel-patient]")!.onclick =
      close;
    dialog
      .querySelector<HTMLFormElement>("form")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const name = dialog.querySelector<HTMLInputElement>(
          "[data-patient-name]",
        )!.value;
        const reference = dialog.querySelector<HTMLInputElement>(
          "[data-patient-reference]",
        )!.value;
        void this.createPatient(name, reference || undefined).then(() => {
          if (this.screen === "review") close();
        });
      });
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("[data-patient-name]")!.focus();
  }
  private startNote(patient: PatientView): void {
    this.patient = patient;
    this.screen = "review";
    this.source = "";
    this.session = null;
    this.savedTitle = null;
    this.reviewSavedMappings = false;
    this.wizardGroup = null;
    this.wizardGroupIds = [];
    this.selection = null;
    this.drafts.clear();
    if (this.bridge.available)
      void this.bridge.call("discard_session").catch(() => undefined);
    this.render();
  }
  private renderNotes(): void {
    this.root.innerHTML = `<section class="review-page library-page" aria-labelledby="notes-title">${this.navigation()}<header class="review-heading"><div><p class="eyebrow">Encrypted library</p><h1 id="notes-title">Notes</h1><p>Search reviewed text and open a saved note in the review workspace.</p></div><button type="button" class="primary" data-new-note>New note</button></header><form class="library-search" data-note-search><label for="note-search">Search notes</label><div><input id="note-search" autocomplete="off" /><button class="primary">Search</button></div></form><p class="review-error" role="alert" data-error></p><section data-note-results aria-live="polite"></section></section>${this.overlayMarkup()}`;
    this.bindNavigation();
    this.el<HTMLElement>("[data-error]").textContent = this.error;
    this.el<HTMLButtonElement>("[data-new-note]").onclick = () =>
      void this.navigate("patients");
    this.el<HTMLInputElement>("#note-search").value = this.noteQuery;
    this.root
      .querySelector<HTMLFormElement>("[data-note-search]")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        this.noteQuery = this.el<HTMLInputElement>("#note-search").value;
        void this.loadNotes();
      });
    const results = this.el<HTMLElement>("[data-note-results]");
    if (!this.notes.length) {
      results.innerHTML = `<p class="empty-state">No reviewed notes match this search.</p>`;
    } else {
      const table = document.createElement("table");
      table.className = "notes-table";
      table.innerHTML = `<thead><tr><th>Patient</th><th>Patient number</th><th>Note title</th><th>Reviewed note</th><th><span class="visually-hidden">Actions</span></th></tr></thead>`;
      const body = document.createElement("tbody");
      for (const note of this.notes) {
        const row = document.createElement("tr");
        row.innerHTML = `<td></td><td></td><td></td><td></td><td></td>`;
        row.cells[0].textContent = note.patientName ?? "Patient unavailable";
        row.cells[1].textContent = note.patientReference ?? "—";
        row.cells[2].textContent = note.title;
        row.cells[3].textContent = note.snippet
          .replaceAll("[", "")
          .replaceAll("]", "");
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Open";
        open.onclick = () => void this.openNote(note.id);
        row.cells[4].append(open);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.onclick = () => void this.removeNote(note.id);
        row.cells[4].append(remove);
        body.append(row);
      }
      table.append(body);
      results.append(table);
    }
    this.updateOverlay();
  }
  private renderMappings(): void {
    const patientScope = this.patient
      ? `<option value="patient">This patient · ${this.patient.name}</option>`
      : "";
    this.root.innerHTML = `<section class="review-page library-page" aria-labelledby="mappings-title">${this.navigation()}<header class="review-heading"><div><p class="eyebrow">Reusable defaults</p><h1 id="mappings-title">Identifier mappings</h1><p>Saved mappings apply automatically on new notes. Choose Review saved mappings before analysing when you want to decide them again.</p></div></header><form class="mapping-form" data-mapping-form><label>Identifier <input data-mapping-phrase autocomplete="off" required /></label><label>Category <select data-mapping-category>${["PERSON", "LOCATION", "ORGANISATION", "MISC", "EMAIL", "PHONE", "POSTCODE", "NHS_NUMBER", "NI_NUMBER", "URL", "DATE", "CASE_REFERENCE", "MANUAL"].map((category) => `<option>${category}</option>`).join("")}</select></label><label>Placeholder <input data-mapping-replacement spellcheck="false" autocomplete="off" required /></label><label>Scope <select data-mapping-editor-scope><option value="global">All patients</option>${patientScope}</select></label><div class="decision-buttons"><button class="primary" data-save-mapping>Save mapping</button><button type="button" data-cancel-mapping hidden>Cancel edit</button></div></form><p class="review-error" role="alert" data-error></p><section class="library-list" data-mapping-list></section></section>${this.overlayMarkup()}`;
    this.bindNavigation();
    this.el<HTMLElement>("[data-error]").textContent = this.error;
    const phrase = this.el<HTMLInputElement>("[data-mapping-phrase]");
    const category = this.el<HTMLSelectElement>("[data-mapping-category]");
    const replacement = this.el<HTMLInputElement>("[data-mapping-replacement]");
    const scope = this.el<HTMLSelectElement>("[data-mapping-editor-scope]");
    if (this.editingMapping) {
      phrase.value = this.editingMapping.phrase;
      category.value = this.editingMapping.category;
      replacement.value = this.editingMapping.replacement;
      scope.value = this.editingPatientMapping ? "patient" : "global";
      scope.disabled = true;
      this.el<HTMLButtonElement>("[data-cancel-mapping]").hidden = false;
    }
    this.root
      .querySelector<HTMLFormElement>("[data-mapping-form]")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        void this.saveMapping(
          phrase.value,
          category.value,
          replacement.value,
          scope.value === "patient",
        );
      });
    this.el<HTMLButtonElement>("[data-cancel-mapping]").onclick = () => {
      this.editingMapping = null;
      this.editingPatientMapping = false;
      this.renderMappings();
    };
    const list = this.el<HTMLElement>("[data-mapping-list]");
    if (!this.mappings.length && !this.patientMappings.length)
      list.innerHTML = `<p class="empty-state">No saved defaults yet.</p>`;
    const renderList = (
      mappings: MappingView[],
      heading: string,
      patientScope: boolean,
    ) => {
      if (!mappings.length) return;
      const title = document.createElement("h2");
      title.textContent = heading;
      list.append(title);
      for (const mapping of mappings) {
        const row = document.createElement("article");
        row.className = "library-row";
        const summary = document.createElement("p");
        summary.textContent = `${mapping.phrase} → ${mapping.replacement} · ${mapping.category.toLowerCase().replaceAll("_", " ")}`;
        const actions = document.createElement("div");
        actions.className = "decision-buttons";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.onclick = () => {
          this.editingMapping = mapping;
          this.editingPatientMapping = patientScope;
          this.renderMappings();
        };
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.onclick = () =>
          void this.removeMapping(mapping.id, patientScope);
        actions.append(edit, remove);
        row.append(summary, actions);
        list.append(row);
      }
    };
    renderList(this.mappings, "All patients", false);
    if (this.patient)
      renderList(
        this.patientMappings,
        `This patient · ${this.patient.name}`,
        true,
      );
    this.updateOverlay();
  }
  private renderSettings(): void {
    const installed = this.model?.installed === true;
    this.root.innerHTML = `<section class="review-page library-page" aria-labelledby="settings-title">${this.navigation()}<header class="review-heading"><div><p class="eyebrow">Local configuration</p><h1 id="settings-title">Settings</h1><p>Model files are the only files this app downloads. Source text is never included.</p></div></header><section class="settings-card"><h2>Local detection model</h2><p data-settings-model></p><div class="decision-buttons"><button type="button" data-settings-install>${installed ? "Verify / repair" : "Download model"}</button><button type="button" data-settings-replace ${installed ? "" : "hidden"}>Replace model</button><button type="button" data-settings-remove ${installed ? "" : "hidden"}>Remove model</button></div></section><p class="review-error" role="alert" data-error></p></section>${this.overlayMarkup()}`;
    this.bindNavigation();
    this.el<HTMLElement>("[data-settings-model]").textContent = !this.bridge
      .available
      ? "Open the macOS app to manage the local model."
      : installed
        ? `${this.model!.name} · ${this.model!.revision} · installed`
        : "The local model is not installed.";
    this.el<HTMLElement>("[data-error]").textContent = this.error;
    this.el<HTMLButtonElement>("[data-settings-install]").disabled =
      this.busy || !this.bridge.available;
    this.el<HTMLButtonElement>("[data-settings-install]").onclick = () =>
      void this.install();
    this.el<HTMLButtonElement>("[data-settings-replace]").onclick = () =>
      void this.replaceModel();
    this.el<HTMLButtonElement>("[data-settings-remove]").onclick = () =>
      void this.removeModel();
    this.updateOverlay();
  }
  private async loadNotes(): Promise<void> {
    const result = await this.perform("Searching notes…", () =>
      this.bridge.call<NoteSummary[]>("search_notes", {
        query: this.noteQuery,
      }),
    );
    if (result) this.notes = result;
    this.render();
  }
  private async openNote(id: number): Promise<void> {
    const result = await this.perform("Opening saved note…", () =>
      this.bridge.call<OpenedNote>("open_saved_note", { id }),
    );
    if (result) {
      this.savedTitle = result.note.title;
      this.patient = {
        id: result.note.patientId!,
        name: result.note.patientName ?? "Patient unavailable",
        patientReference: result.note.patientReference,
      };
      this.source = result.session.source;
      this.session = result.session;
      this.wizardGroup = null;
      this.screen = "review";
    }
    this.render();
  }
  private async removeNote(id: number): Promise<void> {
    if (!(await this.confirmDeletion("note"))) return;
    let deleted = false;
    await this.perform("Deleting note…", async () => {
      await this.bridge.call("delete_note", { id });
      deleted = true;
    });
    if (deleted) {
      await this.loadNotes();
      return;
    }
    this.render();
  }
  private async removePatient(patient: PatientView): Promise<void> {
    if (!(await this.confirmDeletion("patient"))) return;
    let deleted = false;
    await this.perform("Deleting patient…", async () => {
      await this.bridge.call("delete_patient", { id: patient.id });
      deleted = true;
    });
    if (deleted) {
      if (this.patient?.id === patient.id) {
        this.patient = null;
        this.patientMappings = [];
      }
      await this.loadPatients();
      return;
    }
    this.render();
  }
  private confirmDeletion(subject: "note" | "patient"): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "save-note-dialog deletion-dialog";
      dialog.setAttribute("aria-labelledby", "delete-confirmation-title");
      const consequence =
        subject === "patient"
          ? "Their reviewed notes and patient-specific mappings will also be deleted from the encrypted library."
          : "The original text, reviewed text, and review record will be deleted from the encrypted library.";
      dialog.innerHTML = `<form method="dialog" class="save-note-form"><header><p class="eyebrow">Encrypted library</p><h2 id="delete-confirmation-title">Delete ${subject}?</h2></header><p>Are you really sure you want to delete this?</p><p class="field-hint">${consequence}</p><footer class="dialog-actions"><button type="button" data-cancel-delete>Cancel</button><button type="button" class="primary" data-confirm-delete>Delete ${subject}</button></footer></form>`;
      this.root.append(dialog);
      const finish = (confirmed: boolean) => {
        dialog.close();
        dialog.remove();
        resolve(confirmed);
      };
      dialog.querySelector<HTMLButtonElement>("[data-cancel-delete]")!.onclick =
        () => finish(false);
      dialog.querySelector<HTMLButtonElement>(
        "[data-confirm-delete]",
      )!.onclick = () => finish(true);
      dialog.addEventListener("cancel", () => finish(false), { once: true });
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-cancel-delete]")!.focus();
    });
  }
  private async loadMappings(): Promise<void> {
    const result = await this.perform("Loading mappings…", async () => {
      const mappings = await this.bridge.call<MappingView[]>("list_mappings");
      const patientMappings = this.patient
        ? await this.bridge.call<MappingView[]>("list_patient_mappings", {
            patientId: this.patient.id,
          })
        : [];
      return { mappings, patientMappings };
    });
    if (result) {
      this.mappings = result.mappings;
      this.patientMappings = result.patientMappings;
    }
    this.render();
  }
  private async saveMapping(
    phrase: string,
    category: string,
    replacement: string,
    patientScope: boolean,
  ): Promise<void> {
    const scopedToPatient = this.editingMapping
      ? this.editingPatientMapping
      : patientScope;
    if (scopedToPatient && !this.patient) {
      this.error =
        "Choose a patient before creating a patient-specific mapping.";
      this.render();
      return;
    }
    const command = this.editingMapping
      ? scopedToPatient
        ? "update_patient_mapping"
        : "update_mapping"
      : scopedToPatient
        ? "create_patient_mapping"
        : "create_mapping";
    const args = {
      ...(scopedToPatient ? { patientId: this.patient!.id } : {}),
      ...(this.editingMapping ? { id: this.editingMapping.id } : {}),
      phrase,
      category,
      replacement,
    };
    const result = await this.perform("Saving mapping…", () =>
      this.bridge.call<MappingView>(command, args),
    );
    if (result) {
      this.editingMapping = null;
      this.editingPatientMapping = false;
      await this.loadMappings();
      return;
    }
    this.render();
  }
  private async removeMapping(
    id: number,
    patientScope: boolean,
  ): Promise<void> {
    if (!window.confirm("Delete this reusable mapping?")) return;
    let deleted = false;
    await this.perform("Deleting mapping…", async () => {
      await this.bridge.call(
        patientScope ? "delete_patient_mapping" : "delete_mapping",
        patientScope ? { id, patientId: this.patient!.id } : { id },
      );
      deleted = true;
    });
    if (deleted) {
      await this.loadMappings();
      return;
    }
    this.render();
  }
  private renderInput(ready: boolean): void {
    this.el("[data-workspace]").innerHTML =
      `<section class="input-panel"><div class="pane-heading"><label for="source-input">Source text</label><button type="button" data-example>Use synthetic example</button></div>
      <textarea id="source-input" rows="12" placeholder="Type or paste the text you want to review…" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" aria-describedby="source-count"></textarea>
      <div class="pane-footer"><span id="source-count"></span><label class="review-saved-option"><input type="checkbox" data-review-saved-mappings /> Review saved mappings</label><button type="button" class="primary" data-detect>Find identifiers</button></div></section>`;
    const input = this.el<HTMLTextAreaElement>("#source-input");
    input.value = this.source;
    input.disabled = this.busy;
    this.el<HTMLButtonElement>("[data-example]").disabled = this.busy;
    const reviewSavedMappings = this.el<HTMLInputElement>(
      "[data-review-saved-mappings]",
    );
    reviewSavedMappings.checked = this.reviewSavedMappings;
    reviewSavedMappings.disabled = this.busy;
    reviewSavedMappings.addEventListener("change", () => {
      this.reviewSavedMappings = reviewSavedMappings.checked;
    });
    const count = () => {
      const length = Array.from(this.source).length;
      this.el<HTMLElement>("#source-count").textContent =
        `${length.toLocaleString()} / 20,000 characters`;
      this.el<HTMLButtonElement>("[data-detect]").disabled =
        !ready || this.busy || !this.source.trim() || length > 20_000;
      input.setAttribute("aria-invalid", String(length > 20_000));
    };
    input.addEventListener("input", () => {
      this.source = input.value;
      count();
    });
    this.bind("[data-example]", () => {
      this.source = EXAMPLE;
      input.value = EXAMPLE;
      count();
      input.focus();
    });
    this.bind("[data-detect]", () => {
      void this.detect();
    });
    count();
  }
  private renderReview(session: ReviewSession): void {
    this.el("[data-workspace]").innerHTML = `
      <section class="review-wizard" aria-labelledby="wizard-title"><header class="wizard-heading"><div><p class="eyebrow">Focused review</p><h2 id="wizard-title">Review one item at a time</h2></div><div class="wizard-navigation"><button type="button" data-wizard-previous>Previous</button><p class="wizard-count" data-wizard-count></p><button type="button" data-wizard-next>Next</button></div></header><div class="wizard-progress"><progress data-review-progress></progress><p data-wizard-progress></p></div><div data-wizard-card></div></section>
      <section class="review-actions-bar" aria-label="Reviewed note actions"><p data-summary></p><div class="completion-actions"><button type="button" data-rescan-top>Check reviewed text</button><button type="button" data-save-note-top>Save reviewed note</button><button type="button" class="primary" data-copy-top>Copy reviewed text</button></div></section>
      <div class="review-panes"><section class="text-pane"><div class="pane-heading"><h2>Source text</h2><span>Original wording</span></div><div class="note-text" data-source tabindex="0" aria-label="Source text; select a missed identifiable detail to add to review"></div><div class="selection-menu" data-selection-menu hidden role="menu" aria-label="Selected text actions"><button type="button" data-manual role="menuitem">Add to review</button><button type="button" data-cancel-selection role="menuitem">Cancel</button></div></section>
      <section class="text-pane"><div class="pane-heading"><h2>Proposed result</h2><span data-result-status></span></div><div class="note-text" data-output aria-label="Proposed result"></div></section></div>
      <section class="review-history" data-review-history><details data-resolved-items><summary data-resolved-summary></summary><div data-resolved-detections></div></details></section>
      <footer class="review-completion"><div><p data-summary></p><small>Copying puts reviewed text on the system clipboard. Clipboard managers may retain it.</small></div><div class="completion-actions"><button type="button" data-rescan>Check reviewed text</button><button type="button" data-save-note>Save reviewed note</button><button type="button" class="primary" data-copy>Copy reviewed text</button></div></footer>`;
    this.el<HTMLElement>("[data-result-status]").textContent = session.checked
      ? "Review checked"
      : "Awaiting review";
    const summary = session.checked
      ? `Final local check complete. ${session.retained} deliberately retained occurrence(s).`
      : session.items.length
        ? "The final local check runs automatically when every action is resolved."
        : "No identifiers detected. Read the whole text and mark any missed details before the final check.";
    this.root.querySelectorAll<HTMLElement>("[data-summary]").forEach((el) => {
      el.textContent = summary;
    });
    this.paintText(
      this.el("[data-source]"),
      session.source,
      session.items,
      false,
    );
    this.paintText(
      this.el("[data-output]"),
      session.output,
      session.items,
      true,
    );
    const groups = new Map<number, Detection[]>();
    for (const item of session.items)
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    const active = this.el("[data-wizard-card]");
    const resolved = this.el("[data-resolved-detections]");
    const activeGroups: Detection[][] = [];
    const resolvedGroups: Detection[][] = [];
    for (const items of groups.values()) {
      if (
        items.some((item) => item.decision === "pending") ||
        this.drafts.has(items[0].group)
      )
        activeGroups.push(items);
      else resolvedGroups.push(items);
    }
    const wizardGroups = this.groupsForWizard(session);
    this.wizardGroupIds = wizardGroups.map((items) => items[0].group);
    const pendingWizardGroups = wizardGroups.filter((items) =>
      this.groupNeedsAction(items),
    );
    const totalGroups = wizardGroups.length;
    const completedGroups = totalGroups - pendingWizardGroups.length;
    const progress = this.el<HTMLProgressElement>("[data-review-progress]");
    progress.max = Math.max(totalGroups, 1);
    progress.value = completedGroups;
    progress.setAttribute(
      "aria-valuetext",
      `${completedGroups} of ${totalGroups} review items resolved`,
    );
    let current = wizardGroups.find(
      (items) => items[0].group === this.wizardGroup,
    );
    if (!current && wizardGroups.length) {
      current = pendingWizardGroups[0] ?? wizardGroups[0];
      this.wizardGroup = current[0].group;
    }
    const currentIndex = current ? wizardGroups.indexOf(current) : -1;
    this.el<HTMLElement>("[data-wizard-count]").textContent = current
      ? `Item ${currentIndex + 1} of ${totalGroups}`
      : totalGroups
        ? `${totalGroups} of ${totalGroups} complete`
        : "No items to review";
    this.el<HTMLElement>("[data-wizard-progress]").textContent =
      pendingWizardGroups.length
        ? `${pendingWizardGroups.length} action${pendingWizardGroups.length === 1 ? "" : "s"} left`
        : totalGroups
          ? "All actions resolved"
          : "Mark any missed identifiers in the source text.";
    if (current) {
      active.append(this.card(session, current));
      this.focusReviewGroup(current, true);
    } else
      active.innerHTML = `<p class="empty-state">All actions are resolved. Reopen an item below if you need to change it.</p>`;
    const disclosure = this.el<HTMLDetailsElement>("[data-resolved-items]");
    disclosure.open = this.resolvedOpen;
    this.el<HTMLElement>("[data-resolved-summary]").textContent =
      `${resolvedGroups.length} resolved item${resolvedGroups.length === 1 ? "" : "s"}`;
    disclosure.hidden = resolvedGroups.length === 0;
    this.el<HTMLElement>("[data-review-history]").hidden =
      resolvedGroups.length === 0;
    disclosure.addEventListener("toggle", () => {
      this.resolvedOpen = disclosure.open;
    });
    for (const items of resolvedGroups)
      resolved.append(this.card(session, items));
    this.el<HTMLButtonElement>("[data-wizard-previous]").disabled =
      this.busy || currentIndex <= 0;
    this.el<HTMLButtonElement>("[data-wizard-next]").disabled =
      this.busy || currentIndex < 0 || currentIndex >= wizardGroups.length - 1;
    this.bind("[data-wizard-previous]", () => this.moveWizard(-1));
    this.bind("[data-wizard-next]", () => this.moveWizard(1));
    const saveSelection = () => {
      const selection = window.getSelection();
      const source = this.el("[data-source]");
      this.selection = null;
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        if (
          source.contains(range.startContainer) &&
          source.contains(range.endContainer)
        ) {
          const before = range.cloneRange();
          before.selectNodeContents(source);
          before.setEnd(range.startContainer, range.startOffset);
          const start = before.toString().length;
          this.selection = { start, end: start + range.toString().length };
        }
      }
      const menu = this.el<HTMLElement>("[data-selection-menu]");
      menu.hidden = this.busy || !this.selection;
      if (!menu.hidden && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (typeof range.getBoundingClientRect === "function") {
          const rect = range.getBoundingClientRect();
          const left = Math.min(
            window.innerWidth - 96,
            Math.max(96, rect.left + rect.width / 2),
          );
          const top =
            rect.bottom + 44 < window.innerHeight
              ? rect.bottom + 8
              : Math.max(8, rect.top - 44);
          menu.style.left = `${left}px`;
          menu.style.top = `${top}px`;
        }
      }
    };
    this.el("[data-source]").addEventListener("mouseup", saveSelection);
    this.el("[data-source]").addEventListener("keyup", saveSelection);
    this.bind("[data-manual]", () => {
      if (this.selection)
        void this.change("add_manual_detection", this.selection);
    });
    this.bind("[data-cancel-selection]", () => {
      this.selection = null;
      window.getSelection()?.removeAllRanges();
      this.el<HTMLElement>("[data-selection-menu]").hidden = true;
    });
    this.updateCompletion();
    this.bind("[data-rescan]", () => {
      void this.rescan();
    });
    this.bind("[data-rescan-top]", () => {
      void this.rescan();
    });
    this.bind("[data-copy]", () => {
      void this.copy();
    });
    this.bind("[data-copy-top]", () => {
      void this.copy();
    });
    this.bind("[data-save-note]", () => {
      void this.saveNoteDialog();
    });
    this.bind("[data-save-note-top]", () => {
      void this.saveNoteDialog();
    });
  }
  private groupNeedsAction(items: Detection[]): boolean {
    return (
      items.some((item) => item.decision === "pending") ||
      this.drafts.has(items[0].group)
    );
  }
  private groupsForWizard(session: ReviewSession): Detection[][] {
    const groups = new Map<number, Detection[]>();
    for (const item of session.items)
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    return [...groups.values()].sort(
      (left, right) =>
        Number(left.some((item) => item.stages.includes("manual"))) -
          Number(right.some((item) => item.stages.includes("manual"))) ||
        left[0].start - right[0].start,
    );
  }
  private moveWizard(direction: -1 | 1): void {
    const current = this.wizardGroupIds.indexOf(this.wizardGroup ?? -1);
    const next = this.wizardGroupIds[current + direction];
    if (next === undefined) return;
    this.wizardGroup = next;
    this.render();
    this.focusWizardLabel();
  }
  private advanceWizard(session: ReviewSession, group: number): void {
    const groups = this.groupsForWizard(session);
    const current = groups.findIndex((items) => items[0].group === group);
    const next = [
      ...groups.slice(current + 1),
      ...groups.slice(0, Math.max(current, 0)),
    ].find((items) => this.groupNeedsAction(items));
    this.wizardGroup = next?.[0].group ?? groups[current]?.[0].group ?? null;
  }
  private updateCompletion(): void {
    if (!this.session) return;
    const dirty = this.drafts.size > 0;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-rescan], [data-rescan-top]",
    ))
      button.disabled =
        this.busy || dirty || this.session.pending > 0 || this.session.checked;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-copy], [data-copy-top], [data-save-note], [data-save-note-top]",
    ))
      button.disabled = this.busy || dirty || !this.session.checked;
  }
  private paintText(
    container: Element,
    text: string,
    items: Detection[],
    output: boolean,
  ): void {
    let cursor = 0;
    for (const item of items) {
      const start = output ? item.outputStart : item.start;
      const end = output ? item.outputEnd : item.end;
      container.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(start, end);
      mark.dataset.item = String(item.id);
      mark.dataset.decision = item.decision;
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute(
        "aria-label",
        `${mark.textContent}: ${item.category.toLowerCase().replaceAll("_", " ")}, ${DECISION_LABEL[item.decision]}`,
      );
      mark.addEventListener("click", () => this.openWizardForItem(item.id));
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.openWizardForItem(item.id);
        }
      });
      container.append(mark);
      cursor = end;
    }
    container.append(document.createTextNode(text.slice(cursor)));
  }
  private select(id: number, scroll: boolean): void {
    const item = this.session?.items.find((item) => item.id === id);
    if (!item || !this.session) return;
    this.focusReviewGroup(
      this.session.items.filter((candidate) => candidate.group === item.group),
      false,
    );
    this.root.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
      el.classList.toggle("selected", el.dataset.item === String(id));
    });
    if (scroll) this.scrollReviewOccurrence(id);
  }
  private openWizardForItem(id: number): void {
    const item = this.session?.items.find((candidate) => candidate.id === id);
    if (!item) return;
    this.wizardGroup = item.group;
    this.render();
    this.select(id, true);
    this.focusWizardLabel();
  }
  private focusReviewGroup(items: Detection[], scroll: boolean): void {
    const ids = new Set(items.map((item) => String(item.id)));
    this.root.querySelectorAll<HTMLElement>("[data-item]").forEach((el) => {
      el.dataset.activeReview = String(ids.has(el.dataset.item ?? ""));
    });
    if (scroll && items[0]) this.scrollReviewOccurrence(items[0].id);
  }
  private scrollReviewOccurrence(id: number): void {
    for (const pane of ["[data-source]", "[data-output]"]) {
      const mark = this.root.querySelector<HTMLElement>(
        `${pane} [data-item="${id}"]`,
      );
      const preview = mark?.closest<HTMLElement>(".note-text");
      if (!mark || !preview || preview.clientHeight === 0) continue;
      const markBounds = mark.getBoundingClientRect();
      const previewBounds = preview.getBoundingClientRect();
      const offset = markBounds.top - previewBounds.top;
      preview.scrollTop = Math.max(
        0,
        preview.scrollTop +
          offset -
          (preview.clientHeight - markBounds.height) / 2,
      );
    }
  }
  private focusWizardLabel(): void {
    this.root
      .querySelector<HTMLInputElement>("[data-wizard-card] [data-label]")
      ?.focus({ preventScroll: true });
  }
  private card(session: ReviewSession, items: Detection[]): HTMLElement {
    const item = items[0];
    const card = document.createElement("article");
    card.className = "detection-card";
    card.dataset.card = String(item.group);
    const scopes = this.patient
      ? `<option value="patient" selected>This patient</option><option value="global">All patients</option>`
      : `<option value="global">All patients</option>`;
    card.innerHTML = `<div class="detection-copy"><div class="detection-heading"><strong data-category></strong><span class="decision-state" data-decision></span></div><p class="phrase" data-phrase></p><p class="detection-reason" data-reason></p><div data-occurrences></div></div><div class="detection-controls"><label>Placeholder <input data-label spellcheck="false" autocomplete="off" autocapitalize="characters" aria-describedby="label-hint-${item.group} label-error-${item.group}" /></label><p class="label-hint" id="label-hint-${item.group}" data-label-hint></p><p class="label-error" id="label-error-${item.group}" data-label-error role="alert"></p><label class="save-default"><input type="checkbox" data-save-default checked /> <span data-save-default-label></span></label><label class="save-default">Save for <select data-mapping-scope>${scopes}</select></label><div class="decision-buttons"><button type="button" data-action="accept">Accept</button><button type="button" data-action="edit">Apply label</button><button type="button" data-action="keep">Keep</button><button type="button" data-action="remove">Remove</button></div></div>`;
    card.querySelector<HTMLElement>("[data-category]")!.textContent =
      item.category.toLowerCase().replaceAll("_", " ");
    card.querySelector<HTMLElement>("[data-decision]")!.textContent =
      `${DECISION_LABEL[item.decision]} · ${items.length} occurrence(s)`;
    card.querySelector<HTMLElement>("[data-phrase]")!.textContent =
      session.source.slice(item.start, item.end);
    card.querySelector<HTMLElement>("[data-reason]")!.textContent =
      `${item.reason} Found by: ${[...new Set(items.flatMap((i) => i.stages))].map((stage) => STAGE_LABEL[stage] ?? stage).join(", ")}.`;
    const label = card.querySelector<HTMLInputElement>("[data-label]")!;
    const saveDefault = card.querySelector<HTMLInputElement>(
      "[data-save-default]",
    )!;
    const mappingScope = card.querySelector<HTMLSelectElement>(
      "[data-mapping-scope]",
    )!;
    card.querySelector<HTMLElement>("[data-save-default-label]")!.textContent =
      item.stages.includes("library")
        ? "Update this saved default"
        : "Save this replacement as a reusable default";
    label.value = this.drafts.get(item.group) ?? item.replacement;
    label.disabled = this.busy;
    const updateLabel = () => {
      if (label.value === item.replacement) this.drafts.delete(item.group);
      else this.drafts.set(item.group, label.value);
      const error = placeholderError(
        normalisePlaceholder(label.value, item.replacement),
      );
      label.setAttribute("aria-invalid", String(Boolean(error)));
      card.querySelector("[data-label-error]")!.textContent = error;
      card.querySelector("[data-label-hint]")!.textContent = this.drafts.has(
        item.group,
      )
        ? "Apply label to use this change."
        : "Auto-formatted: [UPPER_CASE_LABEL].";
      card.dataset.state =
        item.decision === "pending" || this.drafts.has(item.group)
          ? "pending"
          : "resolved";
      card.querySelector("[data-decision]")!.textContent =
        `${this.drafts.has(item.group) ? "Unapplied label" : item.decision === "pending" ? "To review" : `✓ ${DECISION_LABEL[item.decision]}`} · ${items.length} occurrence(s)`;
    };
    const updateDraft = () => {
      if (!this.busy) this.message = "";
      updateLabel();
      this.updateCompletion();
      this.updateStatus();
    };
    const formatLabel = () => {
      label.value = normalisePlaceholder(label.value, item.replacement);
      updateDraft();
    };
    label.addEventListener("input", (event) => {
      if (event instanceof InputEvent && event.isComposing) return;
      const start = label.value
        .slice(0, label.selectionStart ?? 0)
        .toUpperCase().length;
      const end = label.value
        .slice(0, label.selectionEnd ?? 0)
        .toUpperCase().length;
      const direction = label.selectionDirection ?? undefined;
      label.value = label.value.toUpperCase();
      label.setSelectionRange(start, end, direction);
      updateDraft();
    });
    label.addEventListener("blur", formatLabel);
    label.addEventListener("compositionend", formatLabel);
    label.addEventListener("focus", () => {
      label.select();
    });
    updateLabel();
    for (const button of card.querySelectorAll<HTMLButtonElement>(
      "[data-action]",
    )) {
      button.disabled = this.busy;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.action === item.decision),
      );
      button.addEventListener("click", () => {
        if (
          button.dataset.action === "accept" ||
          button.dataset.action === "edit"
        ) {
          formatLabel();
          if (placeholderError(label.value)) {
            label.focus();
            return;
          }
        }
        void this.change(
          "review_decision",
          {
            item: item.id,
            decision:
              button.dataset.action === "accept" && this.drafts.has(item.group)
                ? "edit"
                : button.dataset.action,
            replacement: label.value,
          },
          item.group,
          (button.dataset.action === "accept" ||
            button.dataset.action === "edit") &&
            saveDefault.checked,
          mappingScope.value === "patient",
        );
      });
    }
    for (const [index, occurrence] of items.entries()) {
      const find = document.createElement("button");
      find.type = "button";
      find.textContent = `Show ${index + 1}`;
      find.addEventListener("click", () => {
        this.select(occurrence.id, true);
      });
      card.querySelector("[data-occurrences]")!.append(find);
      if (items.length > 1) {
        const split = document.createElement("button");
        split.type = "button";
        split.disabled = this.busy;
        split.textContent = `Separate ${index + 1}`;
        split.addEventListener("click", () => {
          void this.change("split_detection", { item: occurrence.id });
        });
        card.querySelector("[data-occurrences]")!.append(split);
      }
    }
    return card;
  }
  private async perform<T>(
    label: string,
    action: () => Promise<T>,
    work: Work = "review",
  ): Promise<T | undefined> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.error = "";
    this.message = label;
    this.work = work;
    this.workProgress = null;
    this.cancelling = false;
    this.operation += 1;
    this.render();
    try {
      const result = await action();
      return this.disposed ? undefined : result;
    } catch (error) {
      if (!this.disposed)
        this.error =
          typeof error === "string"
            ? error
            : "The operation could not finish. Please retry.";
      return undefined;
    } finally {
      this.busy = false;
      this.message = "";
      this.work = null;
      this.workProgress = null;
      this.cancelling = false;
    }
  }
  private args(): Record<string, unknown> {
    return { sessionId: this.session!.id, revision: this.session!.revision };
  }
  private async install(): Promise<void> {
    await this.perform(
      "Preparing download…",
      async () => {
        await this.bridge.call("install_model", { operation: this.operation });
        this.model = await this.bridge.call<ModelStatus>("model_status");
      },
      "download",
    );
    this.render();
  }
  private async detect(): Promise<void> {
    this.wizardGroup = null;
    const result = await this.perform(
      "Finding identifiers…",
      () =>
        this.bridge.call<ReviewSession>("detect_text", {
          operation: this.operation,
          source: this.source,
          patientId: this.patient?.id,
          reviewSavedMappings: this.reviewSavedMappings,
        }),
      "analysis",
    );
    if (result) this.session = result;
    this.render();
    if (result) this.focusWizardLabel();
  }
  private async change(
    command: string,
    args: Record<string, unknown>,
    appliedGroup?: number,
    saveDefault = false,
    patientScope = false,
  ): Promise<void> {
    const result = await this.perform("Updating review…", () =>
      this.bridge.call<ReviewSession>(command, { ...this.args(), ...args }),
    );
    let shouldAutoCheck = false;
    if (result) {
      this.session = result;
      if (appliedGroup !== undefined) this.drafts.delete(appliedGroup);
      const groups = new Set(result.items.map((item) => item.group));
      for (const group of this.drafts.keys())
        if (!groups.has(group)) this.drafts.delete(group);
      if (command === "review_decision" && appliedGroup !== undefined)
        this.advanceWizard(result, appliedGroup);
      if (command === "add_manual_detection")
        this.wizardGroup =
          [...result.items]
            .reverse()
            .find(
              (item) =>
                item.decision === "pending" && item.stages.includes("manual"),
            )?.group ?? null;
      if (saveDefault && command === "review_decision") {
        const saved = await this.perform("Saving reusable default…", () =>
          this.bridge.call("save_mapping_from_review", {
            sessionId: result.id,
            revision: result.revision,
            item: args.item,
            patientScope,
          }),
        );
        if (saved !== undefined) this.message = "Reusable default saved.";
      }
      shouldAutoCheck =
        command === "review_decision" &&
        result.pending === 0 &&
        this.drafts.size === 0 &&
        !result.checked;
    }
    this.selection = null;
    if (shouldAutoCheck) {
      await this.rescan(true);
      return;
    }
    this.render();
    this.focusWizardLabel();
  }
  private async rescan(automatic = false): Promise<void> {
    const result = await this.perform(
      automatic
        ? "Checking reviewed text automatically…"
        : "Checking reviewed text…",
      () =>
        this.bridge.call<ReviewSession>("rescan_text", {
          ...this.args(),
          operation: this.operation,
        }),
      "rescan",
    );
    if (result) {
      this.session = result;
      if (result.pending > 0) this.wizardGroup = null;
    }
    this.render();
    if (result?.pending) this.focusWizardLabel();
  }
  private async copy(): Promise<void> {
    let copied = false;
    await this.perform(
      "Copying…",
      async () => {
        await this.bridge.call("copy_reviewed_text", this.args());
        copied = true;
      },
      "copy",
    );
    if (copied) this.message = "Reviewed text copied.";
    this.render();
  }
  private saveNoteDialog(): void {
    if (!this.session?.checked || this.busy) return;
    const dialog = document.createElement("dialog");
    dialog.className = "save-note-dialog";
    dialog.setAttribute("aria-labelledby", "save-note-title");
    dialog.innerHTML = `<form method="dialog" class="save-note-form"><header><p class="eyebrow">Encrypted note library</p><h2 id="save-note-title">${this.savedTitle ? "Update reviewed note" : "Save reviewed note"}</h2></header><p>The original text, reviewed text, selected patient, and every review decision are saved together in the encrypted library.</p><label>Note title <input data-note-title required maxlength="160" aria-describedby="note-title-hint" /></label><p class="field-hint" id="note-title-hint">A local suggestion is ready to edit before saving.</p><p class="review-error" data-save-error role="alert"></p><footer class="dialog-actions"><button type="button" data-cancel-save>Cancel</button><button class="primary" data-confirm-save>${this.savedTitle ? "Update note" : "Save reviewed note"}</button></footer></form>`;
    this.root.append(dialog);
    dialog.querySelector<HTMLInputElement>("[data-note-title]")!.value =
      this.savedTitle ?? this.suggestNoteTitle(this.session.output);
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.querySelector<HTMLButtonElement>("[data-cancel-save]")!.onclick =
      close;
    dialog
      .querySelector<HTMLFormElement>("form")!
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const title =
          dialog.querySelector<HTMLInputElement>("[data-note-title]")!.value;
        void this.saveNote(title, dialog, close);
      });
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("[data-note-title]")!.focus();
  }
  private async saveNote(
    title: string,
    dialog: HTMLDialogElement,
    close: () => void,
  ): Promise<void> {
    const result = await this.perform("Saving reviewed note…", () =>
      this.bridge.call<NoteView>("save_reviewed_note", {
        ...this.args(),
        title,
      }),
    );
    if (result) {
      close();
      await this.returnToPatients();
    } else {
      const error = dialog.querySelector<HTMLElement>("[data-save-error]");
      if (error) error.textContent = this.error;
    }
    this.render();
  }
  private suggestNoteTitle(reviewedText: string): string {
    const cleaned = reviewedText
      .replace(/\[[A-Z][A-Z0-9_]{0,45}\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const clinicalPhrase = cleaned.match(
      /\b(?:reports?|presented with|presents with|follow-?up for|review of|declined)\s+([^.!?;]{3,96})/i,
    )?.[1];
    if (!clinicalPhrase) return "Clinical review";
    const words = clinicalPhrase
      .replace(/\b(?:the|a|an)\b/gi, "")
      .trim()
      .split(/\s+/)
      .slice(0, 7)
      .join(" ");
    return words
      ? words.charAt(0).toUpperCase() + words.slice(1)
      : "Clinical review";
  }
  private async returnToPatients(): Promise<void> {
    this.session = null;
    this.source = "";
    this.wizardGroup = null;
    this.wizardGroupIds = [];
    this.savedTitle = null;
    this.selection = null;
    this.drafts.clear();
    if (this.bridge.available) {
      try {
        await this.bridge.call("discard_session");
      } catch {
        // The reviewed note has already been committed; the view can still return home.
      }
    }
    this.screen = "patients";
    await this.loadPatients();
  }
  private async replaceModel(): Promise<void> {
    await this.perform(
      "Replacing local model…",
      async () => {
        await this.bridge.call("replace_model", { operation: this.operation });
        this.model = await this.bridge.call<ModelStatus>("model_status");
      },
      "download",
    );
    this.render();
  }
  private async removeModel(): Promise<void> {
    if (
      !window.confirm(
        "Remove the local detection model? You can download the pinned model again later.",
      )
    )
      return;
    let removed = false;
    await this.perform(
      "Removing local model…",
      async () => {
        await this.bridge.call("remove_model");
        removed = true;
      },
      "review",
    );
    if (removed)
      this.model = await this.bridge.call<ModelStatus>("model_status");
    this.render();
  }
  private async cancel(): Promise<void> {
    this.cancelling = true;
    this.message = "Cancelling…";
    this.updateStatus();
    try {
      await this.bridge.call("cancel_operation", { operation: this.operation });
    } catch {
      this.cancelling = false;
      this.error =
        "Cancellation could not be requested. Wait for processing to finish.";
      this.updateStatus();
    }
  }
  private async leave(home: boolean): Promise<void> {
    if (this.busy || this.disposed || this.dismissDiscard) return;
    if ((this.source || this.session) && !(await this.confirmDiscard())) return;
    this.busy = true;
    this.render();
    if (this.bridge.available) {
      try {
        await this.bridge.call("discard_session");
      } catch {
        this.error = "The session could not be cleared. Please retry.";
        this.busy = false;
        this.render();
        return;
      }
    }
    this.source = "";
    this.session = null;
    this.wizardGroup = null;
    this.wizardGroupIds = [];
    this.selection = null;
    this.error = "";
    this.message = "";
    this.drafts.clear();
    this.busy = false;
    if (home) {
      this.dispose();
      this.onHome();
    } else this.render();
  }
  private confirmDiscard(): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Discard this session?");
      dialog.innerHTML = `<h2>Discard this session?</h2><p>The source text and review decisions will be cleared.</p><div class="decision-buttons"><button type="button" data-stay>Keep reviewing</button><button type="button" data-confirm>Discard session</button></div>`;
      this.root.append(dialog);
      const finish = (value: boolean) => {
        dialog.close();
        dialog.remove();
        this.dismissDiscard = undefined;
        resolve(value);
        if (!value) this.render();
      };
      this.dismissDiscard = () => finish(false);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog
        .querySelector("[data-stay]")!
        .addEventListener("click", () => finish(false));
      dialog
        .querySelector("[data-confirm]")!
        .addEventListener("click", () => finish(true));
      dialog.showModal();
    });
  }
}
