import { describe, it, expect } from "vitest";
import {
  executeRun,
  ExecutionCancelled,
  hashRunInput,
  hashRunResult,
  sha256Hex,
  type ScenarioDocument,
} from "@stock/simulation-core";
import {
  newScenario,
  resolveScenario,
  infrawheelModel,
  type Project,
} from "./index";
const run = (doc: ScenarioDocument) =>
  executeRun(infrawheelModel, resolveScenario(doc), {
    scenarioId: doc.id,
    scenarioRevision: doc.revision,
  });
const scenario = (overrides: Record<string, number> = {}) => {
  const s = newScenario("test");
  s.timeline.endQuarter = "2027Q4";
  s.inputs.powerLeadQuarters = 2;
  Object.assign(s.inputs, overrides);
  return s;
};
describe("Structural v2 ledger and boundaries", () => {
  it("replays and preserves immutable copies without freezing caller input", () => {
    const s = scenario(),
      a = run(s),
      b = run(s);
    expect(a.resultHash).toBe(b.resultHash);
    expect(hashRunResult(a)).toBe(a.resultHash);
    s.inputs.initialPowerMW = 1;
    expect(a.resolvedInput.inputs.initialPowerMW).not.toBe(1);
    expect(Object.isFrozen(s.inputs)).toBe(false);
    expect(Object.isFrozen(a.series[0].values)).toBe(true);
  });
  it("rejects mismatched model and engine versions", () => {
    expect(() =>
      resolveScenario({ ...scenario(), modelVersion: "old" }),
    ).toThrow();
    const input = resolveScenario(scenario());
    input.engineVersion = "old";
    expect(() =>
      executeRun(infrawheelModel, input, {
        scenarioId: "x",
        scenarioRevision: 1,
      }),
    ).toThrow();
  });
  it("no power and no investment produces no served demand", () => {
    const a = run(
      scenario({ initialPowerMW: 0, reinvestRatio: 0, policyFundingBPerQ: 0 }),
    );
    expect(a.series.every((r) => r.values.totalRevenueB === 0)).toBe(true);
  });
  it("no revenue demand means no commercial revenue or investment", () => {
    const a = run(
      scenario({
        initialDigitalDemandB: 0,
        initialPhysicalTaskDemand: 0,
        policyFundingBPerQ: 0,
      }),
    );
    expect(
      a.series.every(
        (r) => r.values.totalRevenueB === 0 && r.values.newInvestmentB === 0,
      ),
    ).toBe(true);
  });
  it("power outage recovers while destroyed compute stays destroyed", () => {
    const s = scenario({ reinvestRatio: 0, policyFundingBPerQ: 0 });
    s.events = [
      {
        id: "outage",
        type: "power-shock",
        startQuarter: "2026Q1",
        durationQuarters: 1,
        magnitude: 1,
      },
    ];
    const a = run(s);
    expect(a.series[0].values.availableComputePFLOPS).toBe(0);
    expect(a.series[1].values.availableComputePFLOPS).toBeGreaterThan(0);
    s.events = [{ ...s.events[0], type: "compute-destruction" }];
    expect(run(s).series.every((r) => r.values.computeStockPFLOPS === 0)).toBe(
      true,
    );
  });
  it("installation requires chips and memory even when cash was committed", () => {
    const a = run(scenario({ packagingWafersPerQ: 0, memorySupplyGBPerQ: 0 }));
    const p = a.details?.projects as Project[];
    expect(
      p.filter((p) => p.target !== "power").every((p) => p.installed === 0),
    ).toBe(true);
    expect(p.some((p) => p.target === "power" && p.installed > 0)).toBe(true);
  });
  it("does not spend investment twice on commissioning and conserves project budgets", () => {
    const a = run(scenario());
    for (const r of a.details?.ledger as Record<string, number>[]) {
      expect(
        r.cashStartB + r.operatingCashB + r.fundingB - r.investmentB,
      ).toBeCloseTo(r.cashEndB, 8);
    }
    for (const p of a.details?.projects as Project[]) {
      expect(p.commissionedB + p.cancelledB).toBeLessThanOrEqual(
        p.amountB + 1e-8,
      );
      expect(p.installed).toBeLessThanOrEqual(p.capacity + 1e-8);
      expect(p.due > p.committed).toBe(true);
    }
  });
  it("project delay is applied once at start, not every active quarter", () => {
    const s = scenario();
    s.events = [
      {
        id: "delay",
        type: "project-delay",
        startQuarter: "2026Q2",
        durationQuarters: 4,
        magnitude: 2,
      },
    ];
    const original = (run(scenario()).details?.projects as Project[]).find(
      (p) => p.id === "2026Q1:power",
    )!;
    const delayed = (run(s).details?.projects as Project[]).find(
      (p) => p.id === original.id,
    )!;
    expect(delayed.due).not.toBe(original.due);
    expect(delayed.due).toBe("2027Q1");
  });
  it("allocations never exceed supply across randomized bounded cases", () => {
    for (let i = 0; i < 30; i++) {
      const a = run(
        scenario({
          utilization: i / 30,
          investmentPhysicalShare: (30 - i) / 30,
          investmentPowerShare: i / 30,
          reinvestRatio: i / 30,
        }),
      );
      expect(infrawheelModel.checkInvariants(a)).toEqual([]);
    }
  });
  it("cancelled execution is not published", () => {
    expect(() =>
      executeRun(infrawheelModel, resolveScenario(scenario()), {
        scenarioId: "x",
        scenarioRevision: 1,
        ctx: { isCancelled: () => true },
      }),
    ).toThrow(ExecutionCancelled);
  });
  it("notes and event order do not change semantic input hash", () => {
    const a = resolveScenario(scenario());
    a.events = [
      {
        id: "b",
        type: "power-shock",
        startQuarter: "2026Q1",
        durationQuarters: 1,
        magnitude: 0.1,
      },
      {
        id: "a",
        type: "power-shock",
        startQuarter: "2026Q2",
        durationQuarters: 1,
        magnitude: 0.2,
      },
    ];
    const b = {
      ...a,
      events: [...a.events]
        .reverse()
        .map((e) => ({ ...e, note: "presentation only" })),
    };
    expect(hashRunInput(a)).toBe(hashRunInput(b));
  });
  it("UTF8 replacement behavior matches standard text encoder for unpaired surrogates", () => {
    expect(sha256Hex("\ud800")).toBe(sha256Hex("\ufffd"));
  });
});
