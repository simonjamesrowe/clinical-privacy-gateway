// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { TextReviewPage, type WorkspaceScreen } from "./page";
import type { PrivacyBridge, Progress, ReviewSession } from "./types";

const source = "Alex Morgan takes 10 mg.";
const initial: ReviewSession = {
  id: 1,
  revision: 0,
  source,
  output: "[PERSON_1] takes 10 mg.",
  pending: 1,
  retained: 0,
  checked: false,
  items: [
    {
      id: 1,
      group: 1,
      start: 0,
      end: 11,
      outputStart: 0,
      outputEnd: 10,
      category: "PERSON",
      replacement: "[PERSON_1]",
      decision: "pending",
      stages: ["ner"],
      confidence: 0.9,
      reason: "Possible name.",
    },
  ],
};
const models = [
  {
    id: "gpt-4.1-mini-2025-04-14",
    name: "GPT-4.1 mini · Lower cost",
    inputNanos: 400,
    cachedInputNanos: 100,
    outputNanos: 1600,
    pricingCheckedAt: "2026-09-28",
  },
  {
    id: "gpt-4.1-2025-04-14",
    name: "GPT-4.1",
    inputNanos: 2000,
    cachedInputNanos: 500,
    outputNanos: 8000,
    pricingCheckedAt: "2026-09-28",
  },
];
const documentSettings = {
  displayName: "",
  role: "",
  qualifications: "",
  hasSignature: false,
  openaiModel: models[0].id,
  clinicalSendingEnabled: false,
  apiKeyConfigured: true,
  models,
};
const emptyUsage = {
  reportsCreated: 0,
  generationAttempts: 0,
  knownCostNanos: 0,
  unknownCostAttempts: 0,
  latestCostNanos: null,
};
let root: HTMLElement;
let page: TextReviewPage;
let call: Mock<
  (command: string, args?: Record<string, unknown>) => Promise<unknown>
>;
let progress: (event: Progress) => void;
let unsubscribe: Mock<() => void>;
let view: ReviewSession;
const button = (selector: string) =>
  root.querySelector<HTMLButtonElement>(selector)!;
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
async function click(selector: string) {
  button(selector).click();
  await flush();
}
function input(value: string) {
  const field = root.querySelector<HTMLTextAreaElement>("textarea")!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
async function mount(
  available = true,
  initialScreen: WorkspaceScreen | "review" = "review",
) {
  const bridge: PrivacyBridge = {
    available,
    call: <T>(command: string, args?: Record<string, unknown>) =>
      call(command, args) as Promise<T>,
    progress: async (cb) => {
      progress = cb;
      return unsubscribe;
    },
  };
  page = new TextReviewPage(root, bridge, vi.fn(), initialScreen);
  await page.mount();
}
async function detect() {
  input(source);
  await click("[data-detect]");
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.replaceChildren(root);
  view = structuredClone(initial);
  unsubscribe = vi.fn();
  call = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "model_status")
      return {
        installed: true,
        name: "BERT",
        bytes: 110_000_000,
        revision: "fixture",
      };
    if (command === "document_settings") return documentSettings;
    if (command === "document_usage") return emptyUsage;
    if (command === "list_mappings" || command === "search_notes") return [];
    if (command === "review_decision") {
      const item = args?.item;
      const decision = args?.decision;
      view = {
        ...view,
        revision: view.revision + 1,
        pending: view.items.filter(
          (current) => current.id !== item && current.decision === "pending",
        ).length,
        retained: decision === "keep" ? view.retained + 1 : view.retained,
        checked: false,
        items: view.items.map((current) =>
          current.id === item
            ? {
                ...current,
                decision,
                replacement: args?.replacement,
              }
            : current,
        ),
      } as ReviewSession;
    }
    if (command === "rescan_text")
      view = { ...view, revision: view.revision + 1, checked: true };
    return view;
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  page?.dispose();
  vi.restoreAllMocks();
});

function editLabel(value: string) {
  const field = root.querySelector<HTMLInputElement>("[data-label]")!;
  field.value = value;
  field.dispatchEvent(new Event("input"));
  return field;
}
const stepStates = () =>
  [...root.querySelectorAll<HTMLElement>("[data-step]")].map(
    (step) => step.dataset.state,
  );
const progressBar = () =>
  root.querySelector<HTMLProgressElement>("[data-progress]")!;
const activity = () =>
  root.querySelector<HTMLElement>("[data-activity-status]")!;
const patient = {
  id: 7,
  name: "Synthetic Client",
  patientReference: "SYN-7",
  noteCount: 1,
  redactionCount: 1,
  documentCount: 0,
};
const redaction = (id: number, phrase: string, replacement: string) => ({
  id,
  phrase,
  category: "PERSON",
  replacement,
  createdAt: 1,
  updatedAt: 1,
});
/** A synthetic library: one patient, one note, one patient redaction that
 * overrides one all-patients redaction. */
