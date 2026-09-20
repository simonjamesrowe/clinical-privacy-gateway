import { describe, expect, it } from "vitest";
import { normalisePlaceholder, placeholderError } from "./placeholder";

describe("placeholder formatting", () => {
  it.each([
    ["case manager", "[CASE_MANAGER]"],
    [" [case__manager] ", "[CASE_MANAGER]"],
    ["[[client-name]]", "[CLIENT_NAME]"],
    ["[client", "[CLIENT]"],
    ["client]", "[CLIENT]"],
    ["équipe 2", "[EQUIPE_2]"],
    ["123", "[LABEL_123]"],
    ["   ", "[PERSON_1]"],
    ["[]_-!", "[PERSON_1]"],
  ])("formats %s without applying a review decision", (input, expected) => {
    expect(normalisePlaceholder(input, "[PERSON_1]")).toBe(expected);
    expect(normalisePlaceholder(expected, "[PERSON_1]")).toBe(expected);
  });
  it("reports length limits without silently truncating a label", () => {
    expect(placeholderError(`[${"A".repeat(46)}]`)).toBe("");
    const label = normalisePlaceholder("a".repeat(47), "[PERSON_1]");
    expect(label).toHaveLength(49);
    expect(placeholderError(label)).toContain("46 characters");
  });
  it("handles a 100,000-character adversarial separator string in linear time", () => {
    const start = performance.now();
    expect(
      normalisePlaceholder(`[${" _-".repeat(40_000)}client]`, "[PERSON_1]"),
    ).toBe("[CLIENT]");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
