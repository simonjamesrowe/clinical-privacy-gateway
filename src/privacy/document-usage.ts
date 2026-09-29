import { h } from "./dom";
import { dataTable } from "./components";
import type { DocumentModel, UsageSummary } from "./types";

export function usd(nanos: number): string {
  return `US$${(nanos / 1_000_000_000).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 9,
  })}`;
}

export function modelPrices(model: DocumentModel): string {
  return `${usd(model.inputNanos * 1_000_000)} input · ${usd(model.cachedInputNanos * 1_000_000)} cached input · ${usd(model.outputNanos * 1_000_000)} output per million tokens`;
}

export function modelSelect(
  models: DocumentModel[],
  selected: string,
  name: string,
  onChange?: (event: Event) => void,
): HTMLSelectElement {
  return h(
    "select",
    { name, id: name, onchange: onChange },
    !models.some((model) => model.id === selected) &&
      h(
        "option",
        {
          value: selected,
          selected: true,
          disabled: true,
        },
        selected
          ? "Saved model unavailable — choose a model"
          : "Choose a model",
      ),
    ...models.map((model) =>
      h(
        "option",
        { value: model.id, selected: model.id === selected },
        `${model.name} — ${usd(model.inputNanos * 1_000_000)} in / ${usd(model.outputNanos * 1_000_000)} out per 1M tokens`,
      ),
    ),
  );
}

export function usageTable(usage: UsageSummary): HTMLElement {
  const partial = usage.unknownCostAttempts > 0;
  const rows: [string, string][] = [
    ["Reports created", String(usage.reportsCreated)],
    ["Generation attempts", String(usage.generationAttempts)],
    [
      "Estimated spend in this app",
      `${usd(usage.knownCostNanos)}${partial ? " + unknown costs" : ""}`,
    ],
    [
      "Average cost per report",
      !usage.reportsCreated
        ? "—"
        : partial
          ? "Unavailable — costs unknown"
          : usd(usage.knownCostNanos / usage.reportsCreated),
    ],
  ];
  return h(
    "div",
    {},
    dataTable(
      [{ label: "Metric" }, { label: "Total" }],
      rows.map(([name, value]) =>
        h("tr", {}, h("td", {}, name), h("td", { class: "mono" }, value)),
      ),
    ),
    h(
      "p",
      { class: "muted", role: "status" },
      partial
        ? `${usage.unknownCostAttempts} attempt(s) have unknown costs. These are not counted as free requests.`
        : "Costs use returned token usage and the prices recorded for each attempt.",
    ),
    h(
      "p",
      { class: "hint" },
      "Reports count once on first successful generation. Regenerations add attempts and cost. Deleting a document keeps these content-free totals. This is not your whole OpenAI account bill.",
    ),
  );
}

export function monthRange(date = new Date()): { from: number; until: number } {
  return {
    from: Math.floor(
      new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000,
    ),
    until: Math.floor(
      new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() / 1000,
    ),
  };
}
