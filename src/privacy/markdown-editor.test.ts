// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  documentBodyToMarkdown,
  markdownEditor,
  markdownToDocumentBody,
  renderMarkdown,
} from "./markdown-editor";
describe("local Markdown editor", () => {
  it("round trips headings, bold and lists through source and formatted views", () => {
    const change = vi.fn();
    const editor = markdownEditor(
      "## Summary\n\n**Synthetic** notes\n\n- First\n- Second",
      change,
    );
    document.body.append(editor.element);
    expect(editor.element.querySelector("h2")?.textContent).toBe("Summary");
    const heading = editor.element.querySelector<HTMLButtonElement>(
      '[aria-label="Heading"]',
    )!;
    expect(heading.querySelector("svg")).not.toBeNull();
    expect(heading.title).toBe("Heading");
    expect(heading.getAttribute("aria-pressed")).toBe("true");
    expect(
      editor.element.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!
        .disabled,
    ).toBe(true);
    const bold = editor.element.querySelector<HTMLButtonElement>(
      '[aria-label="Bold"]',
    )!;
    bold.click();
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    bold.click();
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    expect(editor.element.querySelector("strong")?.textContent).toBe(
      "Synthetic",
    );
    expect(editor.element.querySelectorAll("li")).toHaveLength(2);
    const toggle = [...editor.element.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Markdown source",
    )!;
    toggle.click();
    const source = editor.element.querySelector("textarea")!;
    source.value = "## Revised\n\n**Bold** text";
    source.dispatchEvent(new Event("input"));
    toggle.click();
    expect(change).toHaveBeenLastCalledWith(source.value);
    expect(editor.element.querySelector("h2")?.textContent).toBe("Revised");
    editor.destroy();
    editor.element.remove();
  });
  it("pastes clipboard text without creating HTML resources", () => {
    const editor = markdownEditor("", () => {});
    document.body.append(editor.element);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/plain"
            ? "Synthetic pasted text"
            : '<img src="https://example.invalid/private">',
      },
    });
    editor.element.querySelector(".ProseMirror")!.dispatchEvent(event);
    expect(editor.element.querySelector(".ProseMirror")?.textContent).toBe(
      "Synthetic pasted text",
    );
    expect(editor.element.querySelector("img")).toBeNull();
    editor.destroy();
    editor.element.remove();
  });
  it("round trips the constrained saved-document format", () => {
    const body = {
      blocks: [
        {
          kind: "heading" as const,
          runs: [{ text: "Summary", bold: false }],
        },
        {
          kind: "paragraph" as const,
          runs: [
            { text: "Synthetic ", bold: false },
            { text: "progress", bold: true },
          ],
        },
        {
          kind: "bulleted_list" as const,
          runs: [{ text: "Continue review", bold: false }],
        },
      ],
    };
    const markdown = documentBodyToMarkdown(body);
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("**progress**");
    expect(markdown).toContain("* Continue review");
    expect(markdownToDocumentBody(markdown)).toEqual(body);
    const editor = markdownEditor(markdown, () => {}, { document: true });
    expect(editor.element.querySelector('[aria-label="Italic"]')).toBeNull();
    editor.destroy();
  });
  it("renders HTML, images and URLs as inert text with no resource-bearing nodes", () => {
    const node = renderMarkdown(
      "<script>alert(1)</script>\n\n![Private](https://example.invalid/leak)\n\n[link](https://example.invalid)",
    );
    expect(node.querySelector("script,img,a,iframe,style")).toBeNull();
    expect(node.textContent).toContain("<script>");
    expect(node.textContent).toContain("https://example.invalid/leak");
  });
  it("handles 100,000 characters of adversarial bracket text", () => {
    const input = "[".repeat(100_000);
    expect(renderMarkdown(input).textContent).toBe(input);
  });
});

describe("dictation into the formatted editor", () => {
  const limit = {
    max: 8_000,
    measure: (text: string) => Array.from(text).length,
  };

  it("inserts at the caret with spacing, blocks editing while busy and restores", () => {
    const change = vi.fn();
    const editor = markdownEditor("## Summary\n\nSeen today.", change);
    document.body.append(editor.element);
    const target = editor.dictationTarget(limit);
    const surface = editor.element.querySelector<HTMLElement>(
      ".markdown-editor__surface [contenteditable]",
    )!;
    // The caret starts at the beginning of the document.
    let mark = target.begin();
    target.setBusy(true);
    expect(surface.getAttribute("contenteditable")).toBe("false");
    expect(
      [...editor.element.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    mark = target.insert(mark, "Letter for the GP.")!;
    expect(change).toHaveBeenLastCalledWith(
      "## Letter for the GP. Summary\n\nSeen today.",
    );
    mark = target.insert(mark, "Keep it brief.")!;
    expect(change).toHaveBeenLastCalledWith(
      "## Letter for the GP. Keep it brief. Summary\n\nSeen today.",
    );
    target.setBusy(false);
    expect(surface.getAttribute("contenteditable")).toBe("true");
    target.restore(mark);
    expect(change).toHaveBeenLastCalledWith("## Summary\n\nSeen today.");
    expect(editor.element.querySelector("h2")?.textContent).toBe("Summary");
    editor.destroy();
    editor.element.remove();
  });

  it("refuses text that would take the Markdown over its limit", () => {
    const change = vi.fn();
    const editor = markdownEditor("Seen today.", change);
    document.body.append(editor.element);
    const target = editor.dictationTarget({ max: 20, measure: limit.measure });
    const mark = target.begin();
    expect(target.insert(mark, "A much longer dictated sentence.")).toBeNull();
    expect(change).not.toHaveBeenCalled();
    editor.destroy();
    editor.element.remove();
  });

  it("dictates into the Markdown source when the source view is open", () => {
    const change = vi.fn();
    const editor = markdownEditor("Seen today.", change);
    document.body.append(editor.element);
    const target = editor.dictationTarget(limit);
    [...editor.element.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-label") === "Markdown source")!
      .click();
    const source = editor.element.querySelector("textarea")!;
    source.setSelectionRange(source.value.length, source.value.length);
    const mark = target.begin();
    target.setBusy(true);
    expect(source.readOnly).toBe(true);
    target.insert(mark, "Plan reviewed.");
    expect(change).toHaveBeenLastCalledWith("Seen today. Plan reviewed.");
    target.restore(mark);
    expect(change).toHaveBeenLastCalledWith("Seen today.");
    target.describe("strip");
    expect(source.getAttribute("aria-describedby")).toBe("strip");
    editor.destroy();
    editor.element.remove();
  });
});
