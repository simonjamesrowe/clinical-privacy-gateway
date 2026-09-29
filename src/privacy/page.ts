import {
  documentBodyToMarkdown,
  markdownEditor,
  markdownToDocumentBody,
  renderMarkdown,
} from "./markdown-editor";
import { signaturePad, emptySignatureDraft } from "./signature-pad";
import { documentLabel, MAX_SOURCE_CHARACTERS } from "./documents";
import type {
  ImportedDocument,
  DocumentPreview,
  DocumentMetadata,
} from "./types";
import type {
  Detection,
  DocumentSettings,
  UsageSummary,
  PreparedDocumentSubmission,
  GeneratedDocument,
  DocumentSummary,
  DocumentTemplate,
  MappingView,
  ModelStatus,
  NoteSummary,
  NoteView,
  OpenedNote,
  PatientDocument,
  PatientView,
  PrivacyBridge,
  ReviewSession,
} from "./types";
import {
  modelSelect,
  modelPrices,
  monthRange,
  usageTable,
  usd,
} from "./document-usage";
import "../styles/components.css";
import "../styles/review.css";
import {
  documentButton,
  documentContent,
  breadcrumb,
  confirmation,
  confirmRow,
  dataTable,
  emptyState,
  pageHeader,
  plural,
  rowOpener,
  searchForm,
  searchStatus,
  toolbar,
} from "./components";
import { brandMark, categoryLabel, formatDate, h } from "./dom";
import { normalisePlaceholder, placeholderError } from "./placeholder";
import type { Progress } from "./types";

type Work =
  | "import"
  | "preview"
  | "generation"
  | "download"
  | "analysis"
  | "rescan"
  | "review"
  | "copy";
type Tab = "details" | "notes" | "documents" | "redactions";
export type WorkspaceScreen =
  | "patients"
  | "patient-new"
  | "notes"
  | "note-patient"
  | "documents"
  | "document-patient"
  | "redactions"
  | "templates"
  | "settings";
type Section = Exclude<
  WorkspaceScreen,
  "patient-new" | "note-patient" | "document-patient"
>;
type Route =
  | { name: "patients" }
  | { name: "patient-new" }
  | { name: "patient"; patientId: number; tab: Tab }
  | { name: "document-new"; patientId: number }
  | { name: "document-edit"; documentId: number }
  | { name: "document-patient" }
  | { name: "note-patient" }
  | { name: "documents" }
  | { name: "review" }
  | { name: "notes" }
  | { name: "redactions" }
  | { name: "templates" }
  | { name: "settings" };
/** Where the clinician goes once an unsaved review is discarded. */
type Leave =
  | Route
  | "home"
  | "discard"
  | "regenerate"
  | "paste"
  | "import"
  | "replace-document";
interface RedactionEdit {
  scope: "patient" | "global";
  id: number;
  value: string;
  error: string;
}
interface TemplateEdit {
  id?: number;
  name: string;
  description: string;
  instructions: string;
}
interface DocumentEdit {
  document: PatientDocument;
  title: string;
  markdown: string;
  reviewed: boolean;
  includeSignature: boolean;
}

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
  library: "saved redaction",
};
const TABS: Tab[] = ["details", "notes", "documents", "redactions"];
const TAB_LABEL: Record<Tab, string> = {
  details: "Details",
  notes: "Notes",
  documents: "Documents",
  redactions: "Redactions",
};
const CANCELLABLE: (Work | null)[] = [
  "download",
  "analysis",
  "rescan",
  "import",
  "preview",
  "generation",
];

export class TextReviewPage {
  private source = "";
  private inputMode: "paste" | "import" = "paste";
  private imported: ImportedDocument | null = null;
  private originalDocument: DocumentMetadata | null = null;
  private originalNoteId: number | null = null;
  private warningsAcknowledged = false;
  private preview: DocumentPreview | null = null;
  private previewPage = 0;
  private previewWidth = 800;
  private previewImage = "";
  private previewReturnFocus = "";
  private previewReturnScroll = 0;
  private session: ReviewSession | null = null;
  private model: ModelStatus | null = null;
  private drafts = new Map<number, string>();
  private busy = false;
  private operation = 0;
  private disposed = false;
  private unsubscribe?: () => void;
  private selection: { start: number; end: number } | null = null;
  private message = "";
  private error = "";
  private initialising = false;
  private work: Work | null = null;
  private workProgress: Progress | null = null;
  private cancelling = false;
  private resolvedOpen = false;
  private savedTitle: string | null = null;
  private reviewSavedMappings = false;
  private wizardGroup: number | null = null;
  private wizardGroupIds: number[] = [];
  private route: Route;
  private patients: PatientView[] = [];
  private patient: PatientView | null = null;
  private patientQuery = "";
  private notes: NoteSummary[] = [];
  private noteQuery = "";
  private searchedQuery = "";
  private mappings: MappingView[] = [];
  private patientMappings: MappingView[] = [];
  private documents: DocumentSummary[] = [];
  private documentQuery = "";
  private templates: DocumentTemplate[] = [];
  private documentSettings: DocumentSettings | null = null;
  private usage: UsageSummary | null = null;
  private usagePeriod: "month" | "all" = "month";
  private preparedDocument: PreparedDocumentSubmission | null = null;
  private generatedDocument: GeneratedDocument | null = null;
  private generatedIncludeSignature = false;
  private documentId: number | undefined;
  private templateEdit: TemplateEdit | null = null;
  private templateEditor: ReturnType<typeof markdownEditor> | null = null;
  private documentEditor: ReturnType<typeof markdownEditor> | null = null;
  private documentEdit: DocumentEdit | null = null;
  private signatureDraft = emptySignatureDraft();
  private settingsDraft: Record<string, string> | null = null;
  private templateQuery = "";
  private documentDraft = {
    title: "",
    templateId: 0,
    model: "",
    noteIds: new Set<number>(),
  };
  private redactionQuery = "";
  private editing: RedactionEdit | null = null;
  private confirming: string | null = null;
  private discarding: Leave | null = null;
  private patientDraft = { name: "", reference: "" };
  private noteTitle: string | null = null;
  private openedRevision: number | null = null;
  private saveError = "";
  private focusTarget: string | null = null;
  private restoreFocus: string | null = null;
  private readonly keydown = (event: KeyboardEvent) => this.onKeydown(event);
  constructor(
    private root: HTMLElement,
    private bridge: PrivacyBridge,
    private onHome: () => void,
    initialScreen: WorkspaceScreen | "review" = "review",
  ) {
    this.route = { name: initialScreen };
    root.addEventListener("keydown", this.keydown);
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
    if (this.disposed) return;
    await this.load(this.route);
    this.render();
  }

