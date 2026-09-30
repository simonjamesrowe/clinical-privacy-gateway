import MarkdownIt from "markdown-it";
import { Schema, DOMSerializer } from "prosemirror-model";
import {
  EditorState,
  AllSelection,
  TextSelection,
  type Command,
} from "prosemirror-state";
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
import {
  joinAt,
  textareaTarget,
  type DictationMark,
  type DictationTarget,
  type FieldLimit,
} from "./dictation";
import type {
  PatientDocumentBlock,
  PatientDocumentBody,
  PatientDocumentRun,
} from "./types";

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

function documentRuns(
  node: import("prosemirror-model").Node,
): PatientDocumentRun[] {
  const runs: PatientDocumentRun[] = [];
  node.descendants((child) => {
    if (child.isText) {
      const run = {
        text: child.text ?? "",
        bold: child.marks.some((mark) => mark.type === schema.marks.strong),
      };
      const previous = runs.at(-1);
      if (previous?.bold === run.bold) previous.text += run.text;
      else runs.push(run);
    } else if (child.type === schema.nodes.hard_break) {
      const previous = runs.at(-1);
      if (previous?.bold === false) previous.text += "\n";
      else runs.push({ text: "\n", bold: false });
    }
    return true;
  });
  return runs.length ? runs : [{ text: "", bold: false }];
}

export function markdownToDocumentBody(markdown: string): PatientDocumentBody {
  const blocks: PatientDocumentBlock[] = [];
  const addList = (list: import("prosemirror-model").Node) => {
    list.forEach((item) => {
      item.forEach((child) => {
        if (child.type === schema.nodes.paragraph)
          blocks.push({ kind: "bulleted_list", runs: documentRuns(child) });
        else if (child.type === schema.nodes.bullet_list) addList(child);
      });
    });
  };
  parser.parse(markdown).forEach((node) => {
    if (node.type === schema.nodes.heading)
      blocks.push({ kind: "heading", runs: documentRuns(node) });
    else if (node.type === schema.nodes.bullet_list) addList(node);
    else if (node.type === schema.nodes.paragraph)
      blocks.push({ kind: "paragraph", runs: documentRuns(node) });
    else blocks.push({ kind: "paragraph", runs: documentRuns(node) });
  });
  return {
    blocks: blocks.length
      ? blocks
      : [{ kind: "paragraph", runs: [{ text: "", bold: false }] }],
  };
}

export function documentBodyToMarkdown(body: PatientDocumentBody): string {
  const inline = (runs: PatientDocumentRun[]) =>
    runs.flatMap((run) => {
      if (!run.text) return [];
      return [
        schema.text(
          run.text,
          run.bold ? [schema.marks.strong.create()] : undefined,
        ),
      ];
    });
  const nodes: import("prosemirror-model").Node[] = [];
  for (let index = 0; index < body.blocks.length; ) {
    const block = body.blocks[index];
    if (block.kind === "bulleted_list") {
      const items: import("prosemirror-model").Node[] = [];
      while (body.blocks[index]?.kind === "bulleted_list") {
        items.push(
          schema.nodes.list_item.create(
            null,
            schema.nodes.paragraph.create(
              null,
              inline(body.blocks[index].runs),
            ),
          ),
        );
        index += 1;
      }
      nodes.push(schema.nodes.bullet_list.create(null, items));
      continue;
    }
    nodes.push(
      block.kind === "heading"
        ? schema.nodes.heading.create({ level: 2 }, inline(block.runs))
        : schema.nodes.paragraph.create(null, inline(block.runs)),
    );
    index += 1;
  }
  const document = schema.nodes.doc.create(
    null,
    nodes.length ? nodes : [schema.nodes.paragraph.create()],
  );
  return defaultMarkdownSerializer.serialize(document);
}

// Local SVG paths share the app's stroke weight; no icon font or remote assets.
const editorIcons = {
  paragraph: "M13 4v16m5-16v16M18 4H9a5 5 0 0 0 0 10h4",
  heading: "M4 5v14M14 5v14M4 12h10M18 16a2 2 0 0 1 4 0c0 2-4 2-4 5h4",
  bold: "M6 4h7a4 4 0 0 1 0 8H6V4Zm0 8h8a4 4 0 0 1 0 8H6v-8Z",
  italic: "M10 4h10M4 20h10M15 4 9 20",
  list: "M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01",
  undo: "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12",
  redo: "m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12",
  source: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
  edit: "m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4",
} as const;
function editorIcon(name: keyof typeof editorIcons): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", editorIcons[name]);
  svg.append(path);
  return svg;
}

