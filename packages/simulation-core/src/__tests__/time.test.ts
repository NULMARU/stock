import { describe, expect, it } from "vitest";
import {
  addQuarters,
  assertReasonablePeriod,
  parseQuarter,
  quarterCount,
  quarterIndex,
  quarterLabel,
  quarterRange,
} from "../time";

describe("time contract (V05)", () => {
  it("parses and formats quarters with year rollover", () => {
    expect(parseQuarter("2025Q4")).toEqual({ year: 2025, q: 4 });
    expect(quarterLabel(quarterIndex("2025Q4") + 1)).toBe("2026Q1");
    expect(addQuarters("2025Q3", 3)).toBe("2026Q2");
    expect(addQuarters("2025Q1", -1)).toBe("2024Q4");
  });

  it("counts inclusively", () => {
    expect(quarterCount("2025Q1", "2025Q1")).toBe(1);
    expect(quarterCount("2025Q1", "2035Q4")).toBe(44);
    expect(quarterRange("2025Q3", "2026Q2")).toEqual([
      "2025Q3",
      "2025Q4",
      "2026Q1",
      "2026Q2",
    ]);
  });

  it("rejects reversed periods instead of returning empty results (F05)", () => {
    expect(() => quarterCount("2035Q4", "2025Q1")).toThrow(/Invalid period/);
  });

  it("rejects malformed labels and absurd horizons", () => {
    expect(() => parseQuarter("2025Q0")).toThrow();
    expect(() => parseQuarter("25Q1")).toThrow();
    expect(() => parseQuarter("2025Q1 ")).toThrow();
    expect(() => assertReasonablePeriod("2025Q1", "2200Q4")).toThrow(
      /too long/,
    );
  });
});
