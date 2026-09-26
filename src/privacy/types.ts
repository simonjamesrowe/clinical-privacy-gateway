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
