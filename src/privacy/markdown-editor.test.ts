// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { markdownEditor, renderMarkdown } from "./markdown-editor";
describe("local Markdown editor", () => {
  it("round trips headings, bold and lists through source and formatted views", () => {
    const change = vi.fn();
    const editor = markdownEditor(
      "## Summary\n\n**Synthetic** notes\n\n- First\n- Second",
      change,
    );
    document.body.append(editor.element);
    expect(editor.element.querySelector("h2")?.textContent).toBe("Summary");
    expect(editor.element.querySelector("strong")?.textContent).toBe(
      "Synthetic",
    );
    expect(editor.element.querySelectorAll("li")).toHaveLength(2);
    const toggle = [...editor.element.querySelectorAll("button")].find(
      (button) => button.textContent === "Markdown source",
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
