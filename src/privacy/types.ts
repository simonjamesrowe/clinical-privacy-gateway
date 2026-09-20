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
  id: number;
  title: string;
  patientName?: string;
  patientReference?: string;
  createdAt: number;
  snippet: string;
}
export interface NoteView {
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
