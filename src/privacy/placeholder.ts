/** Formatting only: applying a label remains an explicit review decision. */
export function normalisePlaceholder(value: string, fallback: string): string {
  const words = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .join("_");
  if (!words) return fallback;
  return `[${/^[A-Z]/.test(words) ? words : `LABEL_${words}`}]`;
}

export function placeholderError(value: string): string {
  return value.length > 48
    ? "Use a shorter label: at most 46 characters inside the brackets."
    : "";
}
