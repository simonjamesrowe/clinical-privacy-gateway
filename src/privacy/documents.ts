import type { DocumentMetadata } from "./types";

export const MAX_SOURCE_CHARACTERS = 100_000;
export function documentLabel(document: DocumentMetadata): string {
  return document.format === "docx"
    ? "Word document"
    : document.format === "pdf"
      ? "PDF"
      : "text document";
}
