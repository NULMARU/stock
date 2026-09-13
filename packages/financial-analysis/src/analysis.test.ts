import { describe, it, expect } from "vitest";
import {
  analyzeFinancials,
  makeTTM,
  exactSum,
  type FinancialPeriod,
  type FinancialSnapshot,
} from "./index";
const period = (
  start: string,
  end: string,
  values: FinancialPeriod["values"] = {},
): FinancialPeriod => ({
  id: start,
  kind: "quarter",
  start,
  end,
  currency: "USD",
  scope: "consolidated",
  values,
  sources: {},
  warnings: [],
});
const snap = (
  periods: FinancialPeriod[],
  industry = "manufacturing",
): FinancialSnapshot => ({
  schemaVersion: 1,
  issuerId: "fixture",
  name: "Synthetic test",
  industry,
  financialVersion: "fixture-v1",
  filedAt: "2026-01-01",
  fetchedAt: "2026-01-01",
  latestKnownFilingId: "fixture",
  source: "SEC",
  periods,
  warnings: [],
});
const metric = (s: FinancialSnapshot, p: FinancialPeriod, id: string) =>
  analyzeFinancials(s, p).find((m) => m.id === id)!;
describe("financial interpretations", () => {
  it("uses opening and ending balances, and COGS rather than revenue for inventory", () => {
    const prior = period("2024-10-01", "2024-12-31", {
      equity: 100,
      assets: 200,
      inventory: 10,
      receivables: 20,
    });
    const p = period("2025-01-01", "2025-03-31", {
      equity: 200,
      assets: 300,
      netIncome: 30,
      revenue: 100,
      costOfRevenue: 60,
      inventory: 20,
      receivables: 30,
    });
    const s = snap([prior, p]);
    expect(metric(s, p, "FS04").value).toBe(0.2);
    expect(metric(s, p, "FS11").value).toBe(4);
    expect(metric(s, p, "FS12").value).toBe(4);
    expect(
      Object.values(metric(s, p, "FS04").details).reduce((a, b) => a * b, 1),
    ).toBeCloseTo(0.2);
  });
  it("matches parent profit and parent equity instead of mixing total equity", () => {
    const b = period("2024-10-01", "2024-12-31", {
        parentEquity: 100,
        equity: 1000,
      }),
      p = period("2025-01-01", "2025-03-31", {
        parentNetIncome: 20,
        parentEquity: 100,
        equity: 1000,
        netIncome: 100,
      });
    expect(metric(snap([b, p]), p, "FS04").value).toBe(0.2);
  });
  it("does not substitute zero for missing intangibles or missing opening balance", () => {
    const p = period("2025-01-01", "2025-03-31", {
      ocf: 30,
      capexPPE: 10,
      equity: 100,
      netIncome: 10,
    });
    expect(metric(snap([p]), p, "FS08").status).toBe("missing");
    expect(metric(snap([p]), p, "FS04").status).toBe("missing");
  });
  it("rejects nonpositive equity and accounting identity mismatch", () => {
    const p = period("2025-01-01", "2025-03-31", {
      equity: -10,
      liabilities: 100,
    });
    expect(metric(snap([p]), p, "FS01").status).toBe("invalid");
    p.values = { assets: 100, liabilities: 90, equity: 20 };
    expect(metric(snap([p]), p, "FS01").status).toBe("invalid");
  });
  it("does not compare different duration or currency as year-over-year growth", () => {
    const p = period("2025-01-01", "2025-03-31", { revenue: 120 }),
      q = period("2024-02-01", "2024-03-31", { revenue: 100 });
    expect(metric(snap([q, p]), p, "FS05").value).toBeNull();
    q.start = "2024-01-01";
    q.currency = "KRW";
    expect(metric(snap([q, p]), p, "FS05").value).toBeNull();
  });
  it("sums flows and takes final balances for TTM, rejecting missing quarters", () => {
    const q = [
      period("2025-01-01", "2025-03-31", { revenue: 10, assets: 100 }),
      period("2025-04-01", "2025-06-30", { revenue: 20, assets: 110 }),
      period("2025-07-01", "2025-09-30", { revenue: 30, assets: 120 }),
      period("2025-10-01", "2025-12-31", { revenue: 40, assets: 130 }),
    ];
    expect(makeTTM(q)?.values.revenue).toBe(100);
    expect(makeTTM(q)?.values.assets).toBe(130);
    expect(makeTTM(q.slice(1))).toBeNull();
  });
  it("does not invent market prices and excludes generic banking ratios", () => {
    const p = period("2025-01-01", "2025-03-31", {
      netIncome: 10,
      equity: 100,
      liabilities: 50,
    });
    expect(metric(snap([p]), p, "FS09").value).toBeNull();
    expect(metric(snap([p], "Commercial Banks"), p, "FS01").status).toBe(
      "not-applicable",
    );
  });
  it("uses decimal addition for monetary flows", () =>
    expect(exactSum([0.1, 0.2, -0.3])).toBe(0));
});
