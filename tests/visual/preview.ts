// Development-only visual fixture; not an application entry point or native bridge.
import { TextReviewPage } from "../../src/privacy/page";
import type {
  Decision,
  PrivacyBridge,
  ReviewSession,
} from "../../src/privacy/types";
import "../../src/styles/app.css";

const source =
  "Alex Morgan attended a review in Bristol. Alex Morgan reported improved sleep and no change to the prescribed 10 mg dose.";
const spans = [
  [0, 11, "PERSON", 1],
  [33, 40, "LOCATION", 2],
  [42, 53, "PERSON", 1],
] as const;
let session: ReviewSession = {
  id: 1,
  revision: 0,
  source,
  output: "",
  checked: false,
  pending: 3,
  retained: 0,
  items: spans.map(([start, end, category, group], index) => ({
    id: index + 1,
    start,
    end,
    category,
    group,
    replacement: `[${category}_1]`,
    decision: "pending",
    stages: ["ner"],
    confidence: 0.99,
    reason: "The local model marked this as a possible named entity.",
    outputStart: 0,
    outputEnd: 0,
  })),
};
function renderFixture() {
  let cursor = 0;
  session.output = "";
  for (const item of session.items) {
    session.output += source.slice(cursor, item.start);
    item.outputStart = session.output.length;
    session.output +=
      item.decision === "keep"
        ? source.slice(item.start, item.end)
        : item.decision === "remove"
          ? ""
          : item.replacement;
    item.outputEnd = session.output.length;
    cursor = item.end;
  }
  session.output += source.slice(cursor);
  session.pending = session.items.filter(
    (i) => i.decision === "pending",
  ).length;
  session.retained = session.items.filter((i) => i.decision === "keep").length;
  return structuredClone(session);
}
const bridge: PrivacyBridge = {
  available: true,
  progress: async () => () => {},
  async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (command === "model_status")
      return {
        installed: true,
        name: "Synthetic fixture",
        bytes: 0,
        revision: "fixture",
      } as T;
    if (command === "review_decision") {
      const group = session.items.find((i) => i.id === args?.item)?.group;
      session.items
        .filter((i) => i.group === group)
        .forEach((i) => {
          i.decision = args?.decision as Decision;
          if (i.decision === "edit") i.replacement = String(args?.replacement);
        });
      session.checked = false;
      session.revision++;
    }
    if (command === "rescan_text") {
      session.checked = session.pending === 0;
      session.revision++;
    }
    if (command === "discard_session")
      session = {
        ...session,
        source: "",
        output: "",
        items: [],
        checked: false,
      };
    return renderFixture() as T;
  },
};
const page = new TextReviewPage(
  document.querySelector<HTMLElement>("#preview")!,
  bridge,
  () => location.reload(),
);
void page.mount();
