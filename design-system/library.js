// Renders token specimens from src/styles/tokens.css so the library cannot
// drift from the source of truth, and adds a markup viewer to each specimen.
const TOKENS_URL = "../src/styles/tokens.css";
const PROPERTY = /^\s*(--[a-z0-9-]+):\s*([^;]+);(?:\s*\/\*\s*([^*]*)\*\/)?/;

function parseTokens(text) {
  const tokens = [];
  let group = "";
  for (const line of text.split("\n")) {
    const heading = line.trim().match(/^\/\* Colour: ([a-z ]+)/i);
    if (heading) group = heading[1].trim();
    const match = line.match(PROPERTY);
    if (match)
      tokens.push({
        name: match[1],
        value: match[2].trim(),
        usage: (match[3] ?? "").trim(),
        group: match[1].startsWith("--color-") ? group : "",
      });
  }
  return tokens;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderColours(tokens, root) {
  const groups = new Map();
  for (const token of tokens.filter((t) => t.name.startsWith("--color-")))
    groups.set(token.group, [...(groups.get(token.group) ?? []), token]);
  for (const [name, members] of groups) {
    const section = element("section", "token-group");
    section.append(element("h3", "section-title", name));
    const grid = element("div", "swatches");
    for (const token of members) {
      const swatch = element("div", "swatch");
      const chip = element("div", "swatch__chip");
      chip.style.background = `var(${token.name})`;
      const text = element("div", "swatch__text");
      text.append(
        element("code", "", token.name),
        element("span", "mono muted", token.value),
      );
      if (token.usage) text.append(element("span", "", token.usage));
      swatch.append(chip, text);
      grid.append(swatch);
    }
    section.append(grid);
    root.append(section);
  }
}

function renderRows(tokens, prefix, root, sample) {
  for (const token of tokens.filter((t) => t.name.startsWith(prefix))) {
    const row = element("div", "token-row");
    row.append(
      element("code", "", token.name),
      element("span", "mono muted", token.value),
    );
    row.append(sample(token));
    root.append(row);
  }
}

function renderTokens(tokens) {
  renderColours(tokens, document.querySelector("[data-colours]"));
  renderRows(tokens, "--font-", document.querySelector("[data-fonts]"), (t) => {
    const sample = element("span", "", "Alex Morgan · SYN-2048 · [PERSON_1]");
    sample.style.fontFamily = `var(${t.name})`;
    return sample;
  });
  renderRows(tokens, "--text-", document.querySelector("[data-sizes]"), (t) => {
    const sample = element("span", "", "Reviewed note");
    sample.style.fontSize = `var(${t.name})`;
    return sample;
  });
  renderRows(
    tokens,
    "--space-",
    document.querySelector("[data-space]"),
    (t) => {
      const bar = element("span", "space-bar");
      bar.style.width = `var(${t.name})`;
      return bar;
    },
  );
  const shape = document.querySelector("[data-shape]");
  renderRows(tokens, "--radius", shape, (t) => {
    const box = element("span", "radius-box");
    box.style.borderRadius = `var(${t.name})`;
    return box;
  });
  renderRows(tokens, "--control-", shape, (t) => {
    const button = element("button", "button", "Save changes");
    button.type = "button";
    button.style.height = `var(${t.name})`;
    return button;
  });
  renderRows(tokens, "--shadow-", shape, (t) =>
    element("span", "muted", t.usage || "Anchored floating elements only"),
  );
}

function addMarkupViewers() {
  for (const demo of document.querySelectorAll(".specimen__demo")) {
    const lines = demo.innerHTML.split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const indent = Math.min(
      ...lines.filter((l) => l.trim()).map((l) => l.search(/\S/)),
    );
    const details = element("details");
    details.append(element("summary", "", "Markup"));
    const pre = element("pre");
    pre.textContent = lines.map((l) => l.slice(indent)).join("\n");
    details.append(pre);
    demo.after(details);
  }
}

addMarkupViewers();
// The Vite dev server serves raw CSS only when the request asks for it.
fetch(TOKENS_URL, { headers: { Accept: "text/css" } })
  .then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.text();
  })
  .then((text) => renderTokens(parseTokens(text)))
  .catch(() => {
    for (const target of document.querySelectorAll("[data-token-target]"))
      target.replaceChildren(
        element(
          "p",
          "notice",
          "Token specimens need the dev server: run npm run design-system.",
        ),
      );
  });
