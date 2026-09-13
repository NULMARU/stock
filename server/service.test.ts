import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { Store } from "./store";
import { FinancialService } from "./service";
import {
  normalizeSEC,
  normalizeDART,
  resolveSecurity,
  type CompanyFacts,
  type Fact,
} from "./providers";
import type { FinancialSnapshot } from "@stock/financial-analysis";
const issuer = "sec:0001045810";
const snapshot: FinancialSnapshot = {
  schemaVersion: 1,
  issuerId: issuer,
  name: "Fixture only",
  industry: "manufacturing",
  financialVersion: "v1",
  filedAt: "2025-04-01",
  latestKnownFilingId: "test",
  fetchedAt: "2025-04-01",
  source: "SEC",
  periods: [],
  warnings: [],
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function setup(collector: () => Promise<FinancialSnapshot>) {
  const dir = await mkdtemp(join(tmpdir(), "stock-test-"));
  directories.push(dir);
  const store = new Store(dir);
  await store.init();
  const service = new FinancialService(store, collector);
  await service.register(await resolveSecurity("US", "NVDA"));
  return { store, service, dir };
}
describe("durable refresh jobs", () => {
  it("deduplicates concurrent requests and preserves snapshot across restart", async () => {
    let calls = 0;
    const { store, service, dir } = await setup(async () => {
      calls++;
      return snapshot;
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.financials(issuer, true)),
    );
    expect(new Set(results.map((x) => x.jobId)).size).toBe(1);
    await service.tick();
    expect(calls).toBe(1);
    await store.close();
    const reopened = new Store(dir);
    await reopened.init();
    const next = new FinancialService(reopened);
    expect((await next.financials(issuer)).snapshot?.financialVersion).toBe(
      "v1",
    );
    await reopened.close();
  });
  it("a failed collection preserves last good data and does not update freshness", async () => {
    const { store, service } = await setup(async () => {
      throw new Error("SEC HTTP 429");
    });
    await store.transaction((s) => {
      s.issuers[issuer].snapshot = snapshot;
      s.issuers[issuer].sourceCheckedAt = "2020-01-01";
    });
    const before = await service.financials(issuer);
    await service.tick();
    const after = await service.financials(issuer);
    expect(after.snapshot?.financialVersion).toBe("v1");
    expect(after.sourceCheckedAt).toBe("2020-01-01");
    expect(after.jobId).toBe(before.jobId);
    expect(after.isStale).toBe(true);
    expect(after.error).toContain("429");
    await store.close();
  });
  it("failed exhausted jobs respect backoff instead of creating a new job every tick", async () => {
    const { store, service } = await setup(async () => snapshot);
    const response = await service.financials(issuer);
    await store.transaction((s) => {
      const j = s.jobs[response.jobId!];
      j.state = "failed";
      j.createdAt = "2020-01-01";
      j.nextAt = Date.now() + 600000;
    });
    await service.tick();
    expect((await service.financials(issuer, true)).jobId).toBe(response.jobId);
    expect((await service.job(response.jobId!))?.state).toBe("failed");
    await store.close();
  });
});
describe("filing normalization boundaries", () => {
  it("keeps filing cutoff, correct currency and point-in-time balances", () => {
    const fact = (val: number, filed = "2025-04-01"): Fact => ({
      start: "2025-01-01",
      end: "2025-03-31",
      val,
      accn: "0001045810-25-000001",
      filed,
      form: "10-Q",
    });
    const input: CompanyFacts = {
      entityName: "Fixture",
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [fact(100), fact(999, "2026-01-01")],
              EUR: [fact(80)],
            },
          },
          Assets: { units: { USD: [{ ...fact(200), start: undefined }] } },
        },
      },
    };
    const s = normalizeSEC(issuer, input, "2025-06-01");
    const p = s.periods.find((p) => p.currency === "USD")!;
    expect(p.values.revenue).toBe(100);
    expect(p.values.assets).toBe(200);
    expect(p.sources.revenue[0].filingId).toContain("25-000001");
  });
  it("does not treat DART broad financing cost and trade+other debtors as precise accounts", () => {
    const rows = [
      "ifrs-full_FinanceCosts",
      "ifrs-full_TradeAndOtherCurrentReceivables",
    ].map((account_id) => ({
      account_id,
      account_nm: "fixture",
      sj_div: "IS",
      thstrm_amount: "100",
      rcept_no: "2025001",
    }));
    const p = normalizeDART(rows, 2025, "11013", "dart:00126380", {});
    expect(p.values.interestExpense).toBeNull();
    expect(p.values.receivables).toBeNull();
  });
  it("retains DART reported income cumulative facts for Q4 derivation", () => {
    const p = normalizeDART(
      [
        {
          account_id: "ifrs-full_Revenue",
          account_nm: "매출",
          sj_div: "IS",
          thstrm_amount: "30",
          thstrm_add_amount: "90",
          rcept_no: "2025001",
        },
      ],
      2025,
      "11014",
      "dart:00126380",
      {},
    );
    expect(p.values.revenue).toBe(30);
    expect(p.values["cumulative:revenue"]).toBe(90);
  });
});
