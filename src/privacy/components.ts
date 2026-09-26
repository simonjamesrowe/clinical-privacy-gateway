// Builders for the design-system components in src/styles/components.css.
// Each returns the markup documented in design-system/index.html.
import { h, searchIcon } from "./dom";
import type { DocumentBlock } from "./types";

type Content = Node | string | false | null | undefined;

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function pageHeader(options: {
  eyebrow: string;
  title: Content[];
  id?: string;
  description?: string;
  actions?: Content[];
}): HTMLElement {
  return h(
    "header",
    { class: "page-header" },
    h(
      "div",
      {},
      h("p", { class: "eyebrow" }, options.eyebrow),
      h(
        "h1",
        { class: "page-title", id: options.id, tabindex: "-1" },
        ...options.title,
      ),
      options.description && h("p", { class: "muted" }, options.description),
    ),
    h("div", { class: "page-actions" }, ...(options.actions ?? [])),
  );
}

export function breadcrumb(
  items: { label: string; onSelect?: () => void }[],
): HTMLElement {
  return h(
    "nav",
    { "aria-label": "Breadcrumb" },
    h(
      "ol",
      { class: "breadcrumb" },
      ...items.map((item) =>
        h(
          "li",
          {},
          item.onSelect
            ? h(
                "button",
                {
                  type: "button",
                  class: "link-button",
                  onclick: item.onSelect,
                },
                item.label,
              )
            : h("span", { "aria-current": "page" }, item.label),
        ),
      ),
    ),
  );
}

/** Search runs only on Enter or the Search button, never while typing. */
export function searchForm(options: {
  label: string;
  placeholder: string;
  value: string;
  onSearch: (query: string) => void;
}): HTMLFormElement {
  const input = h("input", {
    id: "search",
    type: "search",
    placeholder: options.placeholder,
    value: options.value,
    autocomplete: "off",
    spellcheck: "false",
  });
  return h(
    "form",
    {
      class: "search",
      role: "search",
      "data-search": true,
      onsubmit: (event: Event) => {
        event.preventDefault();
        options.onSearch(input.value.trim());
      },
    },
    h("label", { class: "visually-hidden", for: "search" }, options.label),
    input,
    h(
      "button",
      { type: "submit", class: "button search__button" },
      searchIcon(),
      "Search",
    ),
  );
}

export function searchStatus(options: {
  shown: number;
  total?: number;
  noun: string;
  query: string;
  onClear: () => void;
}): HTMLElement {
  if (!options.query)
    return h(
      "span",
      { class: "meta muted", role: "status" },
      plural(options.total ?? options.shown, options.noun),
    );
  const count =
    options.total === undefined
      ? plural(options.shown, options.noun)
      : `${options.shown} of ${plural(options.total, options.noun)}`;
  return h(
    "span",
    { class: "meta muted", role: "status" },
    `${count} match “${options.query}” · `,
    h(
      "button",
      {
        type: "button",
        class: "link-button",
        "data-clear-search": true,
        onclick: options.onClear,
      },
      "Clear search",
    ),
  );
}

export function toolbar(...children: Content[]): HTMLElement {
  return h("div", { class: "table-toolbar" }, ...children);
}

export function emptyState(
  title: string,
  text: string,
  action?: Content,
): HTMLElement {
  return h(
    "div",
    { class: "empty-state" },
    h("p", { class: "section-title" }, title),
    h("p", { class: "muted" }, text),
    action,
  );
}

export function dataTable(
  headers: { label: string; narrow?: boolean; hidden?: boolean }[],
  rows: Node[],
): HTMLTableElement {
  return h(
    "table",
    { class: "data-table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ...headers.map((header) =>
          h(
            "th",
            { class: header.narrow ? "hide-narrow" : undefined },
            header.hidden
              ? h("span", { class: "visually-hidden" }, header.label)
              : header.label,
          ),
        ),
      ),
    ),
    h("tbody", {}, ...rows),
  );
}

/** Opens a row's item unless the click landed on a control inside it. */
export function rowOpener(open: () => void): (event: Event) => void {
  return (event) => {
    if (!(event.target as Element).closest("button, input, select, a")) open();
  };
}

export function confirmRow(options: {
  colspan: number;
  subject: string;
  consequence: string;
  onCancel: () => void;
  onConfirm: () => void;
}): HTMLTableRowElement {
  return h(
    "tr",
    { class: "confirm-row" },
    h(
      "td",
      { colspan: options.colspan },
      confirmation({ ...options, compact: true }),
    ),
  );
}

/** Deletion asks the same question everywhere and states its consequence. */
export function confirmation(options: {
  subject: string;
  consequence: string;
  onCancel: () => void;
  onConfirm: () => void;
  compact?: boolean;
  question?: string;
  confirmLabel?: string;
}): HTMLElement {
  const size = options.compact ? " button--compact" : "";
  return h(
    "div",
    { class: "confirm", role: "alert", "data-confirmation": true },
    h(
      "div",
      {},
      h("strong", {}, options.question ?? `Delete this ${options.subject}?`),
      " Are you really sure you want to delete this? ",
      h("span", { class: "muted" }, options.consequence),
    ),
    h(
      "div",
      { class: "page-actions" },
      h(
        "button",
        {
          type: "button",
          class: `button${size}`,
          "data-cancel-confirm": true,
          onclick: options.onCancel,
        },
        "Cancel",
      ),
      h(
        "button",
        {
          type: "button",
          class: `button button--danger${size}`,
          "data-confirm-delete": true,
          onclick: options.onConfirm,
        },
        options.confirmLabel ?? `Delete ${options.subject}`,
      ),
    ),
  );
}

/** Original-document actions are separate from the note row opener. */
export function documentButton(
  format: string,
  label: string,
  onClick: () => void,
  key?: number,
): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      class: "button button--compact document-button",
      "aria-label": label,
      title: label,
      "data-document": key,
      onclick: onClick,
    },
    h("span", { "aria-hidden": "true" }, "▤"),
    format.toUpperCase(),
  );
}

/** Inert structured content only. Never interpret document markup or activate links. */
export function documentContent(blocks: DocumentBlock[]): HTMLElement {
  return h(
    "div",
    {
      class: "document-content",
      tabindex: "0",
      "aria-label": "Original document content",
    },
    ...blocks.map((block) => {
      if (block.kind === "table")
        return h(
          "div",
          { class: "table-scroll" },
          h(
            "table",
            { class: "data-table" },
            h(
              "tbody",
              {},
              ...block.rows.map((row) =>
                h("tr", {}, ...row.map((cell) => h("td", {}, cell))),
              ),
            ),
          ),
        );
      return h(
        block.kind === "heading" ? "h2" : "p",
        {
          class:
            block.kind === "heading" ? "section-title" : "document-paragraph",
        },
        block.kind === "listItem" ? `• ${block.text}` : block.text,
      );
    }),
  );
}
