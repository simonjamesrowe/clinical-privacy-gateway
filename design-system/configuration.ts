// Production screens with memory-only, synthetic fixtures. No network or real keys.
import "../src/styles/app.css";
import { TextReviewPage, type WorkspaceScreen } from "../src/privacy/page";
import type {
  DocumentSettings,
  DocumentTemplate,
  PrivacyBridge,
} from "../src/privacy/types";
const prices = [
  ["gpt-6-luna", "GPT-6 Luna · Lowest cost", 100, 10, 500],
  ["gpt-6-sol", "GPT-6 Sol", 2000, 200, 10000],
  ["gpt-6-astra", "GPT-6 Astra", 10000, 1000, 50000],
  ["gpt-5.6-luna", "GPT-5.6 Luna", 200, 20, 1200],
  ["gpt-5.4-mini-2026-03-17", "GPT-5.4 mini", 750, 75, 4500],
] as const;
let settings: DocumentSettings = {
  displayName: "Dr Avery Reed",
  role: "Clinician",
  qualifications: "Synthetic demonstration",
  letterHeader: "Harbour Clinical Service\n12 Example Street\nBristol BS1 1AA",
  apiKeyConfigured: true,
  clinicalSendingEnabled: true,
  hasSignature: false,
  signaturePng: null,
  openaiModel: "gpt-6-luna",
  models: prices.map(
    ([id, name, inputNanos, cachedInputNanos, outputNanos]) => ({
      id,
      name,
      inputNanos,
      cachedInputNanos,
      outputNanos,
      pricingCheckedAt: "2026-09-29",
    }),
  ),
};
let templates: DocumentTemplate[] = [
  {
    id: 1,
    version: 1,
    name: "GP letter",
    description: "Summarise care for the GP",
    instructions:
      "## Purpose\n\nWrite a letter using **only the supplied reviewed notes**.\n\n## Include\n\n- Presentation and relevant history\n- Progress since the previous appointment\n- Agreed next steps\n\n## Style\n\nUse professional British English. Preserve request placeholders exactly. Do not invent missing details.",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  },
];
const bridge: PrivacyBridge = {
  available: true,
  progress: async () => () => {},
  call: async <T>(command: string, args: Record<string, unknown> = {}) => {
    let result: unknown;
    switch (command) {
      case "model_status":
        result = {
          installed: true,
          name: "BERT NER · English",
          revision: "Synthetic specimen",
          assets: [],
        };
        break;
      case "document_settings":
        result = settings;
        break;
      case "list_patients":
        result = [
          {
            id: 7,
            name: "Synthetic Client",
            patientReference: "SYN-2048",
            noteCount: 3,
            documentCount: 2,
            redactionCount: 4,
          },
        ];
        break;
      case "search_notes":
        result = [
          {
            id: 31,
            patientId: 7,
            patientName: "Synthetic Client",
            patientReference: "SYN-2048",
            title: "Clinical review",
            snippet: "[PERSON_1] attended a review in [LOCATION_1].",
            createdAt: 1_790_000_000,
          },
        ];
        break;
      case "list_documents":
      case "list_patient_documents":
        result = [
          {
            id: 12,
            patientId: 7,
            patientName: "Synthetic Client",
            patientReference: "SYN-2048",
            title: "Synthetic GP update",
            templateName: "GP letter",
            revision: 2,
            reviewed: true,
            createdAt: 1_790_000_000,
            updatedAt: 1_790_086_400,
            usage: {
              reportsCreated: 1,
              generationAttempts: 2,
              knownCostNanos: 1_840_000,
              unknownCostAttempts: 0,
              latestCostNanos: 920_000,
            },
          },
          {
            id: 13,
            patientId: 7,
            patientName: "Synthetic Client",
            patientReference: "SYN-2048",
            title: "Synthetic referral draft",
            templateName: "Specialist referral",
            revision: 1,
            reviewed: false,
            createdAt: 1_790_172_800,
            updatedAt: 1_790_172_800,
            usage: {
              reportsCreated: 1,
              generationAttempts: 1,
              knownCostNanos: 410_000,
              unknownCostAttempts: 0,
              latestCostNanos: 410_000,
            },
          },
        ];
        break;
      case "list_document_templates":
        result = templates;
        break;
      case "document_usage":
        result = {
          reportsCreated: 12,
          generationAttempts: 14,
          knownCostNanos: 18_450_000,
          unknownCostAttempts: 0,
          latestCostNanos: 400_000,
        };
        break;
      case "prepare_document_submission":
        result = {
          id: "synthetic-preparation",
          documentId: 14,
          model: String(args.model),
          destination: "https://api.openai.com",
          purpose: "Generate patient document",
          instructions: `Create the requested document using only facts in the supplied reviewed notes. Do not invent missing details. Return only the document text.\n\nDocument prompt template:\n${templates[0].instructions}${args.customInstructions ? `\n\nAdditional instructions for this document:\n${String(args.customInstructions)}` : ""}`,
          input:
            '<reviewed-note index="1">\n⟪CV_synthetic_0001⟫ attended a review in ⟪CV_synthetic_0002⟫.\n</reviewed-note>',
          sourceCount: 1,
          reviewNotes: [
            {
              id: 31,
              title: "Clinical review",
              reviewedText:
                "[PERSON_1] attended a review in [LOCATION_1]. Progress and agreed next steps were discussed.",
              createdAt: 1_790_000_000,
            },
          ],
          estimate: {
            inputTokenAllowance: 500,
            outputTokenAllowance: 4096,
            costNanos: 2_182_625,
          },
        };
        break;
      case "save_document_settings": {
        settings = {
          ...settings,
          displayName: String(args.displayName),
          role: String(args.role),
          qualifications: String(args.qualifications),
          letterHeader: String(args.letterHeader),
          openaiModel: String(args.openaiModel),
          apiKeyConfigured: settings.apiKeyConfigured || Boolean(args.apiKey),
        };
        if (args.signature)
          settings.signaturePng = btoa(
            String.fromCharCode(...(args.signature as number[])),
          );
        if (args.removeSignature) settings.signaturePng = null;
        settings.hasSignature = Boolean(settings.signaturePng);
        result = settings;
        break;
      }
      case "remove_openai_api_key":
        settings.apiKeyConfigured = false;
        result = settings;
        break;
      case "test_openai_connection":
        result = true;
        break;
      case "set_clinical_sending_enabled":
        settings = {
          ...settings,
          clinicalSendingEnabled: Boolean(args.enabled),
        };
        result = settings;
        break;
      case "create_document_template":
      case "update_document_template": {
        const item = {
          ...templates[0],
          ...args,
          id: Number(args.id ?? templates.length + 1),
        } as DocumentTemplate;
        templates = [
          ...templates.filter((entry) => entry.id !== item.id),
          item,
        ];
        result = item;
        break;
      }
      default:
        throw "This action is unavailable in the synthetic preview.";
    }
    return result as T;
  },
};
const requested: WorkspaceScreen =
  location.hash === "#settings"
    ? "settings"
    : location.hash === "#documents"
      ? "documents"
      : "templates";
const page = new TextReviewPage(
  document.querySelector("#app")!,
  bridge,
  () => {},
  requested,
);
await page.mount();
