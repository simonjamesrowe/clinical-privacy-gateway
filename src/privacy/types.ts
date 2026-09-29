export type Decision = "pending" | "accept" | "edit" | "keep" | "remove";
export interface Detection {
  id: number;
  start: number;
  end: number;
  category: string;
  group: number;
  replacement: string;
  decision: Decision;
  stages: string[];
  confidence: number;
  reason: string;
  outputStart: number;
  outputEnd: number;
}
export interface ReviewSession {
  id: number;
  revision: number;
  source: string;
  output: string;
  items: Detection[];
  pending: number;
  retained: number;
  checked: boolean;
}
export interface ModelStatus {
  installed: boolean;
  name: string;
  bytes: number;
  revision: string;
}
export interface NoteSummary {
  document?: DocumentMetadata | null;
  id: number;
  patientId?: number;
  title: string;
  patientName?: string;
  patientReference?: string;
  createdAt: number;
  snippet: string;
}
export interface NoteView {
  document?: DocumentMetadata | null;
  id: number;
  patientId?: number;
  title: string;
  patientName?: string;
  patientReference?: string;
  sourceText?: string;
  reviewedText: string;
  provenance: string;
  createdAt: number;
}
export interface OpenedNote {
  note: NoteView;
  session: ReviewSession;
}
export interface MappingView {
  id: number;
  phrase: string;
  category: string;
  replacement: string;
  createdAt: number;
  updatedAt: number;
}
export interface PatientView {
  id: number;
  name: string;
  patientReference?: string;
  noteCount?: number;
  redactionCount?: number;
  documentCount?: number;
}
export interface DocumentTemplate {
  id: number;
  version: number;
  name: string;
  description: string;
  instructions: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface DocumentSummary {
  usage: UsageSummary;
  id: number;
  patientId: number;
  title: string;
  templateName: string;
  revision: number;
  reviewed: boolean;
  createdAt: number;
  updatedAt: number;
  patientName?: string | null;
  patientReference?: string | null;
}
export interface DocumentSettings {
  models: DocumentModel[];
  displayName: string;
  role: string;
  qualifications: string;
  hasSignature: boolean;
  signaturePng?: string | null;
  openaiModel: string;
  clinicalSendingEnabled: boolean;
  apiKeyConfigured: boolean;
}
export interface DocumentModel {
  id: string;
  name: string;
  inputNanos: number;
  cachedInputNanos: number;
  outputNanos: number;
  pricingCheckedAt: string;
}
export interface UsageSummary {
  reportsCreated: number;
  generationAttempts: number;
  knownCostNanos: number;
  unknownCostAttempts: number;
  latestCostNanos: number | null;
}
export interface PreparedDocumentSubmission {
  id: string;
  documentId: number;
  model: string;
  destination: string;
  purpose: string;
  instructions: string;
  input: string;
  sourceCount: number;
  reviewNotes: SubmissionReviewNote[];
  estimate: {
    inputTokenAllowance: number;
    outputTokenAllowance: number;
    costNanos: number;
  };
}
export interface SubmissionReviewNote {
  id: number;
  title: string;
  reviewedText: string;
  createdAt: number;
}
export interface GeneratedDocument {
  documentId: number;
  text: string;
  exactReplacements: number;
  unknownTokens: string[];
  usage: UsageSummary;
}
export interface Progress {
  operation: number;
  stage: string;
  completed: number;
  total: number;
}
export interface PrivacyBridge {
  available: boolean;
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  progress(callback: (event: Progress) => void): Promise<() => void>;
}

export interface DocumentMetadata {
  name: string;
  format: "txt" | "docx" | "pdf";
  byteLength: number;
}
export type DocumentBlock =
  | { kind: "paragraph" | "heading" | "listItem"; text: string }
  | { kind: "table"; rows: string[][] };
export interface ExtractedDocument {
  text: string;
  blocks: DocumentBlock[];
  warnings: string[];
  pageCount?: number | null;
}
export interface ImportedDocument {
  id: number;
  document: DocumentMetadata;
  extracted: ExtractedDocument;
}
export type DocumentPreview = ImportedDocument;
