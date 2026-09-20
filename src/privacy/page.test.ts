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

describe("text review", () => {
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
    reject("Operation cancelled.");
    await flush();
    expect(root.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      source,
    );
    expect(button("[data-home]").disabled).toBe(false);
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
