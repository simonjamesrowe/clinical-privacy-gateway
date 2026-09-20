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
import { TextReviewPage } from "./page";
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
  initialScreen: "patients" | "review" | "notes" = "review",
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

describe("text review", () => {
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
    root
      .querySelector<HTMLButtonElement>("[data-patient-list] button")!
      .click();
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
  it("confirms patient deletion before removing their encrypted records", async () => {
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
    const actions = root.querySelectorAll<HTMLButtonElement>(
      "[data-patient-list] button",
    );
    actions[1].click();
    await flush();
    expect(root.querySelector("dialog")?.textContent).toContain(
      "Are you really sure you want to delete this?",
    );
    await click("[data-cancel-delete]");
    expect(call).not.toHaveBeenCalledWith("delete_patient", expect.anything());

    actions[1].click();
    await flush();
    await click("[data-confirm-delete]");
    expect(call).toHaveBeenCalledWith("delete_patient", { id: 7 });
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
    expect(root.querySelector(".notes-table")?.textContent).toContain(
      "Patient number",
    );
    expect(root.querySelector(".notes-table")?.textContent).toContain(
      "Synthetic review",
    );
    await click(".notes-table button");
    expect(root.querySelector("#review-title")?.textContent).toBe(
      "De-identify text",
    );
    expect(root.querySelector("[data-source]")?.textContent).toBe(source);
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
    root.querySelectorAll<HTMLButtonElement>(".notes-table button")[1].click();
    await flush();
    expect(root.querySelector("dialog")?.textContent).toContain(
      "Are you really sure you want to delete this?",
    );
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
    call.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    button("[data-install]").click();
    await flush();
    expect(root.querySelector("#settings-title")?.textContent).toBe("Settings");
    button("[data-settings-install]").click();
    progress({
      operation: 1,
      stage: "Downloading model",
      completed: 55,
      total: 110,
    });
    expect(
      root.querySelector<HTMLProgressElement>("[data-overlay-progress]")!.value,
    ).toBe(50);
    progress({
      operation: 1,
      stage: "Downloading model",
      completed: 120,
      total: 110,
    });
    expect(
      root.querySelector<HTMLProgressElement>("[data-overlay-progress]")!.value,
    ).toBe(100);
    expect(root.querySelector("[data-overlay]")?.hasAttribute("hidden")).toBe(
      false,
    );
    reject("Model download failed.");
    await flush();
    expect(root.querySelector("[data-overlay]")?.hasAttribute("hidden")).toBe(
      true,
    );
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
    const mappings = root.querySelector<HTMLButtonElement>(
      '[data-route="mappings"]',
    )!;
    mappings.click();
    await flush();
    expect(root.querySelector("#mappings-title")?.textContent).toBe(
      "Identifier mappings",
    );
    expect(root.textContent).toContain("No saved defaults yet.");
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
    expect(root.querySelector<HTMLElement>("[data-overlay]")!.hidden).toBe(
      false,
    );
    expect(root.querySelector<HTMLElement>(".review-page")!.inert).toBe(true);
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
    expect(root.querySelector<HTMLElement>("[data-overlay]")!.hidden).toBe(
      true,
    );
    expect(root.querySelector<HTMLElement>(".review-page")!.inert).toBe(false);
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
    input("🩺".repeat(20_000));
    expect(button("[data-detect]").disabled).toBe(false);
    input("🩺".repeat(20_001));
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
    const dialog = root.querySelector("dialog");
    resolve({
      installed: true,
      name: "BERT",
      bytes: 110_000_000,
      revision: "fixture",
    });
    await mounting;
    expect(root.querySelector("dialog")).toBe(dialog);
    expect(dialog?.open).toBe(true);
    await click("[data-stay]");
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
});