export function markdownEditor(
  value: string,
  onChange: (markdown: string) => void,
  options: { document?: boolean } = {},
): {
  element: HTMLElement;
  destroy: () => void;
  dictationTarget: (limit: FieldLimit) => DictationTarget;
} {
  const host = h("div", { class: "markdown-editor__surface" });
  const source = h("textarea", {
    class: "markdown-source",
    "aria-label": options.document
      ? "Document Markdown"
      : "Instructions Markdown",
    spellcheck: false,
    value,
  });
  let markdown = value;
  let sourceMode = false;
  // A dictation recording owns the insertion point: no editing, formatting or mode switch.
  let busy = false;
  let refreshToolbar = () => {};
  const createState = (text: string) =>
    EditorState.create({
      doc: parser.parse(text),
      plugins: [
        history(),
        keymap({
          "Mod-b": toggleMark(schema.marks.strong),
          ...(options.document ? {} : { "Mod-i": toggleMark(schema.marks.em) }),
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
      "aria-label": options.document ? "Document content" : "Instructions",
      "aria-multiline": "true",
      class: "formatted-text",
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
      refreshToolbar();
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
  const controls: {
    button: HTMLButtonElement;
    command: Command;
    active?: () => boolean;
  }[] = [];
  const blockActive = (name: string) => {
    const { $from } = TextSelection.near(view.state.selection.$from);
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type === schema.nodes[name]) return true;
    return false;
  };
  const markActive = (name: string) => {
    const { from, to, empty, $from } = view.state.selection;
    const mark = schema.marks[name];
    return empty
      ? Boolean(mark.isInSet(view.state.storedMarks ?? $from.marks()))
      : view.state.doc.rangeHasMark(from, to, mark);
  };
  const button = (
    label: string,
    icon: keyof typeof editorIcons,
    command: Command,
    active?: () => boolean,
    shortcut?: string,
  ) => {
    const control = h(
      "button",
      {
        type: "button",
        class: "editor-tool",
        "aria-label": label,
        title: shortcut ? `${label} (${shortcut})` : label,
        "aria-pressed": active ? "false" : null,
        onmousedown: (event) => event.preventDefault(),
        onclick: () => {
          if (view.state.selection instanceof AllSelection) {
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.between(
                  view.state.doc.resolve(0),
                  view.state.doc.resolve(view.state.doc.content.size),
                ),
              ),
            );
          }
          command(view.state, view.dispatch, view);
          view.focus();
        },
      },
      editorIcon(icon),
    );
    controls.push({ button: control, command, active });
    return control;
  };
  const formatting = h(
    "div",
    {
      class: "editor-tool-group",
      role: "group",
      "aria-label": "Text formatting",
    },
    button("Paragraph", "paragraph", setBlockType(schema.nodes.paragraph), () =>
      blockActive("paragraph"),
    ),
    button(
      "Heading",
      "heading",
      setBlockType(schema.nodes.heading, { level: 2 }),
      () => blockActive("heading"),
    ),
    h("span", { class: "editor-tool-divider", "aria-hidden": "true" }),
    button(
      "Bold",
      "bold",
      toggleMark(schema.marks.strong),
      () => markActive("strong"),
      "⌘B",
    ),
    !options.document &&
      button(
        "Italic",
        "italic",
        toggleMark(schema.marks.em),
        () => markActive("em"),
        "⌘I",
      ),
    button(
      "Bullet list",
      "list",
      (state, dispatch) =>
        blockActive("bullet_list")
          ? liftListItem(schema.nodes.list_item)(state, dispatch)
          : wrapInList(schema.nodes.bullet_list)(state, dispatch),
      () => blockActive("bullet_list"),
    ),
    h("span", { class: "editor-tool-divider", "aria-hidden": "true" }),
    button("Undo", "undo", undo, undefined, "⌘Z"),
    button("Redo", "redo", redo, undefined, "⇧⌘Z"),
  );
  refreshToolbar = () => {
    for (const { button, command, active } of controls) {
      const pressed = active?.() ?? false;
      if (active) button.setAttribute("aria-pressed", String(pressed));
      button.disabled = busy || (!pressed && !command(view.state));
    }
  };
  refreshToolbar();
  const toggle = h(
    "button",
    {
      type: "button",
      class: "editor-tool",
      "aria-label": "Markdown source",
      title: "Markdown source",
      "aria-pressed": "false",
      onclick: () => {
        sourceMode = !sourceMode;
        if (!sourceMode) view.updateState(createState(markdown));
        host.hidden = sourceMode;
        source.hidden = !sourceMode;
        formatting.hidden = sourceMode;
        const label = sourceMode ? "Formatted editor" : "Markdown source";
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
        toggle.replaceChildren(editorIcon(sourceMode ? "edit" : "source"));
        refreshToolbar();
        toggle.setAttribute("aria-pressed", String(sourceMode));
        if (sourceMode) source.focus();
        else view.focus();
      },
    },
    editorIcon("source"),
  );
  source.hidden = true;
  const element = h(
    "div",
    { class: "markdown-editor" },
    h("div", { class: "editor-toolbar" }, formatting, toggle),
    host,
    source,
    h(
      "p",
      { class: "hint" },
      options.document
        ? "Headings, bold and lists are saved in the document. ⌘B bold."
        : "Headings, bold and lists are saved as Markdown. ⌘B bold · ⌘I italic.",
    ),
  );
  type Snapshot = { source: boolean; markdown: string; inner?: unknown };
  const dictationTarget = (limit: FieldLimit): DictationTarget => {
    const text = textareaTarget(source, limit);
    const inner = (mark: DictationMark): DictationMark => ({
      ...mark,
      snapshot: (mark.snapshot as Snapshot).inner,
    });
    return {
      element,
      begin: () => {
        if (sourceMode) {
          const mark = text.begin();
          return {
            ...mark,
            snapshot: { source: true, markdown, inner: mark.snapshot },
          };
        }
        const { selection } = view.state;
        const start = TextSelection.near(selection.$from, 1).from;
        const end = selection.empty
          ? start
          : Math.max(start, TextSelection.near(selection.$to, -1).to);
        return { start, end, snapshot: { source: false, markdown } };
      },
      insert: (mark, spoken) => {
        const snapshot = mark.snapshot as Snapshot;
        if (snapshot.source) {
          const next = text.insert(inner(mark), spoken);
          return next && { ...next, snapshot };
        }
        const { doc } = view.state;
        const size = doc.content.size;
        const $from = TextSelection.near(
          doc.resolve(Math.min(mark.start, size)),
          1,
        ).$from;
        const from = $from.pos;
        const $to = doc.resolve(Math.min(Math.max(mark.end, from), size));
        const before =
          $from.parentOffset === 0 ? "" : doc.textBetween(from - 1, from);
        const after =
          $to.parentOffset === $to.parent.content.size
            ? ""
            : doc.textBetween($to.pos, $to.pos + 1);
        const insertion = joinAt(before, spoken, after);
        const transaction = view.state.tr.insertText(insertion, from, $to.pos);
        const next = defaultMarkdownSerializer.serialize(
          view.state.apply(transaction).doc,
        );
        if (limit.measure(next) > limit.max) return null;
        view.dispatch(transaction);
        const end = from + insertion.length;
        return { ...mark, start: end, end };
      },
      restore: (mark) => {
        const snapshot = mark.snapshot as Snapshot;
        if (snapshot.source) return text.restore(inner(mark));
        markdown = snapshot.markdown;
        source.value = markdown;
        view.updateState(createState(markdown));
        refreshToolbar();
        onChange(markdown);
      },
      setBusy: (next) => {
        busy = next;
        view.setProps({ editable: () => !busy });
        view.dom.setAttribute("aria-busy", String(busy));
        text.setBusy(next);
        toggle.disabled = busy;
        refreshToolbar();
      },
      settle: (mark) => {
        if ((mark.snapshot as Snapshot).source) return text.settle(inner(mark));
        const { doc } = view.state;
        const at = doc.resolve(Math.min(mark.start, doc.content.size));
        view.focus();
        view.dispatch(view.state.tr.setSelection(TextSelection.near(at, -1)));
      },
      describe: (id) => {
        text.describe(id);
        const ids = (view.dom.getAttribute("aria-describedby") ?? "")
          .split(" ")
          .filter((value) => value && value !== id);
        view.dom.setAttribute("aria-describedby", [...ids, id].join(" "));
      },
    };
  };
  return { element, destroy: () => view.destroy(), dictationTarget };
}
