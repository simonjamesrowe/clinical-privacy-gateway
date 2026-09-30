// Small DOM builder for workspace screens. Strings always become text nodes,
// so patient names, titles, and clinical text are never parsed as HTML.
type Child = Node | string | number | false | null | undefined;
type AttributeValue = string | number | boolean | null | undefined;
type Attributes = Record<string, AttributeValue | ((event: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === "function") {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === "class") {
      if (value) element.className = String(value);
    } else if (name === "value" && "value" in element) {
      (element as HTMLInputElement).value = String(value ?? "");
    } else if (value === true) {
      element.setAttribute(name, "");
    } else if (value !== false && value !== null && value !== undefined) {
      element.setAttribute(name, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue;
    element.append(
      typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child,
    );
  }
  return element;
}

/** The magnifying-glass icon used by every search button. */
export function searchIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
  }))
    svg.setAttribute(name, value);
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("cx", "6.75");
  circle.setAttribute("cy", "6.75");
  circle.setAttribute("r", "4.75");
  const handle = document.createElementNS(ns, "path");
  handle.setAttribute("d", "m10.4 10.4 3.85 3.85");
  svg.append(circle, handle);
  return svg;
}

/** The microphone icon on every dictation button. */
export function microphoneIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
  }))
    svg.setAttribute(name, value);
  const capsule = document.createElementNS(ns, "rect");
  for (const [name, value] of Object.entries({
    x: "5.75",
    y: "1.75",
    width: "4.5",
    height: "8",
    rx: "2.25",
  }))
    capsule.setAttribute(name, value);
  const stand = document.createElementNS(ns, "path");
  stand.setAttribute("d", "M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25");
  svg.append(capsule, stand);
  return svg;
}

/** The brand mark from the welcome page, sized for the app header. */
export function brandMark(): HTMLSpanElement {
  return h(
    "span",
    { class: "brand-mark", "aria-hidden": "true" },
    h("span"),
    h("span"),
  );
}

export function formatDate(seconds: number | undefined): string {
  return seconds
    ? new Date(seconds * 1000).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}

export function categoryLabel(category: string): string {
  const words = category.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
