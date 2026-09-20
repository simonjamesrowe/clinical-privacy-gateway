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
