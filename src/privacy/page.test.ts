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
async function mount(available = true) {
  const bridge: PrivacyBridge = {
    available,
    call: <T>(command: string, args?: Record<string, unknown>) =>
      call(command, args) as Promise<T>,
    progress: async (cb) => {
      progress = cb;
      return unsubscribe;
    },
  };
  page = new TextReviewPage(root, bridge, vi.fn());
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
    if (command === "review_decision") {
      view = {
        ...view,
        revision: view.revision + 1,
        pending: 0,
        checked: false,
        items: view.items.map((i) => ({
          ...i,
          decision: args?.decision,
          replacement: args?.replacement,
        })),
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
  it("keeps verification incomplete when a model download fails and bounds its progress", async () => {
    call.mockResolvedValueOnce({
      installed: false,
      name: "BERT",
      bytes: 110,
      revision: "fixture",
    });
    await mount();
    let reject!: (error: string) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    button("[data-install]").click();
    expect(progressBar().getAttribute("aria-label")).toBe(
      "Model download progress",
    );
    progress({
      operation: 1,
      stage: "Downloading model",
      completed: 55,
      total: 110,
    });
    expect(progressBar().value).toBe(50);
    progress({
      operation: 1,
      stage: "Downloading model",
      completed: 120,
      total: 110,
    });
    expect(progressBar().value).toBe(100);
    expect(stepStates()[0]).toBe("current");
    reject("Model download failed.");
    await flush();
    expect(progressBar().hidden).toBe(true);
    expect(stepStates()).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(button("[data-install]").disabled).toBe(false);
    expect(
      root.querySelector(".workflow-panel [data-error]")!.textContent,
    ).toBe("Model download failed.");
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
    expect(call).toHaveBeenLastCalledWith(
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
    expect(call).toHaveBeenLastCalledWith(
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
    expect(progressBar().hasAttribute("value")).toBe(false);
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
  });
  it("does not complete the final stage when a rescan fails or discovers another proposal", async () => {
    await mount();
    await detect();
    await click('[data-action="accept"]');
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "complete",
      "current",
    ]);
    let reject!: (value: string) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    button("[data-rescan]").click();
    expect(progressBar().getAttribute("aria-label")).toBe(
      "Final check progress",
    );
    expect(progressBar().hidden).toBe(false);
    reject("The final check could not finish.");
    await flush();
    expect(progressBar().hidden).toBe(true);
    expect(stepStates()[3]).toBe("current");
    expect(button("[data-copy]").disabled).toBe(true);
    call.mockResolvedValueOnce(initial);
    await click("[data-rescan]");
    expect(stepStates()).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
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
  it("requires decisions and a successful rescan before requesting native copy", async () => {
    await mount();
    await detect();
    expect(button("[data-copy]").disabled).toBe(true);
    expect(button("[data-rescan]").disabled).toBe(true);
    await click('[data-action="accept"]');
    expect(button("[data-copy]").disabled).toBe(true);
    expect(button("[data-rescan]").disabled).toBe(false);
    await click("[data-rescan]");
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
    await click("[data-rescan]");
    const label = root.querySelector<HTMLInputElement>("[data-label]")!;
    label.value = "[CLIENT]";
    label.dispatchEvent(new Event("input"));
    expect(button("[data-copy]").disabled).toBe(true);
    await click('[data-action="edit"]');
    expect(call).toHaveBeenLastCalledWith(
      "review_decision",
      expect.objectContaining({ replacement: "[CLIENT]", decision: "edit" }),
    );
    expect(button("[data-copy]").disabled).toBe(true);
    expect(button("[data-rescan]").disabled).toBe(false);
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
    await click('[data-action="accept"]');
    call.mockRejectedValueOnce("The final check could not finish.");
    await click("[data-rescan]");
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