  dispose(): void {
    this.templateEditor?.destroy();
    this.templateEditor = null;
    this.documentEditor?.destroy();
    this.documentEditor = null;
    this.settingsDraft = null;
    this.signatureDraft = emptySignatureDraft();
    this.disposed = true;
    if (
      this.bridge.available &&
      (this.imported ||
        this.preview ||
        this.work === "import" ||
        this.work === "preview")
    ) {
      void this.bridge.call("discard_session").catch(() => {});
    }
    this.imported = null;
    this.originalDocument = null;
    this.preview = null;
    this.previewImage = "";
    this.root.removeEventListener("keydown", this.keydown);
    this.unsubscribe?.();
    this.source = "";
    this.session = null;
    this.selection = null;
    this.discarding = null;
    this.drafts.clear();
    this.generatedDocument = null;
    this.preparedDocument = null;
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

  // Shell -----------------------------------------------------------------

  private render(): void {
    if (this.disposed) return;
    this.templateEditor?.destroy();
    this.templateEditor = null;
    this.documentEditor?.destroy();
    this.documentEditor = null;
    const existingForm = this.root.querySelector<HTMLFormElement>(
      "[data-document-settings]",
    );
    if (existingForm)
      this.settingsDraft = Object.fromEntries(
        [...new FormData(existingForm)].map(([key, value]) => [
          key,
          String(value),
        ]),
      );
    const main = h("main", { class: "page", "data-main": true });
    this.root.replaceChildren(
      h("div", { class: "workspace" }, this.header(), main),
    );
    const route = this.route;
    if (this.preview) main.append(...this.previewScreen());
    else if (route.name === "review") this.renderReviewScreen(main);
    else {
      if (this.discarding) main.append(this.discardConfirmation());
      main.append(...this.screen(route));
    }
    this.updateStatus();
    this.afterRender();
  }
  private screen(route: Exclude<Route, { name: "review" }>): Node[] {
    switch (route.name) {
      case "patients":
        return this.patientsScreen();
      case "patient-new":
        return this.newPatientScreen();
      case "patient":
        return this.patient
          ? this.patientScreen(route, this.patient)
          : this.patientsScreen();
      case "notes":
        return this.notesScreen();
      case "note-patient":
        return this.patientChooserScreen("note");
      case "documents":
        return this.documentsScreen();
      case "document-patient":
        return this.patientChooserScreen("document");
      case "redactions":
        return this.redactionsScreen();
      case "templates":
        return this.templatesScreen();
      case "document-new":
        return this.newDocumentScreen();
      case "document-edit":
        return this.documentEdit
          ? this.editDocumentScreen(this.documentEdit)
          : this.documentsScreen();
      case "settings":
        return this.settingsScreen();
    }
  }
  private section(): Section {
    const name = this.route.name;
    return name === "notes" ||
      name === "documents" ||
      name === "redactions" ||
      name === "templates" ||
      name === "settings"
      ? name
      : name === "note-patient"
        ? "notes"
        : name === "document-patient" ||
            name === "document-new" ||
            name === "document-edit"
          ? "documents"
          : "patients";
  }
  private header(): HTMLElement {
    const current = this.section();
    const link = (section: Section, label: string) =>
      h(
        "button",
        {
          type: "button",
          "data-route": section,
          "aria-current": current === section ? "page" : null,
          disabled: this.busy,
          onclick: () => void this.navigate({ name: section }),
        },
        label,
      );
    return h(
      "header",
      { class: "app-header" },
      h(
        "div",
        { class: "app-header__inner" },
        h(
          "button",
          {
            type: "button",
            class: "brand",
            "data-home": true,
            "aria-label": "Clinician’s Veil home",
            disabled: this.busy,
            onclick: () => void this.goHome(),
          },
          brandMark(),
          h("span", {}, "Clinician’s Veil"),
        ),
        h(
          "nav",
          { class: "primary-nav", "aria-label": "Application" },
          link("patients", "Patients"),
          link("notes", "Notes"),
          link("documents", "Documents"),
          link("redactions", "Redactions"),
          link("templates", "Document prompt templates"),
          link("settings", "Settings"),
        ),
        h(
          "span",
          { class: "local-indicator" },
          this.work === "generation" ? "Sending to OpenAI" : "On this Mac",
        ),
      ),
      h("progress", {
        class: "activity",
        "data-progress": true,
        max: "100",
        hidden: true,
      }),
      h(
        "div",
        {
          class: "activity-status",
          "data-activity-status": true,
          role: "status",
          hidden: true,
        },
        h(
          "p",
          {},
          h("strong", { "data-activity-message": true }),
          " ",
          h("span", { class: "muted", "data-work-detail": true }),
        ),
        h(
          "button",
          {
            type: "button",
            class: "button button--compact",
            "data-cancel": true,
            hidden: true,
            onclick: () => void this.cancel(),
          },
          "Cancel",
        ),
      ),
    );
  }
  private updateStatus(): void {
    if (this.disposed) return;
    if (
      this.route.name === "review" &&
      this.root.querySelector("[data-step]")
    ) {
      this.el<HTMLElement>("[data-error]").textContent = this.error;
      this.updateWorkflow();
    }
    this.updateActivity();
  }
  /** The header activity bar replaces the old full-screen overlay. Page
   * content is inert while busy; Cancel stays reachable in the header. */
  private updateActivity(): void {
    const main = this.root.querySelector<HTMLElement>("[data-main]");
    if (!main) return;
    main.inert = this.busy;
    const running = this.initialising || this.busy;
    const cancellable = this.busy && CANCELLABLE.includes(this.work);
    const progress = this.el<HTMLProgressElement>("[data-progress]");
    progress.hidden = !(this.initialising || cancellable);
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
    this.el<HTMLElement>("[data-activity-status]").hidden = !running;
    this.el<HTMLElement>("[data-activity-message]").textContent = this
      .initialising
      ? "Verifying the local model…"
      : this.message || "Working locally";
    this.el<HTMLElement>("[data-work-detail]").textContent = !running
      ? ""
      : this.work === "generation"
        ? this.cancelling
          ? "Cancelling the OpenAI request; usage may still be charged."
          : "Sending the reviewed payload to OpenAI."
        : this.cancelling
          ? "Waiting for the current local operation to stop."
          : this.workProgress &&
              this.work !== "download" &&
              this.workProgress.total > 0
            ? `Section ${Math.min(this.workProgress.completed, this.workProgress.total)} of ${this.workProgress.total} · Processing on this Mac`
            : this.work === "download"
              ? "Downloading model files only; source text stays on this Mac."
              : "Processing on this Mac.";
    const cancel = this.el<HTMLButtonElement>("[data-cancel]");
    cancel.hidden = !cancellable;
    cancel.disabled = this.cancelling;
  }
  private afterRender(): void {
    const target = this.focusTarget;
    if (!target || this.busy) return;
    this.focusTarget = null;
    const element = this.root.querySelector<HTMLElement>(
      target === "h1" ? "main h1" : target,
    );
    element?.focus();
    if (element instanceof HTMLInputElement && element.dataset.selectOnFocus)
      element.select();
  }
  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || this.busy) return;
    if (this.preview) void this.closePreview();
    else if (this.discarding) this.stay();
    else if (this.editing) this.cancelEdit();
    else if (this.confirming) this.cancelConfirm();
    else return;
    event.preventDefault();
  }
  private errorNotice(): HTMLElement {
    return h(
      "p",
      {
        class: "notice notice--danger",
        role: "alert",
        "data-error": true,
        hidden: !this.error,
      },
      this.error,
    );
  }
  private flashNotice(): HTMLElement | null {
    return this.message && !this.busy
      ? h(
          "p",
          { class: "notice", role: "status", "data-flash": true },
          this.message,
        )
      : null;
  }

  // Navigation --------------------------------------------------------------

  private async navigate(route: Route): Promise<void> {
    if (this.busy || this.disposed) return;
    if (this.preview && !(await this.closePreview())) return;
    if (this.generatedDocument || this.hasUnsavedConfiguration()) {
      this.requestLeave(route);
      return;
    }
    if (this.route.name === "review" && route.name !== "review") {
      if (this.hasUnsavedReview()) {
        this.requestLeave(route);
        return;
      }
      if (!(await this.clearSession())) return;
    }
    await this.show(route);
  }
  private async show(
    route: Route,
    options: { flash?: string; keepQuery?: boolean; focus?: string } = {},
  ): Promise<void> {
    this.templateEdit = null;
    if (route.name !== "document-edit") this.documentEdit = null;
    this.settingsDraft = null;
    this.signatureDraft = emptySignatureDraft();
    this.root.querySelector("[data-document-settings]")?.remove();
    this.route = route;
    this.error = "";
    this.confirming = null;
    this.editing = null;
    this.discarding = null;
    if (!options.keepQuery) {
      this.patientQuery = "";
      this.noteQuery = "";
      this.documentQuery = "";
      this.redactionQuery = "";
      this.templateQuery = "";
    }
    if (route.name === "patient-new")
      this.patientDraft = { name: "", reference: "" };
    if (route.name === "document-new") {
      this.documentDraft = {
        title: "",
        templateId: 0,
        model: "",
        noteIds: new Set(),
      };
      this.preparedDocument = null;
      this.generatedDocument = null;
      this.documentId = undefined;
    }
    await this.load(route);
    if (this.route.name === "patient" && this.patient) this.resetPatientDraft();
    this.message = options.flash ?? "";
    this.focusTarget = options.focus ?? "h1";
    this.render();
  }
  private async load(route: Route): Promise<void> {
    if (!this.bridge.available) return;
    const call = this.bridge.call.bind(this.bridge);
    switch (route.name) {
      case "patients": {
        const result = await this.perform("Loading patients…", () =>
          call<PatientView[]>("list_patients"),
        );
        if (result) this.patients = result;
        return;
      }
      case "patient": {
        const query = this.noteQuery;
        const result = await this.perform("Opening patient…", async () => {
          const patients = await call<PatientView[]>("list_patients");
          const patient = patients.find((item) => item.id === route.patientId);
          if (!patient) throw "This patient is no longer available.";
          const notes =
            route.tab === "notes"
              ? await call<NoteSummary[]>("search_notes", {
                  query,
                  patientId: patient.id,
                })
              : this.notes;
          const documents =
            route.tab === "documents"
              ? await call<DocumentSummary[]>("list_patient_documents", {
                  patientId: patient.id,
                })
              : this.documents;
          const [patientMappings, mappings] =
            route.tab === "redactions"
              ? await Promise.all([
                  call<MappingView[]>("list_patient_mappings", {
                    patientId: patient.id,
                  }),
                  call<MappingView[]>("list_mappings"),
                ])
              : [this.patientMappings, this.mappings];
          return {
            patients,
            patient,
            notes,
            documents,
            patientMappings,
            mappings,
          };
        });
        if (!result) {
          this.patient = null;
          this.route = { name: "patients" };
          return;
        }
        ({
          patients: this.patients,
          patient: this.patient,
          notes: this.notes,
          documents: this.documents,
          patientMappings: this.patientMappings,
          mappings: this.mappings,
        } = result);
        this.searchedQuery = query;
        return;
      }
      case "document-new": {
        const result = await this.perform(
          "Preparing a new document…",
          async () => {
            const [patients, notes, templates, settings] = await Promise.all([
              call<PatientView[]>("list_patients"),
              call<NoteSummary[]>("search_notes", {
                query: "",
                patientId: route.patientId,
              }),
              call<DocumentTemplate[]>("list_document_templates", {
                includeArchived: false,
              }),
              call<DocumentSettings>("document_settings"),
            ]);
            const patient = patients.find(
              (item) => item.id === route.patientId,
            );
            if (!patient) throw "This patient is no longer available.";
            return { patients, patient, notes, templates, settings };
          },
        );
        if (!result) return;
        this.patients = result.patients;
        this.patient = result.patient;
        this.notes = result.notes;
        this.templates = result.templates;
        this.documentSettings = result.settings;
        this.documentDraft.templateId = result.templates[0]?.id ?? 0;
        this.documentDraft.model = result.settings.openaiModel;
        return;
      }
      case "document-edit": {
        const result = await this.perform("Opening document…", async () => {
          const [document, patients, settings] = await Promise.all([
            call<PatientDocument>("patient_document", {
              id: route.documentId,
            }),
            call<PatientView[]>("list_patients"),
            call<DocumentSettings>("document_settings"),
          ]);
          const patient = patients.find(
            (item) => item.id === document.patientId,
          );
          if (!patient) throw "This patient is no longer available.";
          return { document, patients, patient, settings };
        });
        if (!result) return;
        this.patients = result.patients;
        this.patient = result.patient;
        this.documentSettings = result.settings;
        this.documentEdit = {
          document: result.document,
          title: result.document.title,
          markdown: documentBodyToMarkdown(result.document.body),
          reviewed: result.document.reviewed,
          includeSignature: result.document.includeSignature,
        };
        return;
      }
      case "document-patient":
      case "note-patient": {
        const result = await this.perform("Loading patients…", () =>
          call<PatientView[]>("list_patients"),
        );
        if (result) this.patients = result;
        return;
      }
      case "documents": {
        const result = await this.perform("Loading documents…", () =>
          call<DocumentSummary[]>("list_documents"),
        );
        if (result) this.documents = result;
        return;
      }
      case "notes": {
        const query = this.noteQuery;
        const result = await this.perform("Searching notes…", () =>
          call<NoteSummary[]>("search_notes", { query }),
        );
        if (result) {
          this.notes = result;
          this.searchedQuery = query;
        }
        return;
      }
      case "redactions": {
        const result = await this.perform("Loading redactions…", () =>
          call<MappingView[]>("list_mappings"),
        );
        if (result) this.mappings = result;
        return;
      }
      case "templates": {
        const result = await this.perform(
          "Loading document prompt templates…",
          () =>
            call<DocumentTemplate[]>("list_document_templates", {
              includeArchived: true,
            }),
        );
        if (result) this.templates = result;
        return;
      }
      case "settings": {
        const result = await this.perform(
          "Loading settings and usage…",
          async () => {
            const [model, settings, usage] = await Promise.all([
              call<ModelStatus>("model_status"),
              call<DocumentSettings>("document_settings"),
              call<UsageSummary>(
                "document_usage",
                this.usagePeriod === "month" ? monthRange() : {},
              ),
            ]);
            return { model, settings, usage };
          },
        );
        if (result) {
          this.model = result.model;
          this.documentSettings = result.settings;
          this.usage = result.usage;
          this.settingsDraft = null;
          this.root.querySelector("[data-document-settings]")?.remove();
          this.signatureDraft = emptySignatureDraft();
        }
        return;
      }
      default:
        return;
    }
  }
  private hasUnsavedReview(): boolean {
    if (this.session)
      return !(
        this.savedTitle !== null &&
        this.session.revision === this.openedRevision &&
        this.drafts.size === 0
      );
    return this.source.trim().length > 0 || this.imported !== null;
  }
  private hasUnsavedConfiguration(): boolean {
    if (this.documentEdit) {
      const edit = this.documentEdit;
      return (
        edit.title !== edit.document.title ||
        edit.markdown !== documentBodyToMarkdown(edit.document.body) ||
        edit.reviewed !== edit.document.reviewed ||
        edit.includeSignature !== edit.document.includeSignature
      );
    }
    if (this.templateEdit) {
      const original = this.templates.find(
        (item) => item.id === this.templateEdit?.id,
      );
      return (["name", "description", "instructions"] as const).some(
        (key) => this.templateEdit![key] !== (original?.[key] ?? ""),
      );
    }
    const form = this.root.querySelector<HTMLFormElement>(
      "[data-document-settings]",
    );
    if (!form) return false;
    const data = new FormData(form);
    return Boolean(
      data.get("apiKey") ||
      this.signatureDraft.editing ||
      this.signatureDraft.removed ||
      ["displayName", "role", "qualifications"].some(
        (key) =>
          String(data.get(key) ?? "") !==
          String(this.documentSettings?.[key as "displayName"] ?? ""),
      ) ||
      String(data.get("letterHeader") ?? "") !==
        (this.documentSettings?.letterHeader ?? "") ||
      String(data.get("model") ?? "") !==
        (this.documentSettings?.openaiModel ?? ""),
    );
  }
  private requestLeave(target: Leave): void {
    this.discarding = target;
    this.focusTarget = "[data-stay]";
    this.render();
  }
  private stay(): void {
    this.discarding = null;
    this.focusTarget = this.generatedDocument ? "h1" : "[data-discard]";
    this.render();
  }
  private async confirmLeave(): Promise<void> {
    const target = this.discarding;
    if (!target || this.busy) return;
    this.discarding = null;
    if (target === "replace-document" || target === "import") {
      await this.chooseDocument();
      return;
    }
    if (target === "regenerate") {
      this.generatedDocument = null;
      this.preparedDocument = null;
      this.render();
      return;
    }
    this.generatedDocument = null;
    this.preparedDocument = null;
    if (!(await this.clearSession())) return;
    if (target === "paste") {
      this.inputMode = "paste";
      this.focusTarget = "#source-input";
      this.render();
    } else if (target === "home") {
      this.dispose();
      this.onHome();
    } else if (target === "discard") {
      this.focusTarget = "#source-input";
      this.render();
    } else await this.show(target);
  }
  private async goHome(): Promise<void> {
    if (this.busy || this.disposed) return;
    if (this.preview && !(await this.closePreview())) return;
    if (
      this.generatedDocument ||
      this.hasUnsavedConfiguration() ||
      (this.route.name === "review" && this.hasUnsavedReview())
    ) {
      this.requestLeave("home");
      return;
    }
    if (!(await this.clearSession())) return;
    this.dispose();
    this.onHome();
  }
  private discardClicked(): void {
    if (this.busy) return;
    if (this.hasUnsavedReview()) this.requestLeave("discard");
    else void this.clearSession().then(() => this.render());
  }
  /** Drops the native and displayed review session. Returns false, with the
   * error shown, if the native session could not be cleared. */
  private async clearSession(ignoreErrors = false): Promise<boolean> {
    if (
      (this.source || this.session || this.imported || this.preview) &&
      this.bridge.available
    ) {
      this.busy = true;
      this.message = "Clearing the session…";
      this.render();
      try {
        await this.bridge.call("discard_session");
      } catch {
        if (!ignoreErrors) {
          this.error = "The session could not be cleared. Please retry.";
          this.busy = false;
          this.message = "";
          this.render();
          return false;
        }
      }
      this.busy = false;
      this.message = "";
    }
    this.resetReview();
    this.error = "";
    return !this.disposed;
  }
  private resetReview(): void {
    this.source = "";
    this.imported = null;
    this.originalDocument = null;
    this.originalNoteId = null;
    this.inputMode = "paste";
    this.warningsAcknowledged = false;
    this.preview = null;
    this.previewImage = "";
    this.session = null;
    this.savedTitle = null;
    this.noteTitle = null;
    this.openedRevision = null;
    this.saveError = "";
    this.reviewSavedMappings = false;
    this.wizardGroup = null;
    this.wizardGroupIds = [];
    this.selection = null;
    this.drafts.clear();
  }
  private startConfirm(key: string, trigger: string): void {
    if (this.busy) return;
    this.confirming = key;
    this.restoreFocus = trigger;
    this.focusTarget = "[data-cancel-confirm]";
    this.render();
  }
  private cancelConfirm(): void {
    this.confirming = null;
    this.focusTarget = this.restoreFocus;
    this.render();
  }

  // Patients ----------------------------------------------------------------

  private patientsScreen(): Node[] {
    const query = this.patientQuery.toLowerCase();
    const rows = this.patients.filter((patient) =>
      `${patient.name} ${patient.patientReference ?? ""}`
        .toLowerCase()
        .includes(query),
    );
    const add = (primary: boolean) =>
      h(
        "button",
        {
          type: "button",
          class: primary ? "button button--primary" : "button",
          "data-add-patient": primary ? true : null,
          disabled: this.busy,
          onclick: () => void this.navigate({ name: "patient-new" }),
        },
        "Add patient",
      );
    const list = !this.patients.length
      ? emptyState(
          "No patients yet",
          "Add a patient to start their first note.",
          add(false),
        )
      : h(
          "div",
          {},
          toolbar(
            searchForm({
              label: "Search patients",
              placeholder: "Search by name or patient number",
              value: this.patientQuery,
              onSearch: (value) => {
                this.patientQuery = value;
                this.focusTarget = "#search";
                this.render();
              },
            }),
            searchStatus({
              shown: rows.length,
              total: this.patients.length,
              noun: "patient",
              query: this.patientQuery,
              onClear: () => {
                this.patientQuery = "";
                this.focusTarget = "#search";
                this.render();
              },
            }),
          ),
          dataTable(
            [
              { label: "Patient" },
              { label: "Patient number" },
              { label: "Notes", narrow: true },
              { label: "Documents", narrow: true },
              { label: "Redactions", narrow: true },
              { label: "Actions", hidden: true },
            ],
            rows.length
              ? rows.map((patient) => this.patientRow(patient))
              : [
                  h(
                    "tr",
                    {},
                    h(
                      "td",
                      { colspan: 6, class: "muted" },
                      `No patients match “${this.patientQuery}”.`,
                    ),
                  ),
                ],
          ),
        );
    return [
      pageHeader({
        eyebrow: "Patient library",
        title: ["Patients"],
        id: "patients-title",
        description:
          "Open a patient to see their notes and redactions, or start a new note.",
        actions: [add(true)],
      }),
      this.errorNotice(),
      this.flashNotice(),
      h("section", { "data-patient-list": true }, list),
    ].filter((node): node is HTMLElement => node !== null);
  }
  private patientRow(patient: PatientView): HTMLElement {
    const open = () =>
      void this.navigate({
        name: "patient",
        patientId: patient.id,
        tab: "notes",
      });
    return h(
      "tr",
      { class: "row-link", onclick: rowOpener(open) },
      h(
        "td",
        {},
        h(
          "button",
          {
            type: "button",
            class: "row-open",
            "data-open-patient": patient.id,
            onclick: open,
          },
          patient.name,
        ),
      ),
      h("td", { class: "mono" }, patient.patientReference ?? "—"),
      h("td", { class: "hide-narrow" }, patient.noteCount ?? 0),
      h("td", { class: "hide-narrow" }, patient.documentCount ?? 0),
      h("td", { class: "hide-narrow" }, patient.redactionCount ?? 0),
      h(
        "td",
        { class: "actions" },
        h(
          "button",
          {
            type: "button",
            class: "button button--compact",
            "data-start-note": patient.id,
            onclick: () => this.startNote(patient),
          },
          "New note",
        ),
      ),
    );
  }
  private newPatientScreen(): Node[] {
    return [
      breadcrumb([
        {
          label: "Patients",
          onSelect: () => void this.navigate({ name: "patients" }),
        },
        { label: "New patient" },
      ]),
      pageHeader({
        eyebrow: "Patient library",
        title: ["New patient"],
        id: "new-patient-title",
        description:
          "Add the details you use to recognise this patient. They stay in the encrypted library on this Mac.",
      }),
      this.errorNotice(),
      h(
        "form",
        {
          class: "panel",
          "data-patient-form": true,
          onsubmit: (event: Event) => {
            event.preventDefault();
            void this.createPatient();
          },
        },
        ...this.patientFields(),
        h(
          "div",
          { class: "form-actions" },
          h(
            "button",
            { type: "submit", class: "button button--primary" },
            "Add patient",
          ),
          h(
            "button",
            {
              type: "button",
              class: "button button--quiet",
              onclick: () => void this.navigate({ name: "patients" }),
            },
            "Cancel",
          ),
        ),
      ),
    ];
  }
  private patientFields(onChange?: () => void): HTMLElement[] {
    const field = (
      key: "name" | "reference",
      id: string,
      label: string,
      limit: number,
      hint?: string,
    ) =>
      h(
        "div",
        { class: "field" },
        h(
          "label",
          { for: id },
          label,
          key === "reference" && " ",
          key === "reference" && h("span", { class: "muted" }, "(optional)"),
        ),
        h("input", {
          id,
          [`data-patient-${key}`]: true,
          value: this.patientDraft[key],
          maxlength: limit,
          required: key === "name",
          autocomplete: "off",
          spellcheck: "false",
          "aria-describedby": hint ? `${id}-hint` : null,
          oninput: (event: Event) => {
            this.patientDraft[key] = (event.target as HTMLInputElement).value;
            onChange?.();
          },
        }),
        hint && h("span", { class: "hint", id: `${id}-hint` }, hint),
      );
    return [
      field("name", "patient-name", "Patient name", 160),
      field(
        "reference",
        "patient-reference",
        "Patient number",
        128,
        "Your local reference, for example a case number.",
      ),
    ];
  }
  private async createPatient(): Promise<void> {
    const result = await this.perform("Adding patient…", () =>
      this.bridge.call<PatientView>("create_patient", {
        name: this.patientDraft.name,
        patientReference: this.patientDraft.reference.trim() || undefined,
      }),
    );
    if (result) {
      await this.show(
        { name: "patient", patientId: result.id, tab: "notes" },
        { flash: "Patient added." },
      );
      return;
    }
    this.focusTarget = "#patient-name";
    this.render();
  }
  private startNote(patient: PatientView): void {
    if (this.busy) return;
    this.patient = patient;
    this.route = { name: "review" };
    this.resetReview();
    this.error = "";
    this.message = "";
    this.confirming = null;
    if (this.bridge.available)
      void this.bridge.call("discard_session").catch(() => undefined);
    this.focusTarget = "#source-input";
    this.render();
  }

  // Patient workspace -------------------------------------------------------

  private patientScreen(
    route: Extract<Route, { name: "patient" }>,
    patient: PatientView,
  ): Node[] {
    const count: Record<Tab, number | undefined> = {
      details: undefined,
      notes: patient.noteCount,
      documents: patient.documentCount,
      redactions: patient.redactionCount,
    };
    const tabs = TABS.map((tab) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          id: `tab-${tab}`,
          "data-tab": tab,
          "aria-selected": String(route.tab === tab),
          "aria-controls": "patient-panel",
          tabindex: route.tab === tab ? "0" : "-1",
          onclick: () => this.selectTab(route, tab),
          onkeydown: (event: Event) =>
            this.tabKeys(event as KeyboardEvent, route),
        },
        TAB_LABEL[tab],
        count[tab] !== undefined &&
          h("span", { class: "count" }, count[tab] ?? 0),
      ),
    );
    const content =
      route.tab === "details"
        ? this.detailsTab(patient)
        : route.tab === "notes"
          ? this.patientNotesTab(patient)
          : route.tab === "documents"
            ? this.patientDocumentsTab(patient)
            : this.patientRedactionsTab(patient);
    return [
      breadcrumb([
        {
          label: "Patients",
          onSelect: () => void this.navigate({ name: "patients" }),
        },
        { label: patient.name },
      ]),
      h(
        "section",
        { class: "patient-ribbon" },
        pageHeader({
          eyebrow: "Patient",
          title: [
            patient.name,
            patient.patientReference &&
              h("span", { class: "reference" }, patient.patientReference),
          ],
          id: "patient-title",
          actions: [
            h(
              "button",
              {
                type: "button",
                class: "button",
                "data-new-document": true,
                onclick: () =>
                  void this.navigate({
                    name: "document-new",
                    patientId: patient.id,
                  }),
              },
              "New document",
            ),
            h(
              "button",
              {
                type: "button",
                class: "button button--primary",
                "data-new-note": true,
                onclick: () => this.startNote(patient),
              },
              "New note",
            ),
          ],
        }),
        h(
          "div",
          { class: "tabs", role: "tablist", "aria-label": "Patient sections" },
          ...tabs,
        ),
      ),
      h(
        "section",
        {
          class: "tab-panel",
          role: "tabpanel",
          id: "patient-panel",
          "aria-labelledby": `tab-${route.tab}`,
        },
        this.errorNotice(),
        this.flashNotice(),
        ...content,
      ),
    ];
  }
  private selectTab(
    route: Extract<Route, { name: "patient" }>,
    tab: Tab,
  ): void {
    if (this.busy || tab === route.tab) return;
    void this.show({ ...route, tab }, { focus: `#tab-${tab}` });
  }
  private tabKeys(
    event: KeyboardEvent,
    route: Extract<Route, { name: "patient" }>,
  ): void {
    const index = TABS.indexOf(route.tab);
    const next =
      event.key === "ArrowRight"
        ? TABS[(index + 1) % TABS.length]
        : event.key === "ArrowLeft"
          ? TABS[(index + TABS.length - 1) % TABS.length]
          : event.key === "Home"
            ? TABS[0]
            : event.key === "End"
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    this.selectTab(route, next);
  }
  private resetPatientDraft(): void {
    this.patientDraft = {
      name: this.patient?.name ?? "",
      reference: this.patient?.patientReference ?? "",
    };
  }
  private detailsTab(patient: PatientView): Node[] {
    const changed = () =>
      this.patientDraft.name !== patient.name ||
      this.patientDraft.reference !== (patient.patientReference ?? "");
    const actions = [
      h(
        "button",
        {
          type: "submit",
          class: "button",
          "data-save-patient": true,
          "data-requires-change": true,
          disabled: !changed(),
        },
        "Save changes",
      ),
      h(
        "button",
        {
          type: "button",
          class: "button button--quiet",
          "data-undo-patient": true,
          "data-requires-change": true,
          disabled: !changed(),
          onclick: () => {
            this.resetPatientDraft();
            this.focusTarget = "#patient-name";
            this.render();
          },
        },
        "Undo changes",
      ),
    ];
    const form = h(
      "form",
      {
        class: "form-stack",
        "data-patient-form": true,
        onsubmit: (event: Event) => {
          event.preventDefault();
          if (changed()) void this.savePatient(patient);
        },
      },
      ...this.patientFields(() => {
        for (const button of actions) button.disabled = !changed();
      }),
      h("div", { class: "form-actions" }, ...actions),
    );
    const danger =
      this.confirming === "patient"
        ? h(
            "div",
            { class: "danger-zone notice notice--danger" },
            confirmation({
              subject: "patient",
              question: `Delete ${patient.name}?`,
              consequence: `Their ${plural(patient.noteCount ?? 0, "note")}, ${plural(patient.documentCount ?? 0, "document")} and ${plural(patient.redactionCount ?? 0, "redaction")} will also be deleted from the encrypted library.`,
              onCancel: () => this.cancelConfirm(),
              onConfirm: () => void this.deletePatient(patient),
            }),
          )
        : h(
            "div",
            { class: "danger-zone" },
            h(
              "div",
              {},
              h("p", { class: "section-title" }, "Delete patient"),
              h(
                "p",
                { class: "muted" },
                "Removes this patient, their notes, documents and redactions from this Mac.",
              ),
            ),
            h(
              "button",
              {
                type: "button",
                class: "button button--danger-quiet",
                "data-confirm-trigger": "patient",
                onclick: () =>
                  this.startConfirm(
                    "patient",
                    '[data-confirm-trigger="patient"]',
                  ),
              },
              "Delete patient…",
            ),
          );
    return [form, danger];
  }
  private async savePatient(patient: PatientView): Promise<void> {
    const result = await this.perform("Saving changes…", () =>
      this.bridge.call<PatientView>("update_patient", {
        id: patient.id,
        name: this.patientDraft.name,
        patientReference: this.patientDraft.reference.trim() || undefined,
      }),
    );
    if (result) {
      this.patient = result;
      this.patients = this.patients.map((item) =>
        item.id === result.id ? result : item,
      );
      this.resetPatientDraft();
      this.message = "Changes saved.";
    }
    this.focusTarget = "#patient-name";
    this.render();
  }
  private async deletePatient(patient: PatientView): Promise<void> {
    let deleted = false;
    await this.perform("Deleting patient…", async () => {
      await this.bridge.call("delete_patient", { id: patient.id });
      deleted = true;
    });
    if (deleted) {
      this.patient = null;
      await this.show({ name: "patients" }, { flash: "Patient deleted." });
      return;
    }
    this.render();
  }

  // Notes -------------------------------------------------------------------

  private patientNotesTab(patient: PatientView): Node[] {
    if (!this.notes.length && !this.searchedQuery)
      return [
        emptyState(
          "No notes yet",
          "Start a note to de-identify text for this patient.",
          h(
            "button",
            {
              type: "button",
              class: "button",
              onclick: () => this.startNote(patient),
            },
            "Start a note",
          ),
        ),
      ];
    return [this.notesTable(patient.noteCount, false)];
  }
  private notesScreen(): Node[] {
    const create = () =>
      h(
        "button",
        {
          type: "button",
          class: "button button--primary",
          "data-new-note": true,
          onclick: () => void this.navigate({ name: "note-patient" }),
        },
        "New note",
      );
    return [
      pageHeader({
        eyebrow: "Encrypted library",
        title: ["Notes"],
        id: "notes-title",
        description:
          "Reviewed notes for every patient. Start a note by choosing its patient.",
        actions: [create()],
      }),
      this.errorNotice(),
      this.flashNotice(),
      h(
        "section",
        { "data-note-results": true },
        !this.notes.length && !this.searchedQuery
          ? emptyState(
              "No notes yet",
              "Open a patient and start a note. Saved notes appear here.",
              create(),
            )
          : this.notesTable(undefined, true),
      ),
    ].filter((node): node is HTMLElement => node !== null);
  }
  private notesTable(total: number | undefined, withPatient: boolean): Node {
    const columns = withPatient ? 6 : 5;
    const rows = this.notes.flatMap((note) => {
      const open = () => void this.openNote(note.id);
      const key = `note-${note.id}`;
      const row = h(
        "tr",
        { class: "row-link", onclick: rowOpener(open) },
        withPatient &&
          h(
            "td",
            {},
            note.patientName ?? "Patient unavailable",
            note.patientReference &&
              h("span", { class: "mono muted" }, ` ${note.patientReference}`),
          ),
        h(
          "td",
          {},
          h(
            "button",
            {
              type: "button",
              class: "row-open",
              "data-open-note": note.id,
              onclick: open,
            },
            note.title,
          ),
        ),
        h("td", { class: "excerpt" }, ...withPlaceholders(note.snippet)),
        h(
          "td",
          {},
          note.document
            ? documentButton(
                note.document.format,
                `Preview original ${documentLabel(note.document)}`,
                () =>
                  void this.openPreview(
                    note.id,
                    `[data-document="${note.id}"]`,
                  ),
                note.id,
              )
            : h(
                "span",
                { class: "muted", "aria-label": "No original document" },
                "—",
              ),
        ),
        h("td", { class: "mono" }, formatDate(note.createdAt)),
        h(
          "td",
          { class: "actions" },
          h(
            "button",
            {
              type: "button",
              class: "button button--compact button--danger-quiet",
              "data-confirm-trigger": key,
              onclick: () =>
                this.startConfirm(key, `[data-confirm-trigger="${key}"]`),
            },
            "Delete",
          ),
        ),
      );
      return this.confirming === key
        ? [
            row,
            confirmRow({
              colspan: columns,
              subject: "note",
              consequence:
                "Its original document, source text, reviewed text and review record will be deleted from the encrypted library.",
              onCancel: () => this.cancelConfirm(),
              onConfirm: () => void this.deleteNote(note.id),
            }),
          ]
        : [row];
    });
    return h(
      "div",
      {},
      toolbar(
        searchForm({
          label: "Search notes",
          placeholder: "Search titles and reviewed text",
          value: this.noteQuery,
          onSearch: (value) => void this.searchNotes(value),
        }),
        searchStatus({
          shown: this.notes.length,
          total,
          noun: "note",
          query: this.searchedQuery,
          onClear: () => void this.searchNotes(""),
        }),
      ),
      dataTable(
        [
          ...(withPatient ? [{ label: "Patient" }] : []),
          { label: "Title" },
          { label: "Reviewed text", narrow: true },
          { label: "Original" },
          { label: "Saved" },
          { label: "Actions", hidden: true },
        ],
        rows.length
          ? rows
          : [
              h(
                "tr",
                {},
                h(
                  "td",
                  { colspan: columns, class: "muted" },
                  `No notes match “${this.searchedQuery}”.`,
                ),
              ),
            ],
      ),
    );
  }
  private async searchNotes(query: string): Promise<void> {
    this.noteQuery = query;
    this.confirming = null;
    await this.load(this.route);
    this.focusTarget = "#search";
    this.render();
  }
  private async openNote(id: number): Promise<void> {
    const result = await this.perform("Opening saved note…", () =>
      this.bridge.call<OpenedNote>("open_saved_note", { id }),
    );
    if (result) {
      this.resetReview();
      this.originalDocument = result.note.document ?? null;
      this.originalNoteId = result.note.id;
      this.savedTitle = result.note.title;
      this.noteTitle = result.note.title;
      this.patient = {
        id: result.note.patientId!,
        name: result.note.patientName ?? "Patient unavailable",
        patientReference: result.note.patientReference,
      };
      this.source = result.session.source;
      this.session = result.session;
      this.openedRevision = result.session.revision;
      this.route = { name: "review" };
      this.confirming = null;
      this.message = "";
      this.focusTarget = "h1";
    }
    this.render();
  }
  private async deleteNote(id: number): Promise<void> {
    let deleted = false;
    await this.perform("Deleting note…", async () => {
      await this.bridge.call("delete_note", { id });
      deleted = true;
    });
    if (deleted) {
      await this.show(this.route, {
        flash: "Note deleted.",
        keepQuery: true,
        focus: "#search",
      });
      return;
    }
    this.render();
  }

  private switchInput(mode: "paste" | "import"): void {
    if (this.busy || this.inputMode === mode) return;
    if (this.hasUnsavedReview()) {
      this.requestLeave(mode);
      return;
    }
    this.inputMode = mode;
    this.focusTarget = `[data-input-mode="${mode}"]`;
    this.render();
  }
  private async chooseDocument(): Promise<void> {
    if (!this.patient) return;
    const imported = await this.perform(
      "Choosing document…",
      () =>
        this.bridge.call<ImportedDocument | null>("import_document", {
          operation: this.operation,
          patientId: this.patient!.id,
        }),
      "import",
    );
    if (imported) {
      this.imported = imported;
      this.originalDocument = imported.document;
      this.originalNoteId = null;
      this.inputMode = "import";
      this.source = imported.extracted.text;
      this.warningsAcknowledged = false;
      this.focusTarget = "#source-input";
    }
    this.render();
  }
  private documentToolbar(editable: boolean): HTMLElement {
    const metadata = this.originalDocument!;
    const toolbar = h(
      "div",
      { class: "document-toolbar" },
      h(
        "div",
        { class: "document-toolbar__name" },
        h("strong", {}, `${metadata.format.toUpperCase()} · ${metadata.name}`),
        h(
          "p",
          { class: "muted" },
          this.originalNoteId
            ? "Original retained in the encrypted library."
            : "The original will be retained when you save this note.",
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: "button button--compact",
          "data-preview-import": true,
          onclick: () =>
            void this.openPreview(this.originalNoteId, "[data-preview-import]"),
        },
        "Preview",
      ),
      editable &&
        h(
          "button",
          {
            type: "button",
            class: "button button--compact",
            "data-change-document": true,
            onclick: () => this.requestLeave("replace-document"),
          },
          "Change document",
        ),
    );
    if (editable && this.imported?.extracted.warnings.length) {
      toolbar.append(
        h(
          "div",
          { class: "document-warning" },
          ...this.imported.extracted.warnings.map((warning) =>
            h("p", { class: "notice" }, warning),
          ),
          h(
            "label",
            {},
            h("input", {
              type: "checkbox",
              "data-acknowledge-document": true,
              checked: this.warningsAcknowledged,
              onchange: (event) => {
                this.warningsAcknowledged = (
                  event.target as HTMLInputElement
                ).checked;
                this.focusTarget = "[data-acknowledge-document]";
                this.render();
              },
            }),
            " I have checked the extracted text and the extraction limitations.",
          ),
        ),
      );
    }
    return toolbar;
  }
  private async openPreview(
    noteId: number | null,
    focus: string,
  ): Promise<void> {
    this.previewReturnFocus = focus;
    this.previewReturnScroll = window.scrollY;
    const result = await this.perform(
      "Opening original document…",
      () =>
        this.bridge.call<DocumentPreview>("open_document_preview", {
          operation: this.operation,
          ...(noteId !== null ? { noteId } : { importId: this.imported?.id }),
        }),
      "preview",
    );
    if (result) {
      this.preview = result;
      this.previewPage = 0;
      this.previewWidth = 800;
      this.previewImage = "";
      this.focusTarget = "h1";
      this.render();
      if (result.document.format === "pdf") await this.loadPreviewPage();
    }
    this.render();
  }
  private async loadPreviewPage(): Promise<void> {
    if (!this.preview) return;
    this.previewImage = "";
    const image = await this.perform(
      "Displaying PDF page…",
      () =>
        this.bridge.call<string>("document_preview_page", {
          operation: this.operation,
          id: this.preview!.id,
          page: this.previewPage,
          width: this.previewWidth,
        }),
      "preview",
    );
    if (image && this.preview) this.previewImage = image;
    this.render();
  }
  private async closePreview(): Promise<boolean> {
    if (!this.preview || this.busy) return !this.preview;
    let closed = false;
    await this.perform("Closing original document…", async () => {
      await this.bridge.call("close_document_preview", {
        id: this.preview!.id,
      });
      closed = true;
    });
    if (closed) {
      this.preview = null;
      this.previewImage = "";
      this.focusTarget = this.previewReturnFocus;
    }
    this.render();
    if (closed) document.documentElement.scrollTop = this.previewReturnScroll;
    return closed;
  }
  private previewScreen(): Node[] {
    const preview = this.preview!;
    const pdf = preview.document.format === "pdf";
    return [
      h(
        "button",
        {
          type: "button",
          class: "button button--quiet",
          "data-close-preview": true,
          onclick: () => void this.closePreview(),
        },
        this.route.name === "review" ? "← Back to note" : "← Back to results",
      ),
      pageHeader({
        eyebrow: "Source material",
        title: ["Original document"],
        id: "document-preview-title",
        description: preview.document.name,
      }),
      h(
        "p",
        { class: "notice" },
        "Original document — contains source material. Privacy transformations have not been applied to this document.",
      ),
      this.errorNotice(),
      ...(preview.document.format === "docx"
        ? [
            h(
              "p",
              { class: "muted" },
              "Simplified layout · headings, text, lists and tables",
            ),
          ]
        : []),
      ...preview.extracted.warnings.map((warning) =>
        h("p", { class: "muted" }, warning),
      ),
      ...(pdf
        ? [
            h(
              "div",
              { class: "document-toolbar" },
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  "data-page-previous": true,
                  disabled: this.previewPage === 0 || this.busy,
                  onclick: () => {
                    this.previewPage--;
                    this.focusTarget = "[data-page-next]";
                    void this.loadPreviewPage();
                  },
                },
                "Previous",
              ),
              h(
                "span",
                { role: "status", class: "mono" },
                `Page ${this.previewPage + 1} of ${preview.extracted.pageCount}`,
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  "data-page-next": true,
                  disabled:
                    this.previewPage + 1 >=
                      (preview.extracted.pageCount ?? 0) || this.busy,
                  onclick: () => {
                    this.previewPage++;
                    this.focusTarget = "[data-page-previous]";
                    void this.loadPreviewPage();
                  },
                },
                "Next",
              ),
              h(
                "label",
                {},
                "Zoom ",
                h(
                  "select",
                  {
                    "aria-label": "Preview zoom",
                    value: String(this.previewWidth),
                    onchange: (event) => {
                      this.focusTarget = '[aria-label="Preview zoom"]';
                      this.previewWidth = Number(
                        (event.target as HTMLSelectElement).value,
                      );
                      void this.loadPreviewPage();
                    },
                  },
                  ...[800, 1200, 1600].map((width) =>
                    h(
                      "option",
                      { value: width, selected: width === this.previewWidth },
                      `${width / 8}%`,
                    ),
                  ),
                ),
              ),
              this.error &&
                h(
                  "button",
                  {
                    type: "button",
                    class: "button",
                    onclick: () => void this.loadPreviewPage(),
                  },
                  "Retry page",
                ),
            ),
            this.previewImage
              ? h(
                  "div",
                  { class: "document-viewport" },
                  h("img", {
                    class: "document-page",
                    src: this.previewImage,
                    width: this.previewWidth,
                    alt: `Original PDF page ${this.previewPage + 1}`,
                  }),
                )
              : h(
                  "p",
                  { class: "muted" },
                  this.error
                    ? "The page could not be displayed."
                    : "Loading page…",
                ),
          ]
        : [documentContent(preview.extracted.blocks)]),
    ];
  }

  // Documents ---------------------------------------------------------------

  private newDocumentAction(primary = true): HTMLElement {
    return h(
      "button",
      {
        type: "button",
        class: primary ? "button button--primary" : "button",
        "data-new-document": true,
        onclick: () => void this.navigate({ name: "document-patient" }),
      },
      "New document",
    );
  }

  private documentsScreen(): Node[] {
    const query = this.documentQuery.toLowerCase();
    const rows = this.documents.filter((document) =>
      `${document.title} ${document.templateName} ${document.patientName ?? ""} ${document.patientReference ?? ""}`
        .toLowerCase()
        .includes(query),
    );
    const list = !this.documents.length
      ? emptyState(
          "No documents yet",
          "Create a patient document from completed reviewed notes.",
          this.newDocumentAction(false),
        )
      : h(
          "div",
          {},
          toolbar(
            searchForm({
              label: "Search documents",
              placeholder: "Search by title, patient or template",
              value: this.documentQuery,
              onSearch: (value) => {
                this.documentQuery = value;
                this.focusTarget = "#search";
                this.render();
              },
            }),
            searchStatus({
              shown: rows.length,
              total: this.documents.length,
              noun: "document",
              query: this.documentQuery,
              onClear: () => {
                this.documentQuery = "";
                this.focusTarget = "#search";
                this.render();
              },
            }),
          ),
          dataTable(
            [
              { label: "Patient" },
              { label: "Title" },
              { label: "Template" },
              { label: "Updated" },
              { label: "Status" },
              { label: "Latest cost" },
              { label: "Total cost" },
            ],
            rows.length
              ? rows.map((document) => {
                  const open = () =>
                    void this.navigate({
                      name: "document-edit",
                      documentId: document.id,
                    });
                  return h(
                    "tr",
                    { class: "row-link", onclick: rowOpener(open) },
                    h(
                      "td",
                      {},
                      document.patientName ?? "Patient unavailable",
                      document.patientReference &&
                        h(
                          "span",
                          { class: "mono muted" },
                          ` ${document.patientReference}`,
                        ),
                    ),
                    h(
                      "td",
                      {},
                      h(
                        "button",
                        {
                          type: "button",
                          class: "row-open",
                          "data-open-document": document.id,
                          onclick: open,
                        },
                        document.title,
                      ),
                    ),
                    h("td", {}, document.templateName),
                    h("td", { class: "mono" }, formatDate(document.updatedAt)),
                    h(
                      "td",
                      {},
                      h(
                        "span",
                        {
                          class: document.reviewed
                            ? "badge"
                            : "badge badge--muted",
                        },
                        document.reviewed ? "Reviewed" : "Draft",
                      ),
                    ),
                    h(
                      "td",
                      { class: "mono" },
                      !document.usage?.generationAttempts
                        ? "—"
                        : document.usage.latestCostNanos === null
                          ? "Cost unknown"
                          : usd(document.usage.latestCostNanos),
                    ),
                    h(
                      "td",
                      { class: "mono" },
                      !document.usage?.generationAttempts
                        ? "—"
                        : `${usd(document.usage.knownCostNanos)}${document.usage.unknownCostAttempts ? " + unknown" : ""}`,
                    ),
                  );
                })
              : [
                  h(
                    "tr",
                    {},
                    h(
                      "td",
                      { colspan: 7, class: "muted" },
                      `No documents match “${this.documentQuery}”.`,
                    ),
                  ),
                ],
          ),
        );
    return [
      pageHeader({
        eyebrow: "Encrypted library",
        title: ["Documents"],
        id: "documents-title",
        description:
          "Draft and reviewed patient documents, with generation costs kept alongside each report.",
        actions: [this.newDocumentAction()],
      }),
      this.errorNotice(),
      this.flashNotice(),
      h("section", { "data-document-results": true }, list),
    ].filter((node): node is HTMLElement => node !== null);
  }

  private patientChooserScreen(kind: "note" | "document"): Node[] {
    const document = kind === "document";
    const noun = document ? "document" : "note";
    const section = document ? "Documents" : "Notes";
    const query = this.patientQuery.toLowerCase();
    const patients = this.patients.filter((patient) =>
      `${patient.name} ${patient.patientReference ?? ""}`
        .toLowerCase()
        .includes(query),
    );
    const select = (patient: PatientView) => {
      if (document)
        void this.navigate({ name: "document-new", patientId: patient.id });
      else this.startNote(patient);
    };
    const addPatient = () =>
      h(
        "button",
        {
          type: "button",
          class: "button",
          "data-new-patient": true,
          onclick: () => void this.navigate({ name: "patient-new" }),
        },
        "New patient",
      );
    return [
      breadcrumb([
        {
          label: section,
          onSelect: () =>
            void this.navigate({ name: document ? "documents" : "notes" }),
        },
        { label: `New ${noun}` },
      ]),
      pageHeader({
        eyebrow: document ? "Patient document" : "Patient note",
        title: [`New ${noun}`],
        id: `${noun}-patient-title`,
        description: document
          ? "Choose the patient whose reviewed notes you want to use."
          : "Choose the patient whose note you want to create.",
        actions: [addPatient()],
      }),
      this.errorNotice(),
      !this.patients.length
        ? emptyState(
            "No patients yet",
            document
              ? "Add a patient and complete a reviewed note before creating a document."
              : "Add a patient before creating a note.",
            addPatient(),
          )
        : h(
            "section",
            { [`data-${noun}-patients`]: true },
            toolbar(
              searchForm({
                label: "Search patients",
                placeholder: "Search by name or patient number",
                value: this.patientQuery,
                onSearch: (value) => {
                  this.patientQuery = value;
                  this.focusTarget = "#search";
                  this.render();
                },
              }),
              searchStatus({
                shown: patients.length,
                total: this.patients.length,
                noun: "patient",
                query: this.patientQuery,
                onClear: () => {
                  this.patientQuery = "";
                  this.focusTarget = "#search";
                  this.render();
                },
              }),
            ),
            dataTable(
              [
                { label: "Patient" },
                { label: "Patient number" },
                { label: "Reviewed notes", narrow: true },
                { label: "Documents", narrow: true },
                { label: "Actions", hidden: true },
              ],
              patients.length
                ? patients.map((patient) =>
                    h(
                      "tr",
                      {
                        class: "row-link",
                        onclick: rowOpener(() => select(patient)),
                      },
                      h(
                        "td",
                        {},
                        h(
                          "button",
                          {
                            type: "button",
                            class: "row-open",
                            [`data-choose-${noun}-patient`]: patient.id,
                            onclick: () => select(patient),
                          },
                          patient.name,
                        ),
                      ),
                      h(
                        "td",
                        { class: "mono" },
                        patient.patientReference ?? "—",
                      ),
                      h("td", { class: "hide-narrow" }, patient.noteCount ?? 0),
                      h(
                        "td",
                        { class: "hide-narrow" },
                        patient.documentCount ?? 0,
                      ),
                      h(
                        "td",
                        { class: "actions" },
                        h(
                          "button",
                          {
                            type: "button",
                            class: "button button--compact",
                            onclick: () => select(patient),
                          },
                          "Choose",
                        ),
                      ),
                    ),
                  )
                : [
                    h(
                      "tr",
                      {},
                      h(
                        "td",
                        { colspan: 5, class: "muted" },
                        `No patients match “${this.patientQuery}”.`,
                      ),
                    ),
                  ],
            ),
          ),
    ];
  }

  // Patient documents -------------------------------------------------------

  private patientDocumentsTab(patient: PatientView): Node[] {
    const create = h(
      "button",
      {
        type: "button",
        class: "button button--primary",
        "data-new-document": true,
        onclick: () =>
          void this.navigate({ name: "document-new", patientId: patient.id }),
      },
      "New document",
    );
    if (!this.documents.length)
      return [
        emptyState(
          "No documents yet",
          "Create a document from this patient’s completed reviewed notes.",
          create,
        ),
      ];
    return [
      h(
        "div",
        { class: "table-toolbar" },
        h(
          "span",
          { class: "meta muted" },
          plural(this.documents.length, "document"),
        ),
        create,
      ),
      dataTable(
        [
          { label: "Title" },
          { label: "Template" },
          { label: "Created" },
          { label: "Status" },
          { label: "Latest cost" },
          { label: "Total cost" },
        ],
        this.documents.map((document) => {
          const open = () =>
            void this.navigate({
              name: "document-edit",
              documentId: document.id,
            });
          return h(
            "tr",
            { class: "row-link", onclick: rowOpener(open) },
            h(
              "td",
              {},
              h(
                "button",
                {
                  type: "button",
                  class: "row-open",
                  "data-open-document": document.id,
                  onclick: open,
                },
                document.title,
              ),
            ),
            h("td", {}, document.templateName),
            h("td", { class: "mono" }, formatDate(document.createdAt)),
            h(
              "td",
              {},
              h(
                "span",
                { class: document.reviewed ? "badge" : "badge badge--muted" },
                document.reviewed ? "Reviewed" : "Draft",
              ),
            ),
            h(
              "td",
              { class: "mono" },
              !document.usage?.generationAttempts
                ? "—"
                : document.usage.latestCostNanos === null
                  ? "Cost unknown"
                  : usd(document.usage.latestCostNanos),
            ),
            h(
              "td",
              { class: "mono" },
              !document.usage?.generationAttempts
                ? "—"
                : `${usd(document.usage.knownCostNanos)}${document.usage.unknownCostAttempts ? " + unknown" : ""}`,
            ),
          );
        }),
      ),
    ];
  }

  private editDocumentScreen(edit: DocumentEdit): Node[] {
    const patient = this.patient;
    if (!patient) return this.documentsScreen();
    this.documentEditor = markdownEditor(
      edit.markdown,
      (value) => {
        edit.markdown = value;
      },
      { document: true },
    );
    const hasSignature = Boolean(this.documentSettings?.hasSignature);
    return [
      breadcrumb([
        {
          label: "Patients",
          onSelect: () => void this.navigate({ name: "patients" }),
        },
        {
          label: patient.name,
          onSelect: () =>
            void this.navigate({
              name: "patient",
              patientId: patient.id,
              tab: "documents",
            }),
        },
        { label: "Documents" },
        { label: edit.document.title },
      ]),
      pageHeader({
        eyebrow: "Patient document",
        title: ["Edit document"],
        id: "edit-document-title",
        description: `${edit.document.templateName} · Revision ${edit.document.revision}`,
      }),
      this.errorNotice(),
      h(
        "form",
        {
          class: "template-form",
          "data-document-edit": edit.document.id,
          onsubmit: (event) => {
            event.preventDefault();
            void this.saveEditedDocument(edit);
          },
        },
        h(
          "div",
          { class: "editor-layout" },
          h(
            "aside",
            { class: "panel form-stack editor-details" },
            h("h2", { class: "section-title" }, "Document details"),
            h(
              "label",
              { class: "field" },
              h("span", {}, "Title"),
              h("input", {
                id: "document-edit-title",
                maxlength: 160,
                value: edit.title,
                oninput: (event) => {
                  edit.title = (event.target as HTMLInputElement).value;
                },
              }),
            ),
            h(
              "label",
              { class: "check-row" },
              h("input", {
                type: "checkbox",
                checked: edit.reviewed,
                onchange: (event) => {
                  edit.reviewed = (event.target as HTMLInputElement).checked;
                },
              }),
              h(
                "span",
                {},
                h("strong", {}, "Mark this revision as reviewed"),
                h(
                  "small",
                  {},
                  "Confirms that you have checked the complete document.",
                ),
              ),
            ),
            h(
              "label",
              { class: "check-row" },
              h("input", {
                type: "checkbox",
                checked: edit.includeSignature,
                disabled: !hasSignature,
                onchange: (event) => {
                  edit.includeSignature = (
                    event.target as HTMLInputElement
                  ).checked;
                },
              }),
              h(
                "span",
                {},
                h("strong", {}, "Include clinician signature"),
                h(
                  "small",
                  {},
                  hasSignature
                    ? "Saved locally with a reviewed revision."
                    : "Add a signature in Settings before selecting this.",
                ),
              ),
            ),
          ),
          h(
            "section",
            { class: "form-stack", "aria-label": "Document content" },
            h("h2", { class: "section-title" }, "Document content"),
            this.documentEditor.element,
          ),
        ),
        h(
          "div",
          { class: "form-actions form-actions--split" },
          h(
            "button",
            {
              type: "button",
              class: "button",
              onclick: () =>
                void this.navigate({
                  name: "patient",
                  patientId: patient.id,
                  tab: "documents",
                }),
            },
            "Cancel",
          ),
          h(
            "div",
            { class: "page-actions" },
            h("button", { type: "submit", class: "button" }, "Save changes"),
            h(
              "button",
              {
                type: "button",
                class: "button button--primary",
                "data-save-export-document": true,
                onclick: () => void this.saveEditedDocument(edit, true),
              },
              "Save & export PDF",
            ),
          ),
        ),
      ),
    ];
  }

  private async saveEditedDocument(
    edit: DocumentEdit,
    exportPdf = false,
  ): Promise<void> {
    const saved = await this.perform("Saving document…", () =>
      this.bridge.call<PatientDocument>("update_patient_document", {
        id: edit.document.id,
        title: edit.title,
        body: markdownToDocumentBody(edit.markdown),
        reviewed: edit.reviewed,
        includeSignature: edit.includeSignature,
      }),
    );
    if (saved && this.patient) {
      const exported = exportPdf
        ? await this.exportDocumentPdf(saved.id)
        : undefined;
      const patientId = this.patient.id;
      this.documentEdit = null;
      await this.show(
        { name: "patient", patientId, tab: "documents" },
        {
          flash:
            exported === true
              ? "Document updated and PDF exported."
              : exported === false
                ? "Document updated. PDF export cancelled."
                : "Document updated.",
        },
      );
    } else this.render();
  }

  private async exportDocumentPdf(id: number): Promise<boolean | undefined> {
    return await this.perform("Exporting PDF…", () =>
      this.bridge.call<boolean>("export_patient_document_pdf", { id }),
    );
  }

  private newDocumentScreen(): Node[] {
    if (this.preparedDocument) return this.documentSubmissionScreen();
    const patient = this.patient;
    if (!patient) return this.patientsScreen();
    const selected = this.documentDraft.noteIds.size;
    const enabled =
      this.documentDraft.title.trim().length > 0 &&
      this.documentDraft.templateId > 0 &&
      selected > 0 &&
      !!this.documentSettings?.models?.some(
        (model) => model.id === this.documentDraft.model,
      );
    return [
      breadcrumb([
        {
          label: "Patients",
          onSelect: () => void this.navigate({ name: "patients" }),
        },
        {
          label: patient.name,
          onSelect: () =>
            void this.navigate({
              name: "patient",
              patientId: patient.id,
              tab: "documents",
            }),
        },
        { label: "Documents" },
        { label: "New document" },
      ]),
      h(
        "section",
        { class: "patient-ribbon" },
        pageHeader({
          eyebrow: "Patient document",
          title: ["New document"],
          id: "new-document-title",
          description: `${patient.name}${patient.patientReference ? ` · Patient number ${patient.patientReference}` : ""}`,
        }),
      ),
      this.errorNotice(),
      h(
        "ol",
        { class: "workflow-steps", "aria-label": "Document progress" },
        h("li", { "aria-current": "step" }, "Choose notes"),
        h("li", {}, "Review submission"),
        h("li", {}, "Review document"),
      ),
      h(
        "form",
        {
          class: "form-stack document-create",
          onsubmit: (event: Event) => {
            event.preventDefault();
            if (
              this.documentDraft.title.trim() &&
              this.documentDraft.noteIds.size &&
              this.documentDraft.templateId &&
              this.documentDraft.model
            )
              void this.reviewDocumentSubmission();
          },
        },
        h(
          "label",
          { class: "field" },
          h("span", {}, "Document title"),
          h("input", {
            id: "document-title",
            value: this.documentDraft.title,
            maxlength: "160",
            oninput: (event: Event) => {
              this.documentDraft.title = (
                event.target as HTMLInputElement
              ).value;
              this.updateDocumentChoices();
            },
          }),
        ),
        h(
          "label",
          { class: "field" },
          h("span", {}, "Template"),
          h(
            "select",
            {
              value: String(this.documentDraft.templateId),
              onchange: (event: Event) => {
                this.documentDraft.templateId = Number(
                  (event.target as HTMLSelectElement).value,
                );
              },
            },
            ...this.templates.map((template) =>
              h(
                "option",
                {
                  value: String(template.id),
                  selected: template.id === this.documentDraft.templateId,
                },
                template.name,
              ),
            ),
          ),
        ),
        h(
          "label",
          { class: "field" },
          h("span", {}, "Model"),
          modelSelect(
            this.documentSettings?.models ?? [],
            this.documentDraft.model,
            "document-model",
            (event) => {
              this.documentDraft.model = (
                event.target as HTMLSelectElement
              ).value;
              this.updateDocumentChoices();
            },
          ),
          h(
            "span",
            { class: "hint", "data-model-prices": true },
            this.documentModelPrices(),
          ),
          h(
            "span",
            { class: "hint", "data-model-hint": true },
            this.documentDraft.model === this.documentSettings?.openaiModel
              ? "Using your Settings default. Changing this selection affects only this document."
              : "Override for this document only.",
          ),
        ),
        h(
          "p",
          { class: "muted" },
          "Estimated generation cost appears during submission review, before anything is sent.",
        ),
        h(
          "fieldset",
          { class: "choice-list" },
          h("legend", { class: "section-title" }, "Select notes"),
          ...this.notes.map((note) =>
            h(
              "label",
              { class: "choice-row" },
              h("input", {
                type: "checkbox",
                checked: this.documentDraft.noteIds.has(note.id),
                onchange: (event: Event) => {
                  if ((event.target as HTMLInputElement).checked)
                    this.documentDraft.noteIds.add(note.id);
                  else this.documentDraft.noteIds.delete(note.id);
                  this.updateDocumentChoices();
                },
              }),
              h("span", {}, note.title),
              h("span", { class: "mono muted" }, formatDate(note.createdAt)),
            ),
          ),
        ),
        h(
          "p",
          { class: "meta muted", "data-selected-notes": true },
          `${plural(selected, "note")} selected · Ordered oldest first`,
        ),
        !this.documentSettings?.clinicalSendingEnabled &&
          h(
            "p",
            { class: "notice" },
            h("strong", {}, "Clinical sending is not enabled. "),
            "You can choose notes and inspect the workflow, but no clinical material can leave this Mac until the information-governance setup requirements are recorded.",
          ),
        h(
          "div",
          { class: "form-actions form-actions--split" },
          h(
            "button",
            {
              type: "button",
              class: "button",
              onclick: () =>
                void this.navigate({
                  name: "patient",
                  patientId: patient.id,
                  tab: "documents",
                }),
            },
            "Cancel",
          ),
          h(
            "button",
            {
              type: "submit",
              class: "button button--primary",
              disabled: !enabled,
              "data-review-submission": true,
            },
            "Review submission",
          ),
        ),
      ),
    ];
  }

  private documentModelPrices(): string {
    const model = this.documentSettings?.models?.find(
      (item) => item.id === this.documentDraft.model,
    );
    return model ? modelPrices(model) : "";
  }

  private updateDocumentChoices(): void {
    const prices = this.root.querySelector("[data-model-prices]");
    if (prices) prices.textContent = this.documentModelPrices();
    const submit = this.root.querySelector<HTMLButtonElement>(
      "[data-review-submission]",
    );
    if (submit)
      submit.disabled =
        !this.documentDraft.title.trim() ||
        !this.documentDraft.templateId ||
        !this.documentDraft.noteIds.size ||
        !this.documentSettings?.models?.some(
          (model) => model.id === this.documentDraft.model,
        );
    const count = this.root.querySelector("[data-selected-notes]");
    if (count)
      count.textContent = `${plural(this.documentDraft.noteIds.size, "note")} selected · Ordered oldest first`;
    const hint = this.root.querySelector("[data-model-hint]");
    if (hint)
      hint.textContent =
        this.documentDraft.model === this.documentSettings?.openaiModel
          ? "Using your Settings default. Changing this selection affects only this document."
          : "Override for this document only.";
  }

  private async reviewDocumentSubmission(): Promise<void> {
    const prepared = await this.perform("Preparing reviewed submission…", () =>
      this.bridge.call<PreparedDocumentSubmission>(
        "prepare_document_submission",
        {
          patientId: this.patient?.id,
          templateId: this.documentDraft.templateId,
          noteIds: [...this.documentDraft.noteIds],
          model: this.documentDraft.model,
          title: this.documentDraft.title,
          documentId: this.documentId,
        },
      ),
    );
    if (prepared) {
      this.preparedDocument = prepared;
      this.documentId = prepared.documentId;
    }
    this.focusTarget = prepared ? "h1" : "[data-error]";
    this.render();
  }

  private documentSubmissionScreen(): Node[] {
    const prepared = this.preparedDocument!;
    const generated = this.generatedDocument;
    if (generated)
      this.documentEditor = markdownEditor(
        generated.text,
        (value) => {
          generated.text = value;
        },
        { document: true },
      );
    const model = this.documentSettings?.models?.find(
      (model) => model.id === prepared.model,
    );
    return [
      pageHeader({
        eyebrow: "Patient document",
        title: [this.documentDraft.title],
        description: generated
          ? "Generated draft · Review before saving"
          : "Review submission",
      }),
      this.errorNotice(),
      h(
        "p",
        { class: "notice" },
        `OpenAI · ${model?.name ?? prepared.model} · ${prepared.destination}`,
      ),
      generated
        ? h(
            "section",
            { class: "form-stack" },
            h(
              "div",
              { class: "editor-layout" },
              h(
                "aside",
                { class: "panel form-stack editor-details" },
                h("h2", { class: "section-title" }, "Document details"),
                h(
                  "p",
                  { class: "muted" },
                  `Latest generation: ${generated.usage.latestCostNanos === null ? "Cost unknown" : usd(generated.usage.latestCostNanos)} · Total for this report: ${usd(generated.usage.knownCostNanos)}${generated.usage.unknownCostAttempts ? " + unknown costs" : ""}`,
                ),
                h(
                  "label",
                  { class: "check-row" },
                  h("input", {
                    type: "checkbox",
                    "data-generated-signature": true,
                    checked: this.generatedIncludeSignature,
                    disabled: !this.documentSettings?.hasSignature,
                    onchange: (event) => {
                      this.generatedIncludeSignature = (
                        event.target as HTMLInputElement
                      ).checked;
                    },
                  }),
                  h(
                    "span",
                    {},
                    h("strong", {}, "Include clinician signature"),
                    h(
                      "small",
                      {},
                      this.documentSettings?.hasSignature
                        ? "The saved signature is added locally."
                        : "Add a signature in Settings before selecting this.",
                    ),
                  ),
                ),
                h(
                  "p",
                  { class: "hint" },
                  `${generated.exactReplacements} exact replacements restored on this Mac. This is a draft for your review.`,
                ),
              ),
              h(
                "section",
                { class: "form-stack", "aria-label": "Document content" },
                h("h2", { class: "section-title" }, "Document text"),
                this.documentEditor!.element,
              ),
            ),
            h(
              "div",
              { class: "form-actions" },
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  "data-save-generated": true,
                  onclick: () => void this.saveGeneratedDraft(false),
                },
                "Save draft",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "button button--primary",
                  "data-export-generated": true,
                  onclick: () => void this.saveGeneratedDraft(true),
                },
                "Save draft & export PDF",
              ),
            ),
          )
        : h(
            "section",
            { class: "form-stack" },
            h(
              "p",
              { class: "meta" },
              `Estimated generation allowance: ${usd(prepared.estimate.costNanos)}`,
            ),
            h(
              "p",
              { class: "hint" },
              `Calculated on this Mac using a conservative input allowance and up to ${prepared.estimate.outputTokenAllowance.toLocaleString()} output tokens, without cache discounts. This is an estimate, not a billing quote.`,
            ),
            h(
              "div",
              { class: "submission-review-grid" },
              h(
                "section",
                {
                  class: "submission-review-panel",
                  "aria-labelledby": "submission-instructions-title",
                },
                h(
                  "header",
                  { class: "submission-review-panel__header" },
                  h("p", { class: "eyebrow" }, "Document prompt template"),
                  h(
                    "h2",
                    { id: "submission-instructions-title" },
                    "Instructions to OpenAI",
                  ),
                ),
                this.submissionInstructions(prepared.instructions),
              ),
              h(
                "section",
                {
                  class: "submission-review-panel",
                  "aria-labelledby": "submission-notes-title",
                },
                h(
                  "header",
                  { class: "submission-review-panel__header" },
                  h("p", { class: "eyebrow" }, "Reviewed source material"),
                  h(
                    "h2",
                    { id: "submission-notes-title" },
                    `${plural(prepared.reviewNotes.length, "note")} to OpenAI`,
                  ),
                ),
                h(
                  "div",
                  { class: "submission-notes" },
                  ...prepared.reviewNotes.map((note, index) =>
                    h(
                      "article",
                      {
                        class: "submission-note",
                        "data-review-note": note.id,
                      },
                      h(
                        "header",
                        { class: "submission-note__header" },
                        h("h3", {}, `${index + 1}. ${note.title}`),
                        h(
                          "span",
                          { class: "mono muted" },
                          formatDate(note.createdAt),
                        ),
                      ),
                      h(
                        "div",
                        { class: "submission-note__text" },
                        ...this.reviewedNoteText(note.reviewedText),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            h(
              "details",
              { class: "submission-payload" },
              h("summary", {}, "View exact request payload"),
              h(
                "p",
                { class: "hint" },
                "The readable notes above use the saved redaction labels. The exact request uses one-time tokens so each redacted item can be restored to the correct place on this Mac.",
              ),
              h("h3", {}, "Instructions"),
              h("pre", { class: "pane" }, prepared.instructions),
              h("h3", {}, "Notes"),
              h("pre", { class: "pane" }, prepared.input),
            ),
            h(
              "button",
              {
                type: "button",
                class: "button button--primary",
                "data-send-document": true,
                onclick: () => void this.generateDocument(),
              },
              "Send to OpenAI and generate",
            ),
          ),
      h(
        "button",
        {
          type: "button",
          class: "button",
          onclick: () => {
            if (generated) this.requestLeave("regenerate");
            else {
              this.preparedDocument = null;
              this.render();
            }
          },
        },
        generated ? "Prepare another generation" : "Change selection",
      ),
    ].filter((node): node is HTMLElement => node !== null);
  }

  private submissionInstructions(instructions: string): HTMLElement {
    const marker = "\n\nDocument prompt template:\n";
    const markerAt = instructions.indexOf(marker);
    if (markerAt < 0) return renderMarkdown(instructions);
    const rules = instructions.slice(0, markerAt);
    const template = instructions.slice(markerAt + marker.length);
    return h(
      "div",
      { class: "submission-instructions" },
      h("h3", {}, "Generation rules"),
      h("p", {}, rules),
      h("h3", {}, "Template instructions"),
      renderMarkdown(template),
    );
  }

  private reviewedNoteText(text: string): HTMLElement[] {
    return text
      .split(/\n{2,}/)
      .map((paragraph) =>
        h(
          "p",
          {},
          ...paragraph
            .split("\n")
            .flatMap((line, index) => [
              ...(index ? [h("br")] : []),
              ...withPlaceholders(line),
            ]),
        ),
      );
  }

  private async generateDocument(): Promise<void> {
    const prepared = this.preparedDocument;
    if (!prepared) return;
    const generated = await this.perform(
      "Sending to OpenAI…",
      () =>
        this.bridge.call<GeneratedDocument>("submit_document_generation", {
          operation: this.operation,
          preparationId: prepared.id,
        }),
      "generation",
    );
    if (generated) {
      this.generatedDocument = generated;
      this.generatedIncludeSignature = false;
    } else this.preparedDocument = null; // A consumed approval can never be retried.
    this.render();
  }

  private async saveGeneratedDraft(exportPdf: boolean): Promise<void> {
    const generated = this.generatedDocument;
    if (!generated) return;
    const saved = await this.perform("Saving document draft…", () =>
      this.bridge.call<PatientDocument>("save_patient_document", {
        id: generated.documentId,
        patientId: this.patient?.id,
        title: this.documentDraft.title,
        templateId: this.documentDraft.templateId,
        reviewed: false,
        includeSignature: this.generatedIncludeSignature,
        sourceNoteIds: [...this.documentDraft.noteIds],
        body: markdownToDocumentBody(generated.text),
      }),
    );
    if (saved && this.patient) {
      const exported = exportPdf
        ? await this.exportDocumentPdf(saved.id)
        : undefined;
      this.generatedDocument = null;
      this.preparedDocument = null;
      await this.show(
        { name: "patient", patientId: this.patient.id, tab: "documents" },
        {
          flash:
            exported === true
              ? "Document draft saved and PDF exported."
              : exported === false
                ? "Document draft saved. PDF export cancelled."
                : "Document draft saved.",
        },
      );
    } else this.render();
  }

  // Document prompt templates ----------------------------------------------

  private templatesScreen(): Node[] {
    const filtered = this.templates.filter((template) =>
      `${template.name} ${template.description}`
        .toLocaleLowerCase()
        .includes(this.templateQuery.toLocaleLowerCase()),
    );
    if (this.templateEdit)
      return [
        pageHeader({
          eyebrow: "Document prompt templates",
          title: [this.templateEdit.id ? "Edit template" : "New template"],
          id: "template-title",
          description:
            "Set the document details on the left and write its instructions on the right.",
        }),
        this.errorNotice(),
        this.templateForm(this.templateEdit),
      ].filter((node): node is HTMLElement => node !== null);
    return [
      pageHeader({
        eyebrow: "Global instructions",
        title: ["Document prompt templates"],
        id: "templates-title",
        description:
          "Instructions available for every patient. Editing a template does not change existing documents.",
        actions: [
          h(
            "button",
            {
              type: "button",
              class: "button button--primary",
              "data-new-template": true,
              onclick: () => {
                this.templateEdit = {
                  name: "",
                  description: "",
                  instructions: "",
                };
                this.focusTarget = "#template-name";
                this.render();
              },
            },
            "New template",
          ),
        ],
      }),
      this.errorNotice(),
      this.flashNotice(),
      h(
        "section",
        {},
        toolbar(
          searchForm({
            label: "Search templates",
            placeholder: "Search templates",
            value: this.templateQuery,
            onSearch: (value) => {
              this.templateQuery = value;
              this.render();
            },
          }),
          searchStatus({
            shown: filtered.length,
            total: this.templates.length,
            noun: "template",
            query: this.templateQuery,
            onClear: () => {
              this.templateQuery = "";
              this.render();
            },
          }),
        ),
        dataTable(
          [
            { label: "Name" },
            { label: "Description" },
            { label: "Status" },
            { label: "Actions", hidden: true },
          ],
          filtered.map((template) =>
            h(
              "tr",
              {},
              h("td", {}, template.name),
              h("td", {}, template.description),
              h("td", {}, template.archived ? "Archived" : "Available"),
              h(
                "td",
                { class: "actions" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "link-button",
                    onclick: () => {
                      this.templateEdit = {
                        id: template.id,
                        name: template.name,
                        description: template.description,
                        instructions: template.instructions,
                      };
                      this.render();
                    },
                  },
                  "Edit",
                ),
                " · ",
                h(
                  "button",
                  {
                    type: "button",
                    class: "link-button",
                    onclick: () => void this.duplicateTemplate(template.id),
                  },
                  "Duplicate",
                ),
                " · ",
                h(
                  "button",
                  {
                    type: "button",
                    class: "link-button",
                    onclick: () => void this.archiveTemplate(template),
                  },
                  template.archived ? "Restore" : "Archive",
                ),
              ),
            ),
          ),
        ),
      ),
    ].filter((node): node is HTMLElement => Boolean(node));
  }

  private templateForm(edit: TemplateEdit): HTMLElement {
    this.templateEditor = markdownEditor(edit.instructions, (value) => {
      edit.instructions = value;
    });
    const field = (
      label: string,
      value: string,
      update: (value: string) => void,
    ) =>
      h(
        "label",
        { class: "field" },
        h("span", {}, label),
        h("input", {
          id: label === "Name" ? "template-name" : "template-description",
          value,
          oninput: (event) => update((event.target as HTMLInputElement).value),
        }),
      );
    return h(
      "form",
      {
        class: "template-form",
        onsubmit: (event) => {
          event.preventDefault();
          void this.saveTemplate(edit);
        },
      },
      h(
        "div",
        { class: "editor-layout" },
        h(
          "aside",
          { class: "panel form-stack editor-details" },
          h("h2", { class: "section-title" }, "Template details"),
          field("Name", edit.name, (value) => {
            edit.name = value;
          }),
          field("Description", edit.description, (value) => {
            edit.description = value;
          }),
          h(
            "p",
            { class: "hint" },
            "Available for every patient. Changes apply to future documents.",
          ),
        ),
        h(
          "section",
          { class: "form-stack", "aria-label": "Template instructions" },
          h("h2", { class: "section-title" }, "Instructions"),
          this.templateEditor.element,
        ),
      ),
      h(
        "div",
        { class: "form-actions form-actions--split" },
        h(
          "button",
          {
            type: "button",
            class: "button",
            onclick: () => {
              if (this.hasUnsavedConfiguration())
                this.requestLeave({ name: "templates" });
              else {
                this.templateEdit = null;
                this.render();
              }
            },
          },
          "Cancel",
        ),
        h(
          "button",
          { type: "submit", class: "button button--primary" },
          edit.id ? "Save changes" : "Create template",
        ),
      ),
    );
  }

  private async saveTemplate(edit: TemplateEdit): Promise<void> {
    const command = edit.id
      ? "update_document_template"
      : "create_document_template";
    const result = await this.perform("Saving document prompt template…", () =>
      this.bridge.call<DocumentTemplate>(command, { ...edit }),
    );
    if (!result) {
      this.render();
      return;
    }
    this.templateEdit = null;
    await this.load({ name: "templates" });
    this.message = edit.id ? "Template updated." : "Template created.";
    this.render();
  }

  private async duplicateTemplate(id: number): Promise<void> {
    const result = await this.perform("Duplicating template…", () =>
      this.bridge.call<DocumentTemplate>("duplicate_document_template", { id }),
    );
    if (result) {
      await this.load({ name: "templates" });
      this.message = "Template duplicated.";
    }
    this.render();
  }

  private async archiveTemplate(template: DocumentTemplate): Promise<void> {
    const result = await this.perform(
      template.archived ? "Restoring template…" : "Archiving template…",
      () =>
        this.bridge.call<DocumentTemplate>("set_document_template_archived", {
          id: template.id,
          archived: !template.archived,
        }),
    );
    if (result) {
      await this.load({ name: "templates" });
      this.message = template.archived
        ? "Template restored."
        : "Template archived.";
    }
    this.render();
  }

  // Redactions --------------------------------------------------------------

  private patientRedactionsTab(patient: PatientView): Node[] {
    const overrides = new Set(this.mappings.map(redactionKey));
    return [
      h(
        "p",
        { class: "notice" },
        `Applied automatically to new notes for ${patient.name}. These take precedence over the `,
        h(
          "button",
          {
            type: "button",
            class: "link-button",
            "data-all-redactions": true,
            onclick: () => void this.navigate({ name: "redactions" }),
          },
          plural(this.mappings.length, "all-patients redaction"),
        ),
        ", which also apply.",
      ),
      ...this.redactionList(
        this.patientMappings,
        "patient",
        overrides,
        "While you review a note for this patient, choose to save a replacement and it will appear here.",
      ),
    ];
  }
  private redactionsScreen(): Node[] {
    return [
      pageHeader({
        eyebrow: "Reusable defaults",
        title: ["Redactions"],
        id: "redactions-title",
        description:
          "Applied automatically to new notes for every patient. A patient’s own redactions take precedence.",
      }),
      this.errorNotice(),
      this.flashNotice(),
      ...this.redactionList(
        this.mappings,
        "global",
        new Set(),
        "While you review a note, choose to save a replacement for all patients and it will appear here.",
      ),
    ].filter((node): node is HTMLElement => node !== null);
  }
  /** Redactions are created during review and are never deleted here; the
   * only change is the replacement text. */
  private redactionList(
    mappings: MappingView[],
    scope: RedactionEdit["scope"],
    overrides: Set<string>,
    emptyText: string,
  ): Node[] {
    if (!mappings.length) return [emptyState("No redactions yet", emptyText)];
    const query = this.redactionQuery.toLowerCase();
    const shown = mappings.filter((mapping) =>
      `${mapping.phrase} ${mapping.replacement}`.toLowerCase().includes(query),
    );
    const rows = shown.map((mapping) => {
      const identifier = h(
        "td",
        {},
        h("strong", {}, mapping.phrase),
        overrides.has(redactionKey(mapping)) && " ",
        overrides.has(redactionKey(mapping)) &&
          h("span", { class: "badge" }, "Overrides all-patients"),
      );
      const category = h(
        "td",
        { class: "hide-narrow" },
        categoryLabel(mapping.category),
      );
      const updated = h("td", { class: "mono" }, formatDate(mapping.updatedAt));
      const edit = this.editing;
      if (edit?.scope === scope && edit.id === mapping.id) {
        const input = h("input", {
          id: "redaction-edit",
          class: "mono inline-input",
          "data-redaction-input": true,
          "data-select-on-focus": "true",
          value: edit.value,
          spellcheck: "false",
          autocomplete: "off",
          autocapitalize: "characters",
          "aria-invalid": String(Boolean(edit.error)),
          "aria-describedby": "redaction-edit-error",
          oninput: (event: Event) => {
            edit.value = (event.target as HTMLInputElement).value;
          },
          onkeydown: (event: Event) => {
            if ((event as KeyboardEvent).key !== "Enter") return;
            event.preventDefault();
            void this.saveRedaction(mapping);
          },
        });
        return h(
          "tr",
          { class: "edit-row" },
          identifier,
          h(
            "td",
            {},
            h(
              "label",
              { class: "visually-hidden", for: "redaction-edit" },
              `Replace ${mapping.phrase} with`,
            ),
            input,
            h(
              "span",
              {
                class: "error",
                id: "redaction-edit-error",
                role: "alert",
                hidden: !edit.error,
              },
              edit.error,
            ),
          ),
          category,
          updated,
          h(
            "td",
            { class: "actions" },
            h(
              "button",
              {
                type: "button",
                class: "button button--compact button--quiet",
                "data-cancel-edit": true,
                onclick: () => this.cancelEdit(),
              },
              "Cancel",
            ),
            " ",
            h(
              "button",
              {
                type: "button",
                class: "button button--compact",
                "data-save-redaction": true,
                onclick: () => void this.saveRedaction(mapping),
              },
              "Save",
            ),
          ),
        );
      }
      return h(
        "tr",
        {},
        identifier,
        h("td", {}, h("span", { class: "placeholder" }, mapping.replacement)),
        category,
        updated,
        h(
          "td",
          { class: "actions" },
          h(
            "button",
            {
              type: "button",
              class: "button button--compact",
              "data-edit-redaction": mapping.id,
              disabled: this.busy,
              onclick: () => this.startEdit(scope, mapping),
            },
            "Edit",
          ),
        ),
      );
    });
    return [
      toolbar(
        searchForm({
          label: "Search redactions",
          placeholder: "Search identifiers and replacements",
          value: this.redactionQuery,
          onSearch: (value) => {
            this.redactionQuery = value;
            this.editing = null;
            this.focusTarget = "#search";
            this.render();
          },
        }),
        searchStatus({
          shown: shown.length,
          total: mappings.length,
          noun: "redaction",
          query: this.redactionQuery,
          onClear: () => {
            this.redactionQuery = "";
            this.focusTarget = "#search";
            this.render();
          },
        }),
      ),
      dataTable(
        [
          { label: "Identifier" },
          { label: "Replaced with" },
          { label: "Category", narrow: true },
          { label: "Updated" },
          { label: "Actions", hidden: true },
        ],
        rows.length
          ? rows
          : [
              h(
                "tr",
                {},
                h(
                  "td",
                  { colspan: 5, class: "muted" },
                  `No redactions match “${this.redactionQuery}”.`,
                ),
              ),
            ],
      ),
    ];
  }
  private startEdit(scope: RedactionEdit["scope"], mapping: MappingView): void {
    if (this.busy) return;
    this.editing = {
      scope,
      id: mapping.id,
      value: mapping.replacement,
      error: "",
    };
    this.restoreFocus = `[data-edit-redaction="${mapping.id}"]`;
    this.focusTarget = "#redaction-edit";
    this.message = "";
    this.render();
  }
  private cancelEdit(): void {
    this.editing = null;
    this.focusTarget = this.restoreFocus;
    this.render();
  }
  private async saveRedaction(mapping: MappingView): Promise<void> {
    const edit = this.editing;
    if (!edit || this.busy) return;
    const replacement = normalisePlaceholder(edit.value, mapping.replacement);
    const error = placeholderError(replacement);
    edit.value = replacement;
    if (error) {
      edit.error = error;
      this.focusTarget = "#redaction-edit";
      this.render();
      return;
    }
    const result = await this.perform("Saving redaction…", () =>
      edit.scope === "patient"
        ? this.bridge.call<MappingView>("update_patient_mapping", {
            patientId: this.patient!.id,
            id: mapping.id,
            replacement,
          })
        : this.bridge.call<MappingView>("update_mapping", {
            id: mapping.id,
            replacement,
          }),
    );
    if (result) {
      const replace = (list: MappingView[]) =>
        list.map((item) => (item.id === result.id ? result : item));
      if (edit.scope === "patient")
        this.patientMappings = replace(this.patientMappings);
      else this.mappings = replace(this.mappings);
      this.editing = null;
      this.message = "Redaction updated.";
      this.focusTarget = this.restoreFocus;
    } else {
      edit.error = this.error;
      this.error = "";
      this.focusTarget = "#redaction-edit";
    }
    this.render();
  }

  // Settings ----------------------------------------------------------------

  private settingsScreen(): Node[] {
    const installed = this.model?.installed === true;
    const status = !this.bridge.available
      ? "Open the macOS app to manage the local model."
      : installed
        ? `${this.model!.name} · ${this.model!.revision} · installed`
        : "The local model is not installed.";
    const controls =
      this.confirming === "model"
        ? h(
            "div",
            { class: "notice notice--danger confirm", role: "alert" },
            h(
              "div",
              {},
              h("strong", {}, "Remove the local detection model?"),
              " You can download the pinned model again later.",
            ),
            h(
              "div",
              { class: "page-actions" },
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  "data-cancel-confirm": true,
                  onclick: () => this.cancelConfirm(),
                },
                "Cancel",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "button button--danger",
                  "data-confirm-remove-model": true,
                  onclick: () => void this.removeModel(),
                },
                "Remove model",
              ),
            ),
          )
        : h(
            "div",
            { class: "page-actions" },
            h(
              "button",
              {
                type: "button",
                class: "button",
                "data-settings-install": true,
                disabled: this.busy || !this.bridge.available,
                onclick: () => void this.install(),
              },
              installed ? "Verify model" : "Download model",
            ),
            installed &&
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  "data-settings-replace": true,
                  onclick: () => void this.replaceModel(),
                },
                "Replace model",
              ),
            installed &&
              h(
                "button",
                {
                  type: "button",
                  class: "button button--danger-quiet",
                  "data-settings-remove": true,
                  "data-confirm-trigger": "model",
                  onclick: () =>
                    this.startConfirm("model", "[data-settings-remove]"),
                },
                "Remove model…",
              ),
          );
    return [
      pageHeader({
        eyebrow: "Local configuration",
        title: ["Settings"],
        id: "settings-title",
        description:
          "Manage document generation, your clinician details, signature and local model.",
      }),
      this.errorNotice(),
      this.flashNotice(),
      h(
        "section",
        { class: "panel", "aria-labelledby": "model-title" },
        h(
          "div",
          {},
          h(
            "h2",
            { class: "section-title", id: "model-title" },
            "Local detection model",
          ),
          h("p", { class: "muted", "data-settings-model": true }, status),
        ),
        controls,
      ),
      this.documentSettingsForm(),
      h(
        "section",
        { class: "panel form-stack", "aria-label": "Usage and costs" },
        h("h2", { class: "section-title" }, "Usage and costs"),
        h(
          "label",
          { class: "field" },
          h("span", {}, "Period"),
          h(
            "select",
            {
              "data-usage-period": true,
              onchange: (event) => {
                this.usagePeriod = (event.target as HTMLSelectElement).value as
                  | "month"
                  | "all";
                void this.refreshUsage();
              },
            },
            h(
              "option",
              { value: "month", selected: this.usagePeriod === "month" },
              "This month",
            ),
            h(
              "option",
              { value: "all", selected: this.usagePeriod === "all" },
              "All time",
            ),
          ),
        ),
        this.usage
          ? usageTable(this.usage)
          : h(
              "p",
              { class: "muted" },
              "Usage unavailable. Reopen Settings to retry.",
            ),
      ),
    ].filter((node): node is HTMLElement => node !== null);
  }
  private documentSettingsForm(): HTMLElement {
    const settings = this.documentSettings;
    const value = (name: string, fallback: string) =>
      this.settingsDraft?.[name] ?? fallback;
    const field = (label: string, name: string, fallback: string) =>
      h(
        "label",
        { class: "field" },
        h("span", {}, label),
        h("input", { name, value: value(name, fallback) }),
      );
    const models = settings?.models ?? [];
    const selected = value("model", settings?.openaiModel ?? "");
    const pricing = h("p", { class: "hint", "data-model-pricing": true });
    const updatePricing = (id: string) => {
      const model = models.find((model) => model.id === id);
      pricing.textContent = model
        ? `${modelPrices(model)}. Prices checked ${model.pricingCheckedAt}.`
        : "Select a supported model to see its prices.";
    };
    updatePricing(selected);
    return h(
      "form",
      {
        class: "form-stack settings-documents",
        "data-document-settings": true,
        onsubmit: (event) => {
          event.preventDefault();
          void this.saveDocumentSettings(
            event.currentTarget as HTMLFormElement,
          );
        },
      },
      h(
        "section",
        { class: "panel settings-section", "aria-labelledby": "openai-title" },
        h(
          "div",
          { class: "settings-section__intro" },
          h(
            "h2",
            { class: "section-title", id: "openai-title" },
            "OpenAI connection",
          ),
          h("p", { class: "muted" }, "Keep a provider key in macOS Keychain."),
        ),
        h(
          "div",
          { class: "form-stack" },
          h(
            "label",
            { class: "field field--wide" },
            h("span", {}, "OpenAI API key"),
            h("input", {
              name: "apiKey",
              type: "password",
              autocomplete: "off",
              spellcheck: false,
              value: value("apiKey", ""),
              placeholder: settings?.apiKeyConfigured
                ? "Enter a replacement key"
                : "Enter API key",
              oninput: () => this.updateGovernanceButton(),
            }),
            h(
              "span",
              { class: "hint" },
              settings?.apiKeyConfigured
                ? "Key saved. Leave blank to keep it."
                : "Not configured.",
            ),
          ),
          h(
            "div",
            { class: "page-actions" },
            settings?.apiKeyConfigured &&
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  onclick: () => void this.testOpenAIConnection(),
                },
                "Test connection",
              ),
            settings?.apiKeyConfigured &&
              h(
                "button",
                {
                  type: "button",
                  class: "button button--danger-quiet",
                  onclick: () => void this.removeOpenAIKey(),
                },
                "Remove key",
              ),
          ),
          h(
            "p",
            { class: "notice" },
            h("strong", {}, "Clinical sending: "),
            settings?.clinicalSendingEnabled
              ? "Enabled for the approved configuration."
              : "Not enabled — setup requirements outstanding.",
            " Saving a key does not enable submissions.",
          ),
        ),
      ),
      h(
        "section",
        {
          class: "panel settings-section",
          "aria-labelledby": "clinical-sending-title",
        },
        h(
          "div",
          { class: "settings-section__intro" },
          h(
            "h2",
            { class: "section-title", id: "clinical-sending-title" },
            "Clinical sending",
          ),
          h(
            "p",
            { class: "muted" },
            "Record the governance checks required before a reviewed payload can leave this Mac.",
          ),
        ),
        settings?.clinicalSendingEnabled
          ? h(
              "div",
              { class: "form-stack" },
              h(
                "p",
                { class: "notice" },
                h("strong", {}, "Enabled for the recorded configuration. "),
                "Every document still requires submission review and a fresh send action.",
              ),
              h(
                "div",
                { class: "page-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "button button--danger-quiet",
                    "data-disable-clinical-sending": true,
                    onclick: () => void this.setClinicalSendingEnabled(false),
                  },
                  "Disable clinical sending",
                ),
              ),
            )
          : h(
              "div",
              { class: "form-stack" },
              h(
                "p",
                { class: "hint" },
                settings?.apiKeyConfigured
                  ? "Confirm each requirement for the saved key, endpoint and default model."
                  : "Save an OpenAI API key before recording these confirmations.",
              ),
              h(
                "fieldset",
                { class: "choice-list governance-checklist" },
                h(
                  "legend",
                  { class: "visually-hidden" },
                  "Governance confirmations",
                ),
                ...[
                  [
                    "organisationalApproval",
                    "My organisation has approved OpenAI for this document-generation use case.",
                  ],
                  [
                    "providerTermsReviewed",
                    "I have reviewed the selected model, endpoint and provider terms.",
                  ],
                  [
                    "dataControlsConfirmed",
                    "I have confirmed retention, training use and regional-processing arrangements.",
                  ],
                  [
                    "rollbackPlanConfirmed",
                    "I have an acceptance and rollback plan, and will disable sending if the approved configuration changes.",
                  ],
                ].map(([name, label]) =>
                  h(
                    "label",
                    { class: "choice-row" },
                    h("input", {
                      type: "checkbox",
                      name,
                      "data-governance-check": true,
                      disabled: !settings?.apiKeyConfigured,
                      onchange: () => this.updateGovernanceButton(),
                    }),
                    h("span", {}, label),
                  ),
                ),
              ),
              h(
                "div",
                { class: "page-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "button button--primary",
                    "data-enable-clinical-sending": true,
                    disabled: true,
                    onclick: () => void this.setClinicalSendingEnabled(true),
                  },
                  "Enable clinical sending",
                ),
              ),
            ),
      ),
      h(
        "section",
        {
          class: "panel settings-section",
          "aria-labelledby": "generation-title",
        },
        h(
          "div",
          { class: "settings-section__intro" },
          h(
            "h2",
            { class: "section-title", id: "generation-title" },
            "Document generation",
          ),
          h(
            "p",
            { class: "muted" },
            "Choose a starting model and compare costs.",
          ),
        ),
        h(
          "div",
          { class: "form-stack" },
          h(
            "label",
            { class: "field field--wide" },
            h("span", {}, "Default model"),
            modelSelect(models, selected, "model", (event) => {
              updatePricing((event.target as HTMLSelectElement).value);
              this.updateGovernanceButton();
            }),
            h(
              "span",
              { class: "hint" },
              "Used for new documents. Each document can choose a different model.",
            ),
          ),
          pricing,
          h(
            "p",
            { class: "hint" },
            "Standard rates shown; long context and cache writes can add charges. Model availability depends on your OpenAI project. Compare outputs using synthetic notes before choosing a model.",
          ),
        ),
      ),
      h(
        "section",
        {
          class: "panel settings-section",
          "aria-labelledby": "clinician-title",
        },
        h(
          "div",
          { class: "settings-section__intro" },
          h(
            "h2",
            { class: "section-title", id: "clinician-title" },
            "Clinician details",
          ),
          h("p", { class: "muted" }, "Your details stay on this Mac."),
        ),
        h(
          "div",
          { class: "form-stack" },
          field("Display name", "displayName", settings?.displayName ?? ""),
          field("Role", "role", settings?.role ?? ""),
          field(
            "Qualifications",
            "qualifications",
            settings?.qualifications ?? "",
          ),
          h(
            "label",
            { class: "field field--wide" },
            h("span", {}, "Document header"),
            h(
              "textarea",
              {
                name: "letterHeader",
                rows: 4,
                maxlength: 1000,
                placeholder:
                  "Clinic or service name\nAddress and contact details",
              },
              value("letterHeader", settings?.letterHeader ?? ""),
            ),
            h(
              "span",
              { class: "hint" },
              "Shown at the top of locally exported patient-document PDFs.",
            ),
          ),
        ),
      ),
      h(
        "section",
        {
          class: "panel settings-section",
          "aria-labelledby": "signature-title",
        },
        h(
          "div",
          { class: "settings-section__intro" },
          h(
            "h2",
            { class: "section-title", id: "signature-title" },
            "Clinician signature",
          ),
          h(
            "p",
            { class: "muted" },
            "Draw with a mouse or trackpad, or use a typed signature.",
          ),
        ),
        signaturePad(settings?.signaturePng ?? null, this.signatureDraft),
      ),
      h(
        "div",
        { class: "form-actions" },
        h(
          "button",
          { type: "submit", class: "button button--primary" },
          "Save changes",
        ),
      ),
    );
  }

  private async refreshUsage(): Promise<void> {
    this.usage = null;
    const usage = await this.perform("Loading usage…", () =>
      this.bridge.call<UsageSummary>(
        "document_usage",
        this.usagePeriod === "month" ? monthRange() : {},
      ),
    );
    if (usage) this.usage = usage;
    this.focusTarget = "[data-usage-period]";
    this.render();
  }
  private async saveDocumentSettings(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const apiKey = String(data.get("apiKey") ?? "").trim();
    if (this.signatureDraft.editing && !this.signatureDraft.png) {
      this.error = "Draw or type a signature, or cancel the signature change.";
      this.render();
      return;
    }
    const signature =
      this.signatureDraft.editing && this.signatureDraft.png
        ? Array.from(atob(this.signatureDraft.png), (char) =>
            char.charCodeAt(0),
          )
        : undefined;
    const result = await this.perform("Saving settings…", () =>
      this.bridge.call<DocumentSettings>("save_document_settings", {
        displayName: String(data.get("displayName") ?? ""),
        role: String(data.get("role") ?? ""),
        qualifications: String(data.get("qualifications") ?? ""),
        letterHeader: String(data.get("letterHeader") ?? ""),
        openaiModel: String(data.get("model") ?? ""),
        apiKey: apiKey || undefined,
        signature,
        removeSignature: this.signatureDraft.removed,
      }),
    );
    if (result) {
      this.documentSettings = result;
      this.message = "Changes saved.";
      this.settingsDraft = null;
      this.signatureDraft = emptySignatureDraft();
      this.root.querySelector("[data-document-settings]")?.remove();
    }
    this.render();
  }
  private async removeOpenAIKey(): Promise<void> {
    const result = await this.perform("Removing OpenAI API key…", () =>
      this.bridge.call<DocumentSettings>("remove_openai_api_key"),
    );
    if (result) {
      this.documentSettings = result;
      this.message = "OpenAI API key removed.";
    }
    this.render();
  }
  private async testOpenAIConnection(): Promise<void> {
    const result = await this.perform(
      "Testing OpenAI connection…",
      async () => {
        await this.bridge.call("test_openai_connection");
        return true;
      },
    );
    if (result)
      this.message =
        "OpenAI connection confirmed without sending clinical material.";
    this.render();
  }
  private updateGovernanceButton(): void {
    const checks = [
      ...this.root.querySelectorAll<HTMLInputElement>(
        "[data-governance-check]",
      ),
    ];
    const enable = this.root.querySelector<HTMLButtonElement>(
      "[data-enable-clinical-sending]",
    );
    if (enable)
      enable.disabled =
        !this.documentSettings?.apiKeyConfigured ||
        Boolean(
          this.root.querySelector<HTMLInputElement>('input[name="apiKey"]')
            ?.value,
        ) ||
        this.root.querySelector<HTMLSelectElement>('select[name="model"]')
          ?.value !== this.documentSettings?.openaiModel ||
        checks.length !== 4 ||
        checks.some((check) => !check.checked);
  }
  private async setClinicalSendingEnabled(enabled: boolean): Promise<void> {
    const checked = (name: string) =>
      this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)
        ?.checked ?? false;
    const confirmations = {
      organisationalApproval: checked("organisationalApproval"),
      providerTermsReviewed: checked("providerTermsReviewed"),
      dataControlsConfirmed: checked("dataControlsConfirmed"),
      rollbackPlanConfirmed: checked("rollbackPlanConfirmed"),
    };
    const result = await this.perform(
      enabled ? "Enabling clinical sending…" : "Disabling clinical sending…",
      () =>
        this.bridge.call<DocumentSettings>("set_clinical_sending_enabled", {
          enabled,
          ...confirmations,
        }),
    );
    if (result) {
      this.documentSettings = result;
      this.message = enabled
        ? "Clinical sending enabled for the recorded configuration."
        : "Clinical sending disabled.";
    }
    this.render();
  }
  private async removeModel(): Promise<void> {
    this.confirming = null;
    let removed = false;
    await this.perform(
      "Removing local model…",
      async () => {
        await this.bridge.call("remove_model");
        removed = true;
      },
      "review",
    );
    if (removed) {
      this.model = await this.bridge.call<ModelStatus>("model_status");
      this.message = "Local model removed.";
    }
    this.focusTarget = "[data-settings-install]";
    this.render();
  }

  // Review workspace --------------------------------------------------------

  private renderReviewScreen(main: HTMLElement): void {
    const patient = this.patient;
    main.append(
      breadcrumb([
        {
          label: "Patients",
          onSelect: () => void this.navigate({ name: "patients" }),
        },
        ...(patient
          ? [
              {
                label: patient.name,
                onSelect: () =>
                  void this.navigate({
                    name: "patient",
                    patientId: patient.id,
                    tab: "notes",
                  }),
              },
            ]
          : []),
        { label: this.savedTitle ?? "New note" },
      ]),
    );
    if (this.discarding) main.append(this.discardConfirmation());
    const section = h("section", {
      class: "review-page",
      "aria-labelledby": "review-title",
    });
    section.innerHTML = `
      <header class="page-header"><div><p class="eyebrow" data-review-eyebrow></p><h1 class="page-title" id="review-title" tabindex="-1">De-identify text</h1><p class="muted">Find possible identifiers. Review each change. Keep the wording that matters.</p></div><div class="page-actions"><button type="button" class="button button--quiet" data-discard>Discard</button></div></header>
      <section class="workflow-panel" aria-label="Text review stages"><ol class="stepper">${["Verify model", "Analyse", "Review", "Final check"].map((name, index) => `<li data-step><span class="step-number" data-step-number aria-hidden="true">${index + 1}</span> <span>${name}<span class="visually-hidden" data-step-status></span></span></li>`).join("")}</ol><p class="review-status" role="status" data-status></p><p class="review-error" role="alert" data-error></p></section>
      <aside class="notice model-panel" data-model-panel aria-label="Local detection model"><div><strong data-model-title></strong><p data-model-description></p></div><button type="button" class="button" data-install>Open Settings</button></aside>
      <p class="review-toolbar muted">Source text stays in this session. After the final check, you can save the reviewed note.</p>
      <div data-workspace aria-busy="${this.busy}"></div>
      <aside class="scope-note"><strong>What this check covers</strong><p>Identifier patterns and possible names, places and organisations. Initials, nicknames, misspellings and parts of organisation names can be missed; model proposals can include clinical terms. File paths and indirect identifying combinations are not checked in this version. Review the whole text, including unmarked phrases.</p></aside>`;
    main.append(section);
    this.el<HTMLElement>("[data-review-eyebrow]").textContent = `${
      this.savedTitle ? "Editing note" : "New note"
    } · ${patient?.name ?? "Choose a patient"}`;
    this.bind("[data-discard]", () => this.discardClicked());
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
    const install = this.el<HTMLButtonElement>("[data-install]");
    install.disabled = this.busy || !this.bridge.available || !this.model;
    install.hidden = ready;
    install.onclick = () => void this.navigate({ name: "settings" });
    this.el<HTMLElement>("[data-model-panel]").hidden = ready;
    this.el<HTMLButtonElement>("[data-discard]").disabled = this.busy;
    if (this.session && this.originalDocument) {
      this.el("[data-workspace]").before(this.documentToolbar(false));
    }
    if (this.session) this.renderReview(this.session);
    else this.renderInput(ready);
  }
  private discardConfirmation(): HTMLElement {
    return h(
      "div",
      {
        class: "notice notice--danger confirm discard-confirm",
        role: "alert",
        "data-discard-confirm": true,
      },
      h(
        "div",
        {},
        h(
          "strong",
          {},
          this.generatedDocument
            ? "Discard this generated draft?"
            : this.hasUnsavedConfiguration()
              ? "Discard these changes?"
              : "Discard this session?",
        ),
        this.generatedDocument
          ? " Unsaved document text will be cleared. Generation costs remain in your usage totals."
          : this.hasUnsavedConfiguration()
            ? " Unsaved document, template or settings changes will be cleared."
            : " The imported document, source text and review decisions will be cleared.",
      ),
      h(
        "div",
        { class: "page-actions" },
        h(
          "button",
          {
            type: "button",
            class: "button",
            "data-stay": true,
            onclick: () => this.stay(),
          },
          "Keep reviewing",
        ),
        h(
          "button",
          {
            type: "button",
            class: "button button--danger",
            "data-confirm": true,
            onclick: () => void this.confirmLeave(),
          },
          "Discard session",
        ),
      ),
    );
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
                ? "Final check complete. Save the reviewed note or copy it."
                : "Decisions complete. Run the final check before copying.";
    this.el<HTMLElement>("[data-status]").textContent =
      this.message || guidance;
  }
  private renderInput(ready: boolean): void {
    this.el("[data-workspace]").innerHTML =
      `<section class="input-panel"><div class="pane-heading"><label for="source-input">Source text</label><button type="button" class="button button--compact" data-example>Use synthetic example</button></div>
      <textarea id="source-input" rows="12" placeholder="Type or paste the text you want to review…" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" aria-describedby="source-count"></textarea>
      <div class="pane-footer"><span id="source-count"></span><label class="review-saved-option"><input type="checkbox" data-review-saved-mappings /> Review saved redactions</label><button type="button" class="button button--primary" data-detect>Find identifiers</button></div></section>`;
    const panel = this.el<HTMLElement>(".input-panel");
    const tabPanel = h("div", {
      id: "source-tab-panel",
      role: "tabpanel",
      "aria-labelledby": `source-tab-${this.inputMode}`,
    });
    panel.replaceWith(tabPanel);
    tabPanel.append(panel);
    const tabs = h("div", {
      class: "document-tabs",
      role: "tablist",
      "aria-label": "Note source",
    });
    for (const [mode, label] of [
      ["paste", "Type or paste"],
      ["import", "Import document"],
    ] as const) {
      const tab = h(
        "button",
        {
          type: "button",
          class: "button",
          role: "tab",
          id: `source-tab-${mode}`,
          "aria-controls": "source-tab-panel",
          "aria-selected": String(this.inputMode === mode),
          tabindex: this.inputMode === mode ? "0" : "-1",
          "data-input-mode": mode,
          onclick: () => this.switchInput(mode),
        },
        label,
      );
      tab.addEventListener("keydown", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "paste"
              : event.key === "End"
                ? "import"
                : mode === "paste"
                  ? "import"
                  : "paste";
          this.switchInput(next);
        }
      });
      tabs.append(tab);
    }
    tabPanel.before(tabs);
    if (this.inputMode === "import") {
      if (this.imported) {
        panel.before(this.documentToolbar(true));
        panel.prepend(
          h(
            "p",
            { class: "muted" },
            "Check the extracted text before finding identifiers. Editing this text does not change the retained original.",
          ),
        );
      } else {
        panel.hidden = true;
        panel.before(
          h(
            "div",
            { class: "document-toolbar" },
            h(
              "div",
              { class: "document-toolbar__name" },
              h("strong", {}, "Create a note from a document"),
              h(
                "p",
                { class: "muted" },
                "Choose a .txt, .docx or PDF with selectable text. Up to 25 MiB and 100,000 characters. Processing stays on this Mac.",
              ),
            ),
            h(
              "button",
              {
                type: "button",
                class: "button button--primary",
                "data-choose-document": true,
                disabled: !this.bridge.available || !this.patient || this.busy,
                onclick: () => void this.chooseDocument(),
              },
              "Choose document",
            ),
          ),
        );
      }
    }
    const input = this.el<HTMLTextAreaElement>("#source-input");
    input.value = this.source;
    input.disabled = this.busy;
    this.el<HTMLButtonElement>("[data-example]").disabled = this.busy;
    this.el<HTMLButtonElement>("[data-example]").hidden =
      this.inputMode === "import";
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
        `${length.toLocaleString()} / 100,000 characters`;
      this.el<HTMLButtonElement>("[data-detect]").disabled =
        !ready ||
        this.busy ||
        !this.source.trim() ||
        length > MAX_SOURCE_CHARACTERS ||
        Boolean(
          this.imported?.extracted.warnings.length &&
          !this.warningsAcknowledged,
        );
      input.setAttribute(
        "aria-invalid",
        String(length > MAX_SOURCE_CHARACTERS),
      );
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
      <section class="review-wizard" aria-labelledby="wizard-title"><header class="wizard-heading"><div><p class="eyebrow">Focused review</p><h2 class="section-title" id="wizard-title">Review one item at a time</h2></div><div class="wizard-navigation"><button type="button" class="button button--compact" data-wizard-previous>Previous</button><p class="wizard-count" data-wizard-count></p><button type="button" class="button button--compact" data-wizard-next>Next</button></div></header><div class="wizard-progress"><progress data-review-progress></progress><p data-wizard-progress></p></div><div data-wizard-card></div></section>
      <section class="review-actions-bar" aria-label="Reviewed note actions"><p data-summary></p><div class="completion-actions"><button type="button" class="button" data-rescan-top>Check reviewed text</button><button type="button" class="button" data-save-note-top>Save reviewed note</button><button type="button" class="button" data-copy-top>Copy reviewed text</button></div></section>
      <div class="review-panes"><section class="text-pane"><div class="pane-heading"><h2>Source text</h2><span>Original wording</span></div><div class="note-text" data-source tabindex="0" aria-label="Source text; select a missed identifiable detail to add to review"></div><div class="selection-menu" data-selection-menu hidden role="menu" aria-label="Selected text actions"><button type="button" class="button button--compact" data-manual role="menuitem">Add to review</button><button type="button" class="button button--compact" data-cancel-selection role="menuitem">Cancel</button></div></section>
      <section class="text-pane"><div class="pane-heading"><h2>Proposed result</h2><span data-result-status></span></div><div class="note-text" data-output aria-label="Proposed result"></div></section></div>
      <section class="review-history" data-review-history><details data-resolved-items><summary data-resolved-summary></summary><div data-resolved-detections></div></details></section>
      <section class="save-bar" aria-label="Save reviewed note"><div class="field"><label for="note-title">Note title</label><input id="note-title" data-note-title maxlength="160" autocomplete="off" aria-describedby="note-title-hint note-title-error" /><span class="hint" id="note-title-hint">Saved with the source text, any imported original document, and every review decision in the encrypted library.</span><span class="error" id="note-title-error" role="alert" data-save-error></span></div><div class="page-actions"><button type="button" class="button" data-rescan>Check reviewed text</button><button type="button" class="button" data-copy>Copy reviewed text</button><button type="button" class="button button--primary" data-save-note>Save note</button></div></section>
      <p class="review-completion"><small>Copying puts reviewed text on the system clipboard. Clipboard managers may retain it.</small></p>`;
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
      void this.saveNote();
    });
    const title = this.el<HTMLInputElement>("[data-note-title]");
    title.value = this.noteTitle ?? this.suggestNoteTitle(session.output);
    title.disabled = this.busy;
    title.addEventListener("input", () => {
      this.noteTitle = title.value;
      this.saveError = "";
      this.el<HTMLElement>("[data-save-error]").textContent = "";
    });
    this.el<HTMLElement>("[data-save-error]").textContent = this.saveError;
    this.el<HTMLButtonElement>("[data-save-note]").textContent = this.savedTitle
      ? "Update note"
      : "Save note";
    this.bind("[data-save-note-top]", () => {
      title.scrollIntoView?.({ block: "center" });
      title.focus();
      title.select();
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
    card.innerHTML = `<div class="detection-copy"><div class="detection-heading"><strong data-category></strong><span class="decision-state" data-decision></span></div><p class="phrase" data-phrase></p><p class="detection-reason" data-reason></p><div data-occurrences></div></div><div class="detection-controls"><label>Placeholder <input data-label spellcheck="false" autocomplete="off" autocapitalize="characters" aria-describedby="label-hint-${item.group} label-error-${item.group}" /></label><p class="label-hint" id="label-hint-${item.group}" data-label-hint></p><p class="label-error" id="label-error-${item.group}" data-label-error role="alert"></p><label class="save-default"><input type="checkbox" data-save-default checked /> <span data-save-default-label></span></label><label class="save-default">Save for <select data-mapping-scope>${scopes}</select></label><div class="decision-buttons"><button type="button" class="button" data-action="accept">Accept</button><button type="button" class="button" data-action="edit">Apply label</button><button type="button" class="button" data-action="keep">Keep</button><button type="button" class="button" data-action="remove">Remove</button></div></div>`;
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
        ? "Update this saved redaction"
        : "Save as a redaction";
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
      find.className = "button button--compact";
      find.textContent = `Show ${index + 1}`;
      find.addEventListener("click", () => {
        this.select(occurrence.id, true);
      });
      card.querySelector("[data-occurrences]")!.append(find);
      if (items.length > 1) {
        const split = document.createElement("button");
        split.type = "button";
        split.className = "button button--compact";
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
          ...(this.imported
            ? {
                importId: this.imported.id,
                acknowledgeWarnings: this.warningsAcknowledged,
              }
            : {}),
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
        const saved = await this.perform("Saving redaction…", () =>
          this.bridge.call("save_mapping_from_review", {
            sessionId: result.id,
            revision: result.revision,
            item: args.item,
            patientScope,
          }),
        );
        if (saved !== undefined) this.message = "Redaction saved.";
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
  private async saveNote(): Promise<void> {
    if (!this.session?.checked || this.busy) return;
    const title = (
      this.noteTitle ?? this.suggestNoteTitle(this.session.output)
    ).trim();
    if (!title) {
      this.saveError = "Add a title to save this note.";
      this.focusTarget = "#note-title";
      this.render();
      return;
    }
    const updating = this.savedTitle !== null;
    const result = await this.perform(
      updating ? "Updating reviewed note…" : "Saving reviewed note…",
      () =>
        this.bridge.call<NoteView>("save_reviewed_note", {
          ...this.args(),
          title,
        }),
    );
    if (!result) {
      this.saveError = this.error;
      this.error = "";
      this.focusTarget = "#note-title";
      this.render();
      return;
    }
    const patient = this.patient;
    // The note is committed; a failure to clear the native session must not
    // strand the clinician in the review workspace.
    await this.clearSession(true);
    await this.show(
      patient
        ? { name: "patient", patientId: patient.id, tab: "notes" }
        : { name: "patients" },
      { flash: updating ? "Note updated." : "Note saved." },
    );
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
}

/** Shows generated placeholders in reviewed text as chips. The input is a
 * short search snippet and the pattern cannot backtrack. */
function withPlaceholders(text: string): (string | HTMLElement)[] {
  return text
    .split(/(\[[A-Z][A-Z0-9_]{0,45}\])/)
    .filter(Boolean)
    .map((part) =>
      /^\[[A-Z][A-Z0-9_]{0,45}\]$/.test(part)
        ? h("span", { class: "placeholder" }, part)
        : part,
    );
}

function redactionKey(mapping: MappingView): string {
  return `${mapping.phrase.toLowerCase()}\u0000${mapping.category}`;
}
