import MarkdownIt from "markdown-it";
import { Schema, DOMSerializer } from "prosemirror-model";
import { EditorState, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  MarkdownParser,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { baseKeymap, setBlockType, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, undo, redo } from "prosemirror-history";
import {
  wrapInList,
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";
import { h } from "./dom";

// No image or link nodes: formatted text cannot load remote content, even when pasted.
const schema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes
    .remove("image")
    .update("heading", {
      ...defaultMarkdownParser.schema.spec.nodes.get("heading")!,
      content: "text*",
    }),
  marks: defaultMarkdownParser.schema.spec.marks.remove("link"),
});
const tokens = { ...defaultMarkdownParser.tokens };
delete tokens.image;
delete tokens.link;
const parser = new MarkdownParser(
  schema,
  new MarkdownIt("commonmark", { html: false }).disable([
    "image",
    "link",
    "autolink",
  ]),
  tokens,
);
export function renderMarkdown(text: string): HTMLElement {
  const node = h("div", { class: "formatted-text" });
  node.append(
    DOMSerializer.fromSchema(schema).serializeFragment(
      parser.parse(text).content,
    ),
  );
  return node;
}

export function markdownEditor(
  value: string,
  onChange: (markdown: string) => void,
): { element: HTMLElement; destroy: () => void } {
  const host = h("div", { class: "markdown-editor__surface" });
  const source = h("textarea", {
    class: "markdown-source",
    "aria-label": "Instructions Markdown",
    spellcheck: false,
    value,
  });
  let markdown = value;
  let sourceMode = false;
  const createState = (text: string) =>
    EditorState.create({
      doc: parser.parse(text),
      plugins: [
        history(),
        keymap({
          "Mod-b": toggleMark(schema.marks.strong),
          "Mod-i": toggleMark(schema.marks.em),
          "Mod-z": undo,
          "Mod-Shift-z": redo,
          Enter: splitListItem(schema.nodes.list_item),
          Tab: sinkListItem(schema.nodes.list_item),
          "Shift-Tab": liftListItem(schema.nodes.list_item),
        }),
        keymap(baseKeymap),
      ],
    });
  const view = new EditorView(host, {
    state: createState(value),
    // Use the text clipboard flavour before ProseMirror can instantiate HTML.
    handleDOMEvents: {
      paste(editor, event) {
        event.preventDefault();
        editor.pasteText(
          event.clipboardData?.getData("text/plain") ?? "",
          event,
        );
        return true;
      },
    },
    // HTML-only drag/drop content must not instantiate remote resources either.
    transformPastedHTML: () => "",
    attributes: {
      role: "textbox",
      "aria-label": "Instructions",
      "aria-multiline": "true",
      class: "formatted-text",
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
      if (transaction.docChanged) {
        markdown = defaultMarkdownSerializer.serialize(view.state.doc);
        source.value = markdown;
        onChange(markdown);
      }
    },
  });
  source.addEventListener("input", () => {
    markdown = source.value;
    onChange(markdown);
  });
  const button = (label: string, command: Command) =>
    h(
      "button",
      {
        type: "button",
        class: "button button--compact",
        "aria-label": label,
        onmousedown: (event) => event.preventDefault(),
        onclick: () => {
          command(view.state, view.dispatch, view);
          view.focus();
        },
      },
      label,
    );
  const formatting = h(
    "div",
    { class: "page-actions", role: "group", "aria-label": "Text formatting" },
    button("Paragraph", setBlockType(schema.nodes.paragraph)),
    button("Heading", setBlockType(schema.nodes.heading, { level: 2 })),
    button("Bold", toggleMark(schema.marks.strong)),
    button("Italic", toggleMark(schema.marks.em)),
    button("Bullet list", wrapInList(schema.nodes.bullet_list)),
    button("Undo", undo),
    button("Redo", redo),
  );
  const toggle = h(
    "button",
    {
      type: "button",
      class: "button button--compact",
      "aria-pressed": "false",
      onclick: () => {
        sourceMode = !sourceMode;
        if (!sourceMode) view.updateState(createState(markdown));
        host.hidden = sourceMode;
        source.hidden = !sourceMode;
        formatting.hidden = sourceMode;
        toggle.textContent = sourceMode
          ? "Formatted editor"
          : "Markdown source";
        toggle.setAttribute("aria-pressed", String(sourceMode));
        if (sourceMode) source.focus();
        else view.focus();
      },
    },
    "Markdown source",
  );
  source.hidden = true;
  return {
    element: h(
      "div",
      { class: "markdown-editor" },
      h("div", { class: "editor-toolbar" }, formatting, toggle),
      host,
      source,
      h(
        "p",
        { class: "hint" },
        "Headings, bold and lists are saved as Markdown. ⌘B bold · ⌘I italic.",
      ),
    ),
    destroy: () => view.destroy(),
  };
}
