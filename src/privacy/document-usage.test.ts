// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { monthRange, usd, usageTable } from "./document-usage";

describe("usage presentation", () => {
  it("preserves sub-cent costs including a single cached token", () => {
    expect(usd(100)).toBe("US$0.0000001");
    expect(usd(1080000)).toBe("US$0.00108");
    expect(usd(0)).toBe("US$0.00");
  });
  it("uses local calendar month boundaries, including year rollover", () => {
    const date = new Date(2026, 11, 31, 23, 59);
    const { from, until } = monthRange(date);
    expect(new Date(from * 1000)).toEqual(new Date(2026, 11, 1));
    expect(new Date(until * 1000)).toEqual(new Date(2027, 0, 1));
  });
  it("has no average without a generated report and no invented zero for missing usage", () => {
    const table = usageTable({
      reportsCreated: 0,
      generationAttempts: 1,
      knownCostNanos: 0,
      unknownCostAttempts: 1,
      latestCostNanos: null,
    });
    expect(table.textContent).toContain("US$0.00 + unknown costs");
    expect(table.textContent).toContain("Average cost per report—");
  });
});