function mockLibrary(overrides: Record<string, unknown> = {}) {
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (command, args) => {
    if (command in overrides) {
      const value = overrides[command];
      return typeof value === "function" ? value(args) : value;
    }
    if (command === "list_patients") return [patient];
    if (command === "search_notes")
      return [
        {
          id: 4,
          patientId: 7,
          patientName: patient.name,
          title: "Synthetic review",
          snippet: "[CLIENT] attended.",
          createdAt: 1_790_000_000,
        },
      ];
    if (command === "list_patient_mappings")
      return [redaction(1, "Alex Morgan", "[CLIENT]")];
    if (command === "list_mappings")
      return [redaction(2, "alex morgan", "[PERSON]")];
    return original(command, args);
  });
}
function type(selector: string, value: string) {
  const field = root.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
async function submit(selector: string) {
  root
    .querySelector<HTMLFormElement>(selector)!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

describe("text review", () => {
  it("does not read document credentials when opening the notes library", async () => {
    await mount(true, "notes");

    expect(call).toHaveBeenCalledWith("model_status", undefined);
    expect(call).toHaveBeenCalledWith("search_notes", { query: "" });
    expect(
      call.mock.calls.some(([command]) => command === "document_settings"),
    ).toBe(false);
  });

  it("shows document prompt templates and their maintenance actions", async () => {
    mockLibrary({
      list_document_templates: [
        {
          id: 1,
          version: 1,
          name: "GP letter",
          description: "Summarise synthetic care for the GP",
          instructions: "Use only supplied notes.",
          archived: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await mount(true, "patients");
    await click('[data-route="templates"]');
    expect(root.querySelector("#templates-title")?.textContent).toBe(
      "Document prompt templates",
    );
    expect(root.querySelector(".data-table")?.textContent).toContain(
      "GP letter",
    );
    expect(root.querySelector(".data-table")?.textContent).toContain(
      "Duplicate",
    );
    await click("[data-new-template]");
    expect(root.querySelector("h1")?.textContent).toContain("New template");
  });

  it("adds a Documents tab and keeps generation visibly governance-gated", async () => {
    mockLibrary({
      list_patient_documents: [],
      list_document_templates: [
        {
          id: 1,
          version: 1,
          name: "GP letter",
          description: "Synthetic description",
          instructions: "Use only supplied notes.",
          archived: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      document_settings: {
        displayName: "",
        role: "",
        qualifications: "",
        hasSignature: false,
        openaiModel: "configured-model",
        clinicalSendingEnabled: false,
        apiKeyConfigured: true,
      },
    });
    await mount(true, "patients");
    await click("[data-open-patient]");
    await click("#tab-documents");
    expect(root.querySelector("[data-new-document]")).not.toBeNull();
    await click("[data-new-document]");
    expect(root.querySelector("#new-document-title")?.textContent).toBe(
      "New document",
    );
    expect(root.textContent).toContain("Clinical sending is not enabled");
    expect(root.textContent).toContain("Review submission");
  });

  it("lists and searches documents across patients and starts from a patient chooser", async () => {
    mockLibrary({
      list_document_templates: [],
      document_settings: documentSettings,
      list_documents: [
        {
          id: 12,
          patientId: patient.id,
          patientName: patient.name,
          patientReference: patient.patientReference,
          title: "Synthetic GP update",
          templateName: "GP letter",
          revision: 1,
          reviewed: false,
          createdAt: 1_790_000_000,
          updatedAt: 1_790_000_100,
          usage: {
            ...emptyUsage,
            generationAttempts: 1,
            latestCostNanos: 900_000,
          },
        },
      ],
    });
    await mount(true, "documents");
    expect(root.querySelector("#documents-title")?.textContent).toBe(
      "Documents",
    );
    expect(root.textContent).toContain("Synthetic GP update");
    expect(root.textContent).toContain("Synthetic Client");
    type("#search", "missing");
    await submit("[data-search]");
    expect(root.textContent).toContain("No documents match “missing”");
    await click("[data-new-document]");
    expect(root.querySelector("#document-patient-title")?.textContent).toBe(
      "New document",
    );
    expect(root.textContent).toContain("Choose the patient");
    await click('[data-choose-document-patient="7"]');
    expect(root.querySelector("#new-document-title")?.textContent).toBe(
      "New document",
    );
  });

  it("starts a new note from the all-notes page after choosing a patient", async () => {
    mockLibrary();
    await mount(true, "notes");
    expect(button("[data-new-note]").textContent).toBe("New note");
    await click("[data-new-note]");
    expect(root.querySelector("#note-patient-title")?.textContent).toBe(
      "New note",
    );
    expect(root.querySelector("[data-new-patient]")).not.toBeNull();
    await click('[data-choose-note-patient="7"]');
    expect(root.querySelector("#review-title")?.textContent).toBe(
      "De-identify text",
    );
    expect(root.textContent).toContain("New note · Synthetic Client");
  });

  it("starts a new note from a patient and includes that patient in detection", async () => {
    call.mockImplementation(async (command: string) => {
      if (command === "model_status")
        return {
          installed: true,
          name: "BERT",
          bytes: 110_000_000,
          revision: "fixture",
        };
      if (command === "list_patients")
        return [{ id: 7, name: "Synthetic Client", patientReference: "SYN-7" }];
      return view;
    });
    await mount(true, "patients");
    expect(root.textContent).toContain("Synthetic Client");
    await click("[data-start-note]");
    input(source);
    await click("[data-detect]");
    expect(
      root.querySelector<HTMLInputElement>("[data-save-default]")!.checked,
    ).toBe(true);
    expect(
      root.querySelector<HTMLSelectElement>("[data-mapping-scope]")!.value,
    ).toBe("patient");
    expect(call).toHaveBeenLastCalledWith(
      "detect_text",
      expect.objectContaining({
        patientId: 7,
        source,
        reviewSavedMappings: false,
      }),
    );
  });
  it("selects the complete placeholder whenever its field receives focus", async () => {
    await mount();
    await detect();
    const label = root.querySelector<HTMLInputElement>("[data-label]")!;
    expect(label.selectionStart).toBe(0);
    expect(label.selectionEnd).toBe(label.value.length);
    button('[data-action="keep"]').focus();
    label.focus();
    expect(label.selectionStart).toBe(0);
    expect(label.selectionEnd).toBe(label.value.length);
  });
  it("confirms patient deletion inline from the Details tab", async () => {
    mockLibrary();
    await mount(true, "patients");
    await click("[data-open-patient]");
    await click('[data-tab="details"]');
    await click('[data-confirm-trigger="patient"]');
    expect(root.querySelector("[data-confirmation]")?.textContent).toContain(
      "Are you really sure you want to delete this?",
    );
    expect(root.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-cancel-confirm]"),
    );
    await click("[data-cancel-confirm]");
    expect(call).not.toHaveBeenCalledWith("delete_patient", expect.anything());
    expect(document.activeElement).toBe(
      root.querySelector('[data-confirm-trigger="patient"]'),
    );

    await click('[data-confirm-trigger="patient"]');
    await click("[data-confirm-delete]");
    expect(call).toHaveBeenCalledWith("delete_patient", { id: 7 });
    expect(root.querySelector("#patients-title")).not.toBeNull();
    expect(root.textContent).toContain("Patient deleted.");
  });
  it("can return saved mappings to the review queue for one note", async () => {
    await mount();
    input(source);
    const option = root.querySelector<HTMLInputElement>(
      "[data-review-saved-mappings]",
    )!;
    expect(option.checked).toBe(false);
    option.checked = true;
    option.dispatchEvent(new Event("change"));
    await click("[data-detect]");
    expect(call).toHaveBeenLastCalledWith(
      "detect_text",
      expect.objectContaining({ reviewSavedMappings: true }),
    );
  });
  it("presents notes in a searchable table and reopens one in the review workspace", async () => {
    call.mockImplementation(async (command: string) => {
      if (command === "model_status")
        return {
          installed: true,
          name: "BERT",
          bytes: 110_000_000,
          revision: "fixture",
        };
      if (command === "search_notes")
        return [
          {
            id: 4,
            patientName: "Synthetic Client",
            patientReference: "SYN-4",
            title: "Synthetic review",
            snippet: "[CLIENT] attended.",
          },
        ];
      if (command === "open_saved_note")
        return {
          note: {
            id: 4,
            patientId: 7,
            patientName: "Synthetic Client",
            patientReference: "SYN-4",
            title: "Synthetic review",
            sourceText: source,
            reviewedText: initial.output,
            provenance: "{}",
            createdAt: 1,
          },
          session: initial,
        };
      return view;
    });
    await mount(true, "notes");
    expect(root.querySelector(".data-table")?.textContent).toContain(
      "Synthetic Client SYN-4",
    );
    expect(root.querySelector(".data-table")?.textContent).toContain(
      "Synthetic review",
    );
    await click("[data-open-note]");
    expect(root.querySelector("#review-title")?.textContent).toBe(
      "De-identify text",
    );
    expect(root.querySelector("[data-source]")?.textContent).toBe(source);
    expect(root.querySelector("[data-note-title]")).not.toBeNull();
    expect(
      root.querySelector<HTMLInputElement>("[data-note-title]")!.value,
    ).toBe("Synthetic review");
  });
  it("confirms note deletion before removing the note", async () => {
    call.mockImplementation(async (command: string) => {
      if (command === "model_status")
        return {
          installed: true,
          name: "BERT",
          bytes: 110_000_000,
          revision: "fixture",
        };
      if (command === "search_notes")
        return [
          {
            id: 4,
            patientName: "Synthetic Client",
            patientReference: "SYN-4",
            title: "Synthetic review",
            snippet: "[CLIENT] attended.",
          },
        ];
      return view;
    });
    await mount(true, "notes");
    await click('[data-confirm-trigger="note-4"]');
    expect(root.querySelector(".confirm-row")?.textContent).toContain(
      "Are you really sure you want to delete this?",
    );
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(root.querySelector(".confirm-row")).toBeNull();
    await click('[data-confirm-trigger="note-4"]');
    await click("[data-confirm-delete]");
    expect(call).toHaveBeenCalledWith("delete_note", { id: 4 });
  });
  it("keeps verification incomplete when a model download fails and bounds its progress", async () => {
    call.mockResolvedValueOnce({
      installed: false,
      name: "BERT",
      bytes: 110,
      revision: "fixture",
    });
    await mount();
    let reject!: (error: string) => void;
    call.mockResolvedValueOnce({
      installed: false,
      name: "BERT",
      bytes: 110,
      revision: "fixture",
    });
    let operation = 0;
    const previous = call.getMockImplementation()!;
    call.mockImplementation((command, args) =>
      command === "install_model"
        ? new Promise((_, no) => {
            operation = Number(args?.operation);
            reject = no;
          })
        : previous(command, args),
    );
    button("[data-install]").click();
    await flush();
    expect(root.querySelector("#settings-title")?.textContent).toBe("Settings");
    button("[data-settings-install]").click();
    progress({
      operation: operation - 1,
      stage: "Stale download",
      completed: 110,
      total: 110,
    });
    expect(progressBar().hasAttribute("value")).toBe(false);
    progress({
      operation,
      stage: "Downloading model",
      completed: 55,
      total: 110,
    });
    expect(progressBar().value).toBe(50);
    progress({
      operation,
      stage: "Downloading model",
      completed: 120,
      total: 110,
    });
    expect(progressBar().value).toBe(100);
    expect(activity().hidden).toBe(false);
    expect(button("[data-cancel]").hidden).toBe(false);
    reject("Model download failed.");
    await flush();
    expect(activity().hidden).toBe(true);
    expect(button("[data-settings-install]").disabled).toBe(false);
    expect(root.querySelector("[data-error]")!.textContent).toBe(
      "Model download failed.",
    );
  });
  it("uppercases typing and formats on blur without approving the draft", async () => {
    await mount();
    await detect();
    const field = editLabel("case manager");
    expect(field.value).toBe("CASE MANAGER");
    field.dispatchEvent(new Event("blur"));
    expect(field.value).toBe("[CASE_MANAGER]");
    expect(call).toHaveBeenLastCalledWith("detect_text", expect.anything());
    expect(button("[data-copy]").disabled).toBe(true);
    expect(root.querySelector("[data-card]")!.getAttribute("data-state")).toBe(
      "pending",
    );
    await click('[data-action="edit"]');
    expect(call).toHaveBeenCalledWith(
      "review_decision",
      expect.objectContaining({
        decision: "edit",
        replacement: "[CASE_MANAGER]",
      }),
    );
    expect(root.querySelector("[data-card]")!.getAttribute("data-state")).toBe(
      "resolved",
    );
  });
  it("keeps resolved groups available in the wizard and review history", async () => {
    await mount();
    await detect();
    await click('[data-action="accept"]');
    expect(root.querySelector("[data-wizard-card] [data-card]")).not.toBeNull();
    expect(root.querySelector("[data-wizard-card]")!.textContent).toContain(
      "accepted",
    );
    const resolved = root.querySelector<HTMLDetailsElement>(
      "[data-resolved-items]",
    )!;
    expect(resolved.hidden).toBe(false);
    expect(resolved.textContent).toContain("1 resolved item");
    resolved.open = true;
    resolved.dispatchEvent(new Event("toggle"));
    expect(
      root.querySelector("[data-resolved-detections] [data-card]"),
    ).not.toBeNull();
  });
  it("shows one action at a time and advances the review progress", async () => {
    view = {
      ...initial,
      output: "[PERSON_1] takes [REFERENCE_1] mg.",
      pending: 2,
      items: [
        ...initial.items,
        {
          id: 2,
          group: 2,
          start: 18,
          end: 20,
          outputStart: 17,
          outputEnd: 30,
          category: "MISC",
          replacement: "[REFERENCE_1]",
          decision: "pending",
          stages: ["rules"],
          confidence: 1,
          reason: "Identifier pattern.",
        },
      ],
    };
    await mount();
    await detect();
    expect(
      root.querySelectorAll("[data-wizard-card] [data-card]"),
    ).toHaveLength(1);
    expect(root.querySelector("[data-wizard-card]")!.textContent).toContain(
      "Alex Morgan",
    );
    expect(
      root
        .querySelector('[data-source] [data-item="1"]')
        ?.getAttribute("data-active-review"),
    ).toBe("true");
    expect(
      root
        .querySelector('[data-output] [data-item="1"]')
        ?.getAttribute("data-active-review"),
    ).toBe("true");
    expect(root.querySelector("[data-wizard-count]")!.textContent).toBe(
      "Item 1 of 2",
    );
    expect(
      root.querySelector<HTMLProgressElement>("[data-review-progress]")!.value,
    ).toBe(0);
    expect(document.activeElement).toBe(
      root.querySelector("[data-wizard-card] [data-label]"),
    );

    await click('[data-action="accept"]');
    expect(root.querySelector("[data-wizard-card]")!.textContent).toContain(
      "10",
    );
    expect(
      root
        .querySelector('[data-source] [data-item="2"]')
        ?.getAttribute("data-active-review"),
    ).toBe("true");
    expect(
      root
        .querySelector('[data-output] [data-item="2"]')
        ?.getAttribute("data-active-review"),
    ).toBe("true");
    expect(root.querySelector("[data-wizard-count]")!.textContent).toBe(
      "Item 2 of 2",
    );
    expect(
      root.querySelector<HTMLProgressElement>("[data-review-progress]")!.value,
    ).toBe(1);
    expect(root.querySelector("[data-wizard-progress]")!.textContent).toBe(
      "1 action left",
    );
    expect(document.activeElement).toBe(
      root.querySelector("[data-wizard-card] [data-label]"),
    );

    await click("[data-wizard-previous]");
    expect(root.querySelector("[data-wizard-card]")!.textContent).toContain(
      "Alex Morgan",
    );
    expect(document.activeElement).toBe(
      root.querySelector("[data-wizard-card] [data-label]"),
    );
    await click("[data-wizard-next]");
    expect(root.querySelector("[data-wizard-card]")!.textContent).toContain(
      "10",
    );
    root.querySelector<HTMLElement>('[data-source] [data-item="1"]')!.click();
    await flush();
    expect(root.querySelector("[data-wizard-card]")!.textContent).toContain(
      "Alex Morgan",
    );
    expect(
      root.querySelector("[data-wizard-card] [data-decision]")!.textContent,
    ).toContain("accepted");
  });
  it("scrolls only the paired previews to the selected occurrence", async () => {
    await mount();
    await detect();
    const sourcePreview = root.querySelector<HTMLElement>("[data-source]")!;
    const outputPreview = root.querySelector<HTMLElement>("[data-output]")!;
    const sourceMark = sourcePreview.querySelector<HTMLElement>("mark")!;
    const outputMark = outputPreview.querySelector<HTMLElement>("mark")!;
    for (const preview of [sourcePreview, outputPreview]) {
      Object.defineProperty(preview, "clientHeight", {
        configurable: true,
        value: 300,
      });
      vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
        top: 100,
        height: 300,
      } as DOMRect);
    }
    for (const mark of [sourceMark, outputMark])
      vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({
        top: 500,
        height: 20,
      } as DOMRect);

    await click("[data-occurrences] button");
    expect(sourcePreview.scrollTop).toBe(260);
    expect(outputPreview.scrollTop).toBe(260);
  });
  it("opens local note, mapping, and model-management views from the workspace", async () => {
    await mount();
    await click('[data-route="redactions"]');
    expect(root.querySelector("#redactions-title")?.textContent).toBe(
      "Redactions",
    );
    expect(
      root
        .querySelector('[data-route="redactions"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(root.textContent).toContain("No redactions yet");
    root.querySelector<HTMLButtonElement>('[data-route="notes"]')!.click();
    await flush();
    expect(root.querySelector("#notes-title")?.textContent).toBe("Notes");
    root.querySelector<HTMLButtonElement>('[data-route="settings"]')!.click();
    await flush();
    expect(root.querySelector("#settings-title")?.textContent).toBe("Settings");
    expect(root.querySelector("[data-model-panel]")).toBeNull();
  });
  it("normalises on Accept too, and keeps overlong errors beside the field", async () => {
    await mount();
    await detect();
    editLabel("a".repeat(47));
    await click('[data-action="edit"]');
    expect(root.querySelector("[data-label-error]")!.textContent).toContain(
      "46 characters",
    );
    expect(
      root.querySelector("[data-label]")!.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(call).toHaveBeenLastCalledWith("detect_text", expect.anything());
    editLabel("client name");
    await click('[data-action="accept"]');
    expect(call).toHaveBeenCalledWith(
      "review_decision",
      expect.objectContaining({
        decision: "edit",
        replacement: "[CLIENT_NAME]",
      }),
    );
  });
  it("restores a cleared placeholder and marks changed resolved cards as needing attention", async () => {
    await mount();
    await detect();
    await click('[data-action="accept"]');
    await click("[data-rescan]");
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
    const field = editLabel("client");
    expect(root.querySelector("[data-card]")!.getAttribute("data-state")).toBe(
      "pending",
    );
    expect(
      root.querySelector("[data-card] [data-decision]")!.textContent,
    ).toContain("Unapplied label");
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
    expect(button("[data-copy]").disabled).toBe(true);
    field.value = "";
    field.dispatchEvent(new Event("blur"));
    expect(field.value).toBe("[PERSON_1]");
    expect(root.querySelector("[data-card]")!.getAttribute("data-state")).toBe(
      "resolved",
    );
    expect(button("[data-copy]").disabled).toBe(false);
  });
  it("tracks real analysis progress, handles loading without a percentage and resets on completion", async () => {
    await mount();
    expect(stepStates()).toEqual([
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
    let resolve!: (value: ReviewSession) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    input(source);
    button("[data-detect]").click();
    expect(progressBar().hidden).toBe(false);
    expect(activity().hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("[data-main]")!.inert).toBe(true);
    expect(
      root.querySelector(".app-header")!.contains(button("[data-cancel]")),
    ).toBe(true);
    expect(progressBar().hasAttribute("value")).toBe(false);
    progress({
      operation: 1,
      stage: "Finding named entities",
      completed: 2,
      total: 10,
    });
    expect(progressBar().value).toBe(20);
    expect(root.querySelector("[data-work-detail]")!.textContent).toContain(
      "Section 2 of 10",
    );
    progress({ operation: 999, stage: "Stale", completed: 10, total: 10 });
    expect(progressBar().value).toBe(20);
    progress({
      operation: 1,
      stage: "Loading local model",
      completed: 0,
      total: 0,
    });
    expect(progressBar().hasAttribute("value")).toBe(false);
    resolve(view);
    await flush();
    expect(progressBar().hidden).toBe(true);
    expect(activity().hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-main]")!.inert).toBe(false);
    expect(progressBar().hasAttribute("value")).toBe(false);
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
  });
  it("automatically checks the reviewed text after the last action", async () => {
    await mount();
    await detect();
    await click('[data-action="accept"]');
    expect(call).toHaveBeenCalledWith(
      "rescan_text",
      expect.objectContaining({ sessionId: 1, revision: 1 }),
    );
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
    expect(button("[data-copy]").disabled).toBe(false);
    expect(button("[data-copy-top]").disabled).toBe(false);
    expect(button("[data-save-note]").disabled).toBe(false);
    expect(button("[data-save-note-top]").disabled).toBe(false);
  });
  it("does not offer native processing in a browser-only preview", async () => {
    await mount(false);
    input(source);
    expect(button("[data-detect]").disabled).toBe(true);
    expect(button("[data-install]").disabled).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });
  it("gates detection by readiness, nonblank input and Unicode character limit", async () => {
    await mount();
    expect(button("[data-detect]").disabled).toBe(true);
    input("🩺".repeat(100_000));
    expect(button("[data-detect]").disabled).toBe(false);
    input("🩺".repeat(100_001));
    expect(button("[data-detect]").disabled).toBe(true);
    input(" \n");
    expect(button("[data-detect]").disabled).toBe(true);
  });
  it("requires decisions and an automatic successful final check before requesting native copy", async () => {
    await mount();
    await detect();
    expect(button("[data-copy]").disabled).toBe(true);
    expect(button("[data-rescan]").disabled).toBe(true);
    await click('[data-action="accept"]');
    expect(button("[data-copy]").disabled).toBe(false);
    expect(button("[data-rescan]").disabled).toBe(true);
    await click("[data-copy]");
    expect(call).toHaveBeenLastCalledWith("copy_reviewed_text", {
      sessionId: 1,
      revision: 2,
    });
    expect(root.textContent).toContain("Reviewed text copied.");
  });
  it("blocks copying with an unapplied placeholder draft and invalidates after applying", async () => {
    await mount();
    await detect();
    await click('[data-action="accept"]');
    const label = root.querySelector<HTMLInputElement>("[data-label]")!;
    label.value = "[CLIENT]";
    label.dispatchEvent(new Event("input"));
    expect(button("[data-copy]").disabled).toBe(true);
    await click('[data-action="edit"]');
    expect(call).toHaveBeenCalledWith(
      "review_decision",
      expect.objectContaining({ replacement: "[CLIENT]", decision: "edit" }),
    );
    expect(button("[data-copy]").disabled).toBe(false);
    expect(button("[data-rescan]").disabled).toBe(true);
  });
  it("renders source markup as text, never executable HTML", async () => {
    view = {
      ...initial,
      source: '<img src="x" onerror="alert(1)">',
      output: "<script>alert(1)</script>",
      items: [],
      pending: 0,
    };
    await mount();
    await detect();
    expect(root.querySelector("img, script")).toBeNull();
    expect(root.querySelector("[data-source]")!.textContent).toBe(view.source);
    expect(root.querySelector("[data-output]")!.textContent).toBe(view.output);
  });
  it("retains source and reports failure without claiming detection succeeded", async () => {
    await mount();
    call.mockRejectedValueOnce("Local model unavailable.");
    await detect();
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      source,
    );
    expect(root.textContent).toContain("Local model unavailable.");
    expect(root.querySelector("[data-copy]")).toBeNull();
  });
  it("keeps copy blocked when the final check fails", async () => {
    await mount();
    await detect();
    const original = call.getMockImplementation()!;
    call.mockImplementation((command, args) => {
      if (command === "rescan_text") {
        return Promise.reject("The final check could not finish.");
      }
      return original(command, args);
    });
    await click('[data-action="accept"]');
    expect(button("[data-copy]").disabled).toBe(true);
    expect(root.textContent).toContain("The final check could not finish.");
  });
  it("ignores unrelated progress and cancels the active operation only", async () => {
    await mount();
    let reject!: (error: string) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    input(source);
    button("[data-detect]").click();
    progress({ operation: 999, stage: "Stale", completed: 1, total: 1 });
    expect(root.textContent).not.toContain("Stale");
    progress({
      operation: 1,
      stage: "Finding entities",
      completed: 1,
      total: 2,
    });
    expect(root.textContent).toContain("Finding entities · 50%");
    await click("[data-cancel]");
    expect(call).toHaveBeenLastCalledWith("cancel_operation", { operation: 1 });
    expect(progressBar().hasAttribute("value")).toBe(false);
    expect(button("[data-cancel]").disabled).toBe(true);
    progress({ operation: 1, stage: "Late progress", completed: 2, total: 2 });
    expect(root.textContent).toContain("Cancelling…");
    expect(root.textContent).not.toContain("Late progress");
    reject("Operation cancelled.");
    await flush();
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      source,
    );
    expect(button("[data-home]").disabled).toBe(false);
    expect(progressBar().hidden).toBe(true);
    expect(stepStates()).toEqual([
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });
  it("requires confirmation before clearing the native and displayed session", async () => {
    await mount();
    await detect();
    await click("[data-discard]");
    expect(call).not.toHaveBeenCalledWith("discard_session", undefined);
    await click("[data-stay]");
    expect(root.querySelector("[data-source]")).not.toBeNull();
    await click("[data-discard]");
    await click("[data-confirm]");
    expect(call).toHaveBeenLastCalledWith("discard_session", undefined);
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(root.textContent).not.toContain(source);
  });
  it("adds manually selected text using UTF-16 offsets", async () => {
    await mount();
    await detect();
    const sourceNode = root.querySelector("[data-source]")!;
    const range = document.createRange();
    range.selectNodeContents(sourceNode.querySelector("mark")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    sourceNode.dispatchEvent(new MouseEvent("mouseup"));
    expect(
      root.querySelector<HTMLElement>("[data-selection-menu]")!.hidden,
    ).toBe(false);
    expect(root.querySelector("[data-selection-menu]")!.textContent).toContain(
      "Add to review",
    );
    expect(
      root.querySelector("[data-selection-menu]")!.getAttribute("role"),
    ).toBe("menu");
    button("[data-cancel-selection]").click();
    expect(
      root.querySelector<HTMLElement>("[data-selection-menu]")!.hidden,
    ).toBe(true);
    expect(call).not.toHaveBeenCalledWith(
      "add_manual_detection",
      expect.anything(),
    );
    window.getSelection()!.addRange(range);
    sourceNode.dispatchEvent(new MouseEvent("mouseup"));
    await click("[data-manual]");
    expect(call).toHaveBeenLastCalledWith("add_manual_detection", {
      sessionId: 1,
      revision: 0,
      start: 0,
      end: 11,
    });
  });
  it("preserves confirmation while initial model status arrives and cleans it up on disposal", async () => {
    let resolve!: (value: unknown) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const mounting = mount();
    await flush();
    expect(stepStates()).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(progressBar().hidden).toBe(false);
    expect(progressBar().hasAttribute("value")).toBe(false);
    input(source);
    await click("[data-discard]");
    expect(root.querySelector("[data-discard-confirm]")).not.toBeNull();
    resolve({
      installed: true,
      name: "BERT",
      bytes: 110_000_000,
      revision: "fixture",
    });
    await mounting;
    expect(root.querySelector("[data-discard-confirm]")).not.toBeNull();
    await click("[data-stay]");
    expect(root.querySelector("[data-discard-confirm]")).toBeNull();
    expect(progressBar().hidden).toBe(true);
    expect(button("[data-detect]").disabled).toBe(false);
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      source,
    );
    await click("[data-discard]");
    page.dispose();
    await flush();
    expect(root.textContent).toBe("");
    expect(call).not.toHaveBeenCalledWith("discard_session", undefined);
  });
  it("clears displayed content and subscriptions on disposal and ignores late results", async () => {
    await mount();
    let resolve!: (value: ReviewSession) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    input(source);
    button("[data-detect]").click();
    page.dispose();
    resolve(view);
    await flush();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(root.textContent).toBe("");
  });
  it("renders patient names as text in the table and patient workspace", async () => {
    mockLibrary({
      list_patients: [{ ...patient, name: '<img src=x onerror="alert(1)">' }],
    });
    await mount(true, "patients");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("[data-open-patient]")!.textContent).toBe(
      '<img src=x onerror="alert(1)">',
    );
    await click("[data-open-patient]");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("#patient-title")!.textContent).toContain(
      '<img src=x onerror="alert(1)">',
    );
  });
  it("adds a patient on its own page and opens their notes", async () => {
    mockLibrary({
      create_patient: { ...patient, id: 9, name: "New Client", noteCount: 0 },
      list_patients: [{ ...patient, id: 9, name: "New Client", noteCount: 0 }],
      search_notes: [],
    });
    await mount(true, "patients");
    await click("[data-add-patient]");
    expect(root.querySelector("#new-patient-title")?.textContent).toBe(
      "New patient",
    );
    expect(root.querySelector("dialog")).toBeNull();
    type("[data-patient-name]", "New Client");
    await submit("[data-patient-form]");
    expect(call).toHaveBeenCalledWith("create_patient", {
      name: "New Client",
      patientReference: undefined,
    });
    expect(root.querySelector("#patient-title")?.textContent).toContain(
      "New Client",
    );
    expect(
      root.querySelector('[data-tab="notes"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(root.textContent).toContain("No notes yet");
    expect(root.textContent).toContain("Patient added.");
  });
  it("edits patient details in place and saves only when something changed", async () => {
    mockLibrary({
      update_patient: (args: Record<string, unknown>) => ({
        ...patient,
        name: args.name,
        patientReference: args.patientReference,
      }),
    });
    await mount(true, "patients");
    await click("[data-open-patient]");
    await click('[data-tab="details"]');
    expect(document.activeElement).toBe(root.querySelector("#tab-details"));
    root
      .querySelector("#tab-details")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    await flush();
    expect(
      root.querySelector('[data-tab="notes"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.activeElement).toBe(root.querySelector("#tab-notes"));
    await click('[data-tab="details"]');
    expect(button("[data-save-patient]").disabled).toBe(true);
    type("[data-patient-name]", "Renamed Client");
    type("[data-patient-reference]", " ");
    expect(button("[data-save-patient]").disabled).toBe(false);
    await submit("[data-patient-form]");
    expect(call).toHaveBeenCalledWith("update_patient", {
      id: 7,
      name: "Renamed Client",
      patientReference: undefined,
    });
    expect(root.querySelector("#patient-title")?.textContent).toBe(
      "Renamed Client",
    );
    expect(root.textContent).toContain("Changes saved.");
    expect(button("[data-save-patient]").disabled).toBe(true);
  });
  it("searches one patient's notes only when Search is chosen", async () => {
    mockLibrary();
    await mount(true, "patients");
    await click("[data-open-patient]");
    expect(call).toHaveBeenLastCalledWith("search_notes", {
      query: "",
      patientId: 7,
    });
    type("#search", "attended");
    expect(call).toHaveBeenLastCalledWith("search_notes", {
      query: "",
      patientId: 7,
    });
    await submit("[data-search]");
    expect(call).toHaveBeenLastCalledWith("search_notes", {
      query: "attended",
      patientId: 7,
    });
    expect(
      root.querySelector('.table-toolbar [role="status"]')?.textContent,
    ).toContain("1 of 1 note match “attended”");
    expect(document.activeElement).toBe(root.querySelector("#search"));
  });
  it("edits only a redaction's replacement and never offers deletion", async () => {
    mockLibrary({
      update_patient_mapping: (args: Record<string, unknown>) =>
        redaction(1, "Alex Morgan", String(args.replacement)),
    });
    await mount(true, "patients");
    await click("[data-open-patient]");
    await click('[data-tab="redactions"]');
    expect(root.textContent).toContain("Overrides all-patients");
    expect(root.textContent).not.toContain("Delete");
    expect(root.textContent).not.toContain("Add redaction");
    await click('[data-edit-redaction="1"]');
    const field = root.querySelector<HTMLInputElement>(
      "[data-redaction-input]",
    )!;
    expect(document.activeElement).toBe(field);
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(root.querySelector("[data-redaction-input]")).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector('[data-edit-redaction="1"]'),
    );
    await click('[data-edit-redaction="1"]');
    type("[data-redaction-input]", "case manager");
    await click("[data-save-redaction]");
    expect(call).toHaveBeenCalledWith("update_patient_mapping", {
      patientId: 7,
      id: 1,
      replacement: "[CASE_MANAGER]",
    });
    expect(root.querySelector(".placeholder")?.textContent).toBe(
      "[CASE_MANAGER]",
    );
    expect(root.textContent).toContain("Redaction updated.");
  });
  it("edits an all-patients redaction from the Redactions page", async () => {
    mockLibrary({
      update_mapping: (args: Record<string, unknown>) =>
        redaction(2, "alex morgan", String(args.replacement)),
    });
    await mount();
    await click('[data-route="redactions"]');
    await click('[data-edit-redaction="2"]');
    type("[data-redaction-input]", "[SERVICE]");
    await click("[data-save-redaction]");
    expect(call).toHaveBeenCalledWith("update_mapping", {
      id: 2,
      replacement: "[SERVICE]",
    });
  });
  it("asks before leaving an unsaved review for another screen", async () => {
    mockLibrary();
    await mount();
    input(source);
    await click('[data-route="patients"]');
    expect(root.querySelector("[data-discard-confirm]")).not.toBeNull();
    expect(root.querySelector("#review-title")).not.toBeNull();
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(root.querySelector("[data-discard-confirm]")).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      source,
    );
    await click('[data-route="patients"]');
    await click("[data-confirm]");
    expect(call).toHaveBeenCalledWith("discard_session", undefined);
    expect(root.querySelector("#patients-title")).not.toBeNull();
    expect(root.textContent).not.toContain(source);
  });
  it("saves a checked note from the inline save bar and returns to the patient", async () => {
    mockLibrary({ save_reviewed_note: { id: 5 } });
    await mount(true, "patients");
    await click("[data-start-note]");
    await detect();
    await click('[data-action="accept"]');
    const title = root.querySelector<HTMLInputElement>("[data-note-title]")!;
    expect(title.value).toBe("Clinical review");
    type("[data-note-title]", "  ");
    await click("[data-save-note]");
    expect(root.querySelector("[data-save-error]")!.textContent).toBe(
      "Add a title to save this note.",
    );
    expect(call).not.toHaveBeenCalledWith(
      "save_reviewed_note",
      expect.anything(),
    );
    type("[data-note-title]", "Synthetic review");
    await click("[data-save-note]");
    expect(call).toHaveBeenCalledWith("save_reviewed_note", {
      sessionId: 1,
      revision: 2,
      title: "Synthetic review",
    });
    expect(root.querySelector("#patient-title")?.textContent).toContain(
      "Synthetic Client",
    );
    expect(root.textContent).toContain("Note saved.");
    expect(root.querySelector("dialog")).toBeNull();
  });
});

describe("document notes", () => {
  const imported = {
    id: 12,
    document: {
      name: "synthetic-consultation.docx",
      format: "docx",
      byteLength: 240,
    },
    extracted: {
      text: source,
      blocks: [
        { kind: "heading", text: "Synthetic consultation" },
        { kind: "paragraph", text: source },
        { kind: "table", rows: [["Dose", "10 mg"]] },
      ],
      warnings: [],
      pageCount: null,
    },
  };
  async function newDocument(overrides: Record<string, unknown> = {}) {
    mockLibrary({
      import_document: imported,
      open_document_preview: { ...imported, id: 99 },
      ...overrides,
    });
    await mount(true, "patients");
    await click("[data-start-note]");
    await click('[data-input-mode="import"]');
    await click("[data-choose-document]");
  }
  it("imports editable text with patient binding and uses its original handle for detection", async () => {
    await newDocument();
    expect(call).toHaveBeenCalledWith(
      "import_document",
      expect.objectContaining({ patientId: 7 }),
    );
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      source,
    );
    input("Corrected synthetic wording");
    await click("[data-detect]");
    expect(call).toHaveBeenCalledWith(
      "detect_text",
      expect.objectContaining({
        source: "Corrected synthetic wording",
        importId: 12,
        patientId: 7,
      }),
    );
  });
  it("disposes a pending import and ignores its late result", async () => {
    let resolve!: (value: unknown) => void;
    mockLibrary({
      import_document: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    await mount(true, "patients");
    await click("[data-start-note]");
    await click('[data-input-mode="import"]');
    await click("[data-choose-document]");
    expect(button("[data-cancel]").hidden).toBe(false);
    page.dispose();
    expect(call).toHaveBeenCalledWith("discard_session", undefined);
    resolve(imported);
    await flush();
    expect(root.textContent).toBe("");
  });
  it("requires acknowledging extraction limitations before detection", async () => {
    await newDocument({
      import_document: {
        ...imported,
        extracted: {
          ...imported.extracted,
          warnings: ["Image text is not extracted."],
        },
      },
    });
    expect(button("[data-detect]").disabled).toBe(true);
    await click("[data-acknowledge-document]");
    expect(button("[data-detect]").disabled).toBe(false);
    await click("[data-detect]");
    expect(call).toHaveBeenCalledWith(
      "detect_text",
      expect.objectContaining({ acknowledgeWarnings: true }),
    );
  });
  it("preserves the editable text and exact-original preview when returning", async () => {
    await newDocument();
    input("Edited source for review");
    await click("[data-preview-import]");
    expect(root.textContent).toContain("Original document");
    expect(root.textContent).toContain("Simplified layout");
    expect(root.textContent).toContain(source);
    expect(root.querySelector("table")!.textContent).toContain("10 mg");
    expect(root.textContent).not.toContain("Edited source for review");
    await click("[data-close-preview]");
    expect(call).toHaveBeenCalledWith("close_document_preview", { id: 99 });
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Edited source for review",
    );
    expect(document.activeElement).toBe(button("[data-preview-import]"));
  });
  it("preserves an existing import after cancelled or failed replacement", async () => {
    await newDocument();
    input("Edited before replacement");
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (command, args) =>
      command === "import_document" ? null : original(command, args),
    );
    await click("[data-change-document]");
    await click("[data-confirm]");
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Edited before replacement",
    );
    expect(root.textContent).toContain(imported.document.name);
    call.mockImplementation(async (command, args) => {
      if (command === "import_document")
        throw "The document could not be read.";
      return original(command, args);
    });
    await click("[data-change-document]");
    await click("[data-confirm]");
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Edited before replacement",
    );
    expect(root.textContent).toContain("The document could not be read.");
  });
  it("confirms switching to pasted text and drops the imported attachment", async () => {
    await newDocument();
    await click('[data-input-mode="paste"]');
    expect(root.querySelector("[data-discard-confirm]")).not.toBeNull();
    await click("[data-confirm]");
    expect(call).toHaveBeenCalledWith("discard_session", undefined);
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(root.querySelector("[data-preview-import]")).toBeNull();
  });
  it("renders hostile filenames and document content as inert text", async () => {
    const hostile =
      '<img src="https://example.invalid/leak" onerror="alert(1)">';
    await newDocument({
      import_document: {
        ...imported,
        document: { ...imported.document, name: hostile },
      },
      open_document_preview: {
        ...imported,
        document: { ...imported.document, name: hostile },
        extracted: {
          ...imported.extracted,
          blocks: [
            { kind: "paragraph", text: hostile },
            { kind: "table", rows: [[hostile]] },
          ],
        },
      },
    });
    expect(root.querySelector("img")).toBeNull();
    await click("[data-preview-import]");
    expect(root.querySelector("img, iframe, object, a")).toBeNull();
    expect(root.textContent).toContain(hostile);
  });
  it("opens original from search independently and restores the query and focus", async () => {
    const note = {
      id: 4,
      patientId: 7,
      patientName: patient.name,
      title: "Synthetic review",
      snippet: "Reviewed outcome",
      createdAt: 1,
      document: imported.document,
    };
    mockLibrary({
      search_notes: [note],
      open_document_preview: { ...imported, id: 99 },
    });
    await mount(true, "notes");
    type("#search", "outcome");
    await submit("form");
    await click('[data-document="4"]');
    expect(call).toHaveBeenCalledWith(
      "open_document_preview",
      expect.objectContaining({ noteId: 4 }),
    );
    expect(call).not.toHaveBeenCalledWith("open_saved_note", expect.anything());
    await click("[data-close-preview]");
    expect(root.querySelector<HTMLInputElement>("#search")!.value).toBe(
      "outcome",
    );
    expect(document.activeElement).toBe(button('[data-document="4"]'));
  });
  it("requests PDF pages lazily and bounds navigation", async () => {
    const pdf = {
      ...imported,
      document: { ...imported.document, name: "synthetic.pdf", format: "pdf" },
      extracted: { ...imported.extracted, pageCount: 2 },
    };
    await newDocument({
      import_document: pdf,
      open_document_preview: { ...pdf, id: 99 },
      document_preview_page: "data:image/png;base64,c3ludGhldGlj",
    });
    await click("[data-preview-import]");
    await flush();
    expect(call).toHaveBeenCalledWith(
      "document_preview_page",
      expect.objectContaining({ id: 99, page: 0, width: 800 }),
    );
    expect(button("[data-page-previous]").disabled).toBe(true);
    await click("[data-page-next]");
    expect(call).toHaveBeenCalledWith(
      "document_preview_page",
      expect.objectContaining({ page: 1 }),
    );
    expect(button("[data-page-next]").disabled).toBe(true);
    expect(root.querySelector("img")!.alt).toBe("Original PDF page 2");
  });
});

it("renders a full-length review with a tail identifier without dropping text", async () => {
  const longSource =
    "No new concerns. ".repeat(5881).padEnd(99_989, " ") + "Alex Morgan";
  const longView: ReviewSession = {
    ...initial,
    source: longSource,
    output: longSource.slice(0, 99_989) + "[PERSON_1]",
    items: [
      {
        ...initial.items[0],
        start: 99_989,
        end: 100_000,
        outputStart: 99_989,
        outputEnd: 99_999,
      },
    ],
  };
  mockLibrary({ detect_text: longView });
  await mount();
  input(longSource);
  const started = performance.now();
  await click("[data-detect]");
  const elapsed = performance.now() - started;
  expect(root.querySelector("[data-source]")!.textContent).toBe(longSource);
  expect(root.querySelector("[data-output]")!.textContent).toBe(
    longView.output,
  );
  expect(root.querySelector("[data-source] mark")!.textContent).toBe(
    "Alex Morgan",
  );
  console.info(
    `Synthetic 100,000-character review render: ${Math.round(elapsed)} ms (jsdom)`,
  );
});

describe("document model selection and usage", () => {
  function fixture(overrides: Record<string, unknown> = {}) {
    mockLibrary({
      list_patient_documents: [],
      list_document_templates: [
        {
          id: 1,
          version: 1,
          name: "GP letter",
          description: "Synthetic",
          instructions: "Use supplied notes",
          archived: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      document_settings: documentSettings,
      ...overrides,
    });
  }
  async function newDocument() {
    await mount(true, "patients");
    await click("[data-open-patient]");
    await click("#tab-documents");
    await click("[data-new-document]");
  }
  function select(selector: string, value: string) {
    const element = root.querySelector<HTMLSelectElement>(selector)!;
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function chooseNotes() {
    type("#document-title", "Synthetic letter");
    const note = root.querySelector<HTMLInputElement>(
      '.choice-list input[type="checkbox"]',
    )!;
    note.checked = true;
    note.dispatchEvent(new Event("change", { bubbles: true }));
  }
  it("starts with the saved default and sends only the per-document override for preparation", async () => {
    fixture({
      prepare_document_submission: () => {
        throw "Clinical sending is not enabled.";
      },
    });
    await newDocument();
    expect(
      root.querySelector<HTMLSelectElement>("#document-model")!.value,
    ).toBe(models[0].id);
    expect(button("[data-review-submission]").disabled).toBe(true);
    select("#document-model", models[1].id);
    chooseNotes();
    expect(button("[data-review-submission]").disabled).toBe(false);
    expect(root.querySelector("[data-selected-notes]")!.textContent).toContain(
      "1 note selected",
    );
    await click("[data-review-submission]");
    expect(call).toHaveBeenCalledWith(
      "prepare_document_submission",
      expect.objectContaining({ model: models[1].id, noteIds: [4] }),
    );
    expect(
      call.mock.calls.some(([command]) => command === "save_document_settings"),
    ).toBe(false);
    expect(
      call.mock.calls.some(
        ([command]) => command === "submit_document_generation",
      ),
    ).toBe(false);
    await click('[data-route="settings"]');
    expect(
      root.querySelector<HTMLSelectElement>('select[name="model"]')!.value,
    ).toBe(models[0].id);
  });
  it("saves a new default and uses it for subsequent documents", async () => {
    let saved = { ...documentSettings };
    fixture({
      document_settings: () => saved,
      save_document_settings: (args: Record<string, unknown>) => {
        saved = { ...saved, openaiModel: String(args.openaiModel) };
        return saved;
      },
    });
    await mount(true, "patients");
    await click('[data-route="settings"]');
    select('select[name="model"]', models[1].id);
    await submit("[data-document-settings]");
    await click('[data-route="patients"]');
    await click("[data-open-patient]");
    await click("#tab-documents");
    await click("[data-new-document]");
    expect(
      root.querySelector<HTMLSelectElement>("#document-model")!.value,
    ).toBe(models[1].id);
  });
  it("shows partial spend without treating unknown costs as zero and filters all time", async () => {
    fixture({
      document_usage: {
        reportsCreated: 2,
        generationAttempts: 4,
        knownCostNanos: 1080000,
        unknownCostAttempts: 1,
        latestCostNanos: null,
      },
    });
    await mount(true, "patients");
    await click('[data-route="settings"]');
    expect(root.textContent).toContain("US$0.00108 + unknown costs");
    expect(root.textContent).toContain("Unavailable — costs unknown");
    expect(call).toHaveBeenCalledWith("document_usage", {
      from: expect.any(Number),
      until: expect.any(Number),
    });
    select("[data-usage-period]", "all");
    await flush();
    expect(call).toHaveBeenLastCalledWith("document_usage", {});
    expect(document.activeElement).toBe(
      root.querySelector("[data-usage-period]"),
    );
  });
  it("shows returned costs, protects an unsaved draft, and saves without another generation", async () => {
    fixture({
      prepare_document_submission: {
        id: "synthetic-result",
        documentId: 8,
        model: models[0].id,
        destination: "https://api.openai.com",
        purpose: "Generate document",
        instructions: "Write from supplied notes",
        input: "⟪CV_synthetic_0001⟫ attended.",
        sourceCount: 1,
        reviewNotes: [
          {
            id: 4,
            title: "Synthetic review",
            reviewedText: "[PERSON_1] attended.",
            createdAt: 1_790_000_000,
          },
        ],
        estimate: {
          inputTokenAllowance: 100,
          outputTokenAllowance: 4096,
          costNanos: 6593600,
        },
      },
      submit_document_generation: {
        documentId: 8,
        text: "Synthetic restored letter.",
        exactReplacements: 1,
        unknownTokens: [],
        usage: {
          ...emptyUsage,
          reportsCreated: 1,
          generationAttempts: 1,
          latestCostNanos: 1080000,
          knownCostNanos: 1080000,
        },
      },
      save_patient_document: { id: 8 },
    });
    await newDocument();
    chooseNotes();
    await click("[data-review-submission]");
    await click("[data-send-document]");
    expect(root.textContent).toContain("Latest generation: US$0.00108");
    await click('[data-route="settings"]');
    expect(root.textContent).toContain("Discard this generated draft?");
    await click("[data-stay]");
    const save = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Save draft",
    )!;
    save.click();
    await flush();
    expect(call).toHaveBeenCalledWith(
      "save_patient_document",
      expect.objectContaining({
        id: 8,
        reviewed: false,
        body: {
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "Synthetic restored letter.", bold: false }],
            },
          ],
        },
      }),
    );
    expect(
      call.mock.calls.filter(
        ([command]) => command === "submit_document_generation",
      ),
    ).toHaveLength(1);
    expect(root.textContent).toContain("Document draft saved.");
  });
  it("opens a saved document in the rich editor and saves a new revision", async () => {
    const savedDocument = {
      id: 8,
      patientId: patient.id,
      title: "Synthetic letter",
      templateId: 1,
      templateName: "GP letter",
      revision: 2,
      body: {
        blocks: [
          {
            kind: "heading",
            runs: [{ text: "Progress", bold: false }],
          },
          {
            kind: "paragraph",
            runs: [
              { text: "Synthetic ", bold: false },
              { text: "review", bold: true },
            ],
          },
        ],
      },
      reviewed: false,
      includeSignature: false,
      createdAt: 1_790_000_000,
      updatedAt: 1_790_000_100,
    };
    fixture({
      list_patient_documents: [
        {
          id: 8,
          patientId: patient.id,
          title: savedDocument.title,
          templateName: savedDocument.templateName,
          revision: savedDocument.revision,
          reviewed: false,
          createdAt: savedDocument.createdAt,
          updatedAt: savedDocument.updatedAt,
          usage: emptyUsage,
        },
      ],
      patient_document: savedDocument,
      update_patient_document: { ...savedDocument, revision: 3 },
    });
    await mount(true, "patients");
    await click("[data-open-patient]");
    await click("#tab-documents");
    await click('[data-open-document="8"]');
    expect(root.querySelector("#edit-document-title")?.textContent).toBe(
      "Edit document",
    );
    expect(root.querySelector(".markdown-editor h2")?.textContent).toBe(
      "Progress",
    );
    expect(root.querySelector(".markdown-editor strong")?.textContent).toBe(
      "review",
    );
    type("#document-edit-title", "Revised synthetic letter");
    await submit("[data-document-edit]");
    expect(call).toHaveBeenCalledWith("update_patient_document", {
      id: 8,
      title: "Revised synthetic letter",
      body: savedDocument.body,
      reviewed: false,
      includeSignature: false,
    });
    expect(root.textContent).toContain("Document updated.");
  });
  it("keeps an unavailable legacy model visible and requires an explicit selection", async () => {
    fixture({
      document_settings: { ...documentSettings, openaiModel: "legacy-model" },
    });
    await newDocument();
    chooseNotes();
    expect(root.textContent).toContain("Saved model unavailable");
    expect(button("[data-review-submission]").disabled).toBe(true);
    select("#document-model", models[0].id);
    expect(button("[data-review-submission]").disabled).toBe(false);
  });
  it("shows the selected model and local estimate before the one-shot send action", async () => {
    fixture({
      prepare_document_submission: {
        id: "synthetic-preparation",
        documentId: 8,
        model: models[1].id,
        destination: "https://api.openai.com",
        purpose: "Generate document",
        instructions:
          "Use only supplied notes.\n\nDocument prompt template:\n## Letter\nUse **British English**.",
        input: "⟪CV_synthetic_0001⟫ attended.",
        sourceCount: 1,
        reviewNotes: [
          {
            id: 4,
            title: "Synthetic review",
            reviewedText: "[PERSON_1] attended.",
            createdAt: 1_790_000_000,
          },
        ],
        estimate: {
          inputTokenAllowance: 100,
          outputTokenAllowance: 4096,
          costNanos: 32968000,
        },
      },
      submit_document_generation: () => {
        throw "Request timed out. Cost unknown.";
      },
    });
    await newDocument();
    select("#document-model", models[1].id);
    chooseNotes();
    await click("[data-review-submission]");
    expect(root.textContent).toContain(
      "Estimated generation allowance: US$0.032968",
    );
    expect(root.textContent).toContain("OpenAI · GPT-4.1");
    expect(root.querySelectorAll("[data-review-note]")).toHaveLength(1);
    expect(root.querySelector("[data-review-note]")?.textContent).toContain(
      "[PERSON_1]",
    );
    expect(root.querySelector("[data-review-note]")?.textContent).not.toContain(
      "CV_synthetic",
    );
    expect(
      root.querySelector(".submission-instructions strong")?.textContent,
    ).toBe("British English");
    expect(
      root.querySelector(".submission-payload pre:last-child")?.textContent,
    ).toContain("CV_synthetic_0001");
    expect(
      call.mock.calls.some(
        ([command]) => command === "submit_document_generation",
      ),
    ).toBe(false);
    await click("[data-send-document]");
    expect(call).toHaveBeenCalledWith("submit_document_generation", {
      preparationId: "synthetic-preparation",
      operation: expect.any(Number),
    });
    expect(root.querySelector("[data-send-document]")).toBeNull();
    expect(root.textContent).toContain("Cost unknown");
  });
});

describe("template editing and settings sections", () => {
  it("records every governance confirmation before enabling clinical sending", async () => {
    mockLibrary({
      document_settings: documentSettings,
      set_clinical_sending_enabled: {
        ...documentSettings,
        clinicalSendingEnabled: true,
      },
    });
    await mount(true, "patients");
    await click('[data-route="settings"]');
    expect(
      root.querySelector<HTMLInputElement>('input[name="apiKey"]')?.placeholder,
    ).toBe("Enter a replacement key");
    expect(
      root.querySelector<HTMLSelectElement>('select[name="model"]')?.value,
    ).toBe(models[0].id);
    const confirmations = [
      ...root.querySelectorAll<HTMLInputElement>("[data-governance-check]"),
    ];
    expect(confirmations).toHaveLength(4);
    expect(button("[data-enable-clinical-sending]").disabled).toBe(true);
    confirmations.forEach((confirmation) => {
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button("[data-enable-clinical-sending]").disabled).toBe(false);
    const model = root.querySelector<HTMLSelectElement>(
      'select[name="model"]',
    )!;
    model.value = models[1].id;
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(button("[data-enable-clinical-sending]").disabled).toBe(true);
    model.value = models[0].id;
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(button("[data-enable-clinical-sending]").disabled).toBe(false);
    await click("[data-enable-clinical-sending]");
    expect(call).toHaveBeenCalledWith("set_clinical_sending_enabled", {
      enabled: true,
      organisationalApproval: true,
      providerTermsReviewed: true,
      dataControlsConfirmed: true,
      rollbackPlanConfirmed: true,
    });
    expect(root.textContent).toContain(
      "Enabled for the recorded configuration",
    );
  });

  it("saves formatted instructions as Markdown and protects unsaved changes", async () => {
    mockLibrary({
      list_document_templates: [],
      create_document_template: { id: 8 },
    });
    await mount(true, "patients");
    await click('[data-route="templates"]');
    await click("[data-new-template]");
    type("#template-name", "Synthetic summary");
    type("#template-description", "Synthetic prompt");
    expect(root.querySelector(".editor-layout .editor-details")).not.toBeNull();
    const toggle = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === "Markdown source",
    )!;
    toggle.click();
    type(".markdown-source", "## Purpose\n\nWrite **only** supplied facts.");
    await click('[data-route="patients"]');
    expect(root.textContent).toContain("Discard these changes?");
    await click("[data-stay]");
    await submit(".template-form");
    expect(call).toHaveBeenCalledWith(
      "create_document_template",
      expect.objectContaining({
        instructions: "## Purpose\n\nWrite **only** supplied facts.",
      }),
    );
  });
  it("keeps unsaved settings through usage refresh and uses full-size labelled controls", async () => {
    mockLibrary({
      document_settings: documentSettings,
      document_usage: {
        reportsCreated: 0,
        generationAttempts: 0,
        knownCostNanos: 0,
        unknownCostAttempts: 0,
        latestCostNanos: null,
      },
    });
    await mount(true, "patients");
    await click('[data-route="settings"]');
    expect(
      root.querySelector('input[name="apiKey"]')?.closest(".field"),
    ).not.toBeNull();
    expect(root.querySelectorAll(".settings-section")).toHaveLength(5);
    type('input[name="displayName"]', "Dr Synthetic");
    const period = root.querySelector<HTMLSelectElement>(
      "[data-usage-period]",
    )!;
    period.value = "all";
    period.dispatchEvent(new Event("change"));
    await flush();
    expect(
      root.querySelector<HTMLInputElement>('input[name="displayName"]')?.value,
    ).toBe("Dr Synthetic");
  });
});
