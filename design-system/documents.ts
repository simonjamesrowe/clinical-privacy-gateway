// Exercise the production UI with synthetic bridge responses, never clinical material.
import { TextReviewPage } from "../src/privacy/page";
import type {
  PrivacyBridge,
  ImportedDocument,
  ReviewSession,
} from "../src/privacy/types";

const source =
  "Alex Morgan attended a follow-up appointment. Sleep has improved. Continue the current 10 mg dose and review in four weeks.";
const imported: ImportedDocument = {
  id: 12,
  document: {
    name: "synthetic-consultation.docx",
    format: "docx",
    byteLength: 24576,
  },
  extracted: {
    text: source,
    blocks: [
      { kind: "heading", text: "Follow-up consultation" },
      { kind: "paragraph", text: source },
      {
        kind: "table",
        rows: [
          ["Treatment", "Plan"],
          ["Current medication", "Continue 10 mg"],
          ["Follow-up", "Four weeks"],
        ],
      },
      { kind: "listItem", text: "Discuss sleep at the next appointment." },
    ],
    warnings: [],
  },
};
const patient = {
  id: 7,
  name: "Alex Morgan",
  patientReference: "SYN-2048",
  noteCount: 1,
  redactionCount: 0,
};
function review(sourceText: string): ReviewSession {
  const start = sourceText.indexOf("Alex Morgan");
  return {
    id: 1,
    revision: 0,
    source: sourceText,
    output: sourceText.replace("Alex Morgan", "[CLIENT]"),
    items:
      start < 0
        ? []
        : [
            {
              id: 1,
              group: 1,
              start,
              end: start + 11,
              outputStart: start,
              outputEnd: start + 8,
              category: "PERSON",
              replacement: "[CLIENT]",
              decision: "pending",
              stages: ["ner"],
              confidence: 0.9,
              reason: "Synthetic example identifier.",
            },
          ],
    pending: start < 0 ? 0 : 1,
    retained: 0,
    checked: false,
  };
}
let session = review(source);
const note = {
  id: 4,
  patientId: 7,
  patientName: patient.name,
  title: "Follow-up consultation",
  snippet: "[CLIENT] attended a follow-up appointment. Sleep has improved.",
  createdAt: 1790424000,
  document: imported.document,
};
const bridge: PrivacyBridge = {
  available: true,
  progress: async () => () => {},
  async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    let result: unknown;
    switch (command) {
      case "model_status":
        result = {
          installed: true,
          name: "Synthetic model",
          bytes: 0,
          revision: "specimen",
        };
        break;
      case "list_patients":
        result = [patient];
        break;
      case "search_notes":
        result = [note];
        break;
      case "list_mappings":
      case "list_patient_mappings":
        result = [];
        break;
      case "import_document":
        result = imported;
        break;
      case "open_document_preview":
        result = { ...imported, id: 99 };
        break;
      case "detect_text":
        session = review(String(args?.source));
        result = session;
        break;
      case "review_decision":
        session = {
          ...session,
          revision: session.revision + 1,
          pending: 0,
          items: session.items.map((item) => ({
            ...item,
            decision: args?.decision as "accept",
            replacement: String(args?.replacement ?? item.replacement),
          })),
        };
        result = session;
        break;
      case "rescan_text":
        session = { ...session, revision: session.revision + 1, checked: true };
        result = session;
        break;
      case "save_reviewed_note":
        result = note;
        break;
      case "open_saved_note":
        result = { note, session: { ...session, checked: true } };
        break;
      default:
        result = undefined;
    }
    return result as T;
  },
};
const page = new TextReviewPage(
  document.querySelector<HTMLElement>("#document-specimen")!,
  bridge,
  () => location.reload(),
  "patients",
);
await page.mount();
