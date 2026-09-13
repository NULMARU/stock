import { describe, expect, it } from "vitest";
import {
  executeRun,
  hashRunInput,
  InvariantFailure,
  InvalidRunInput,
  verifyDeterministicReplay,
  type ModelRunOutput,
  type ResolvedRunInput,
  type SimulationModel,
} from "../index";
import { quantiles, sampleInputs, validateSamplingSpec } from "../sampling";
import type { SamplingSpec } from "../contracts";

/** Toy model: output = input.x * quarterIndexOffset; invariant: value >= 0. */
const toyModel: SimulationModel = {
  modelId: "toy",
  modelVersion: "toy-1.0",
  engineVersion: "engine-1.0",
  calibrationVersion: "cal-1.0",
  adapterVersion: "adapter-1.0",
  supportedSchemaVersions: [1],
  metrics: [
    {
      id: "value",
      label: "Value",
      unit: "count",
      kind: "flow",
      aggregation: "sum",
      comparableAcross: ["toy-1.0"],
    },
  ],
  validateInputs(inputs) {
    const x = inputs["x"];
    if (typeof x !== "number" || !Number.isFinite(x)) {
      return {
        ok: false,
        diagnostics: [
          { level: "error", code: "BAD_X", message: "x must be finite" },
        ],
      };
    }
    return { ok: true, diagnostics: [], normalized: { x } };
  },
  run(input): ModelRunOutput {
    const x = input.inputs["x"] as number;
    return {
      series: [
        {
          quarter: input.timeline.startQuarter,
          values: { value: x },
          constraintReasons: [],
        },
        {
          quarter: input.timeline.endQuarter,
          values: { value: x * 2 },
          constraintReasons: [],
        },
      ],
      diagnostics: [],
    };
  },
  checkInvariants(output) {
    const violations = [];
    for (const row of output.series) {
      const v = row.values["value"]!;
      if (!Number.isFinite(v) || v < 0) {
        violations.push({
          invariantId: "non-negative",
          quarter: row.quarter,
          message: `value ${v}`,
        });
      }
    }
    return violations;
  },
};

function makeInput(x: number): ResolvedRunInput {
  return {
    modelId: "toy",
    modelVersion: "toy-1.0",
    engineVersion: "engine-1.0",
    calibrationVersion: "cal-1.0",
    datasetVersion: "ds-1.0",
    adapterVersion: "adapter-1.0",
    timeline: {
      startQuarter: "2026Q1",
      endQuarter: "2026Q2",
      timeStep: "quarter",
    },
    inputs: { x },
    assumptionSetId: "toy-assumptions.v1",
    events: [],
    seed: 1,
    samplingSpec: null,
  };
}

describe("executeRun pipeline", () => {
  it("produces a run artifact with stable input/result hashes", () => {
    const a = executeRun(toyModel, makeInput(3), {
      scenarioId: "s1",
      scenarioRevision: 1,
    });
    const b = executeRun(toyModel, makeInput(3), {
      scenarioId: "s1",
      scenarioRevision: 1,
    });
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.resultHash).toBe(b.resultHash);
    expect(a.runId).toBe(b.runId);
    const c = executeRun(toyModel, makeInput(4), {
      scenarioId: "s1",
      scenarioRevision: 1,
    });
    expect(c.inputHash).not.toBe(a.inputHash);
  });

  it("rejects invalid inputs without partial results", () => {
    expect(() =>
      executeRun(toyModel, makeInput(Number.NaN), {
        scenarioId: "s",
        scenarioRevision: 1,
      }),
    ).toThrow(InvalidRunInput);
  });

  it("rejects reversed timelines (F05)", () => {
    const input = makeInput(1);
    input.timeline = {
      startQuarter: "2030Q1",
      endQuarter: "2026Q1",
      timeStep: "quarter",
    };
    expect(() =>
      executeRun(toyModel, input, { scenarioId: "s", scenarioRevision: 1 }),
    ).toThrow(InvalidRunInput);
  });

  it("rejects duplicate event ids (V10)", () => {
    const input = makeInput(1);
    input.events = [
      {
        id: "e1",
        type: "t",
        startQuarter: "2026Q1",
        durationQuarters: 1,
        magnitude: 1,
      },
      {
        id: "e1",
        type: "t",
        startQuarter: "2026Q2",
        durationQuarters: 1,
        magnitude: 1,
      },
    ];
    expect(() =>
      executeRun(toyModel, input, { scenarioId: "s", scenarioRevision: 1 }),
    ).toThrow(/duplicate event id/);
  });

  it("blocks publication on invariant failure", () => {
    expect(() =>
      executeRun(toyModel, makeInput(-1), {
        scenarioId: "s",
        scenarioRevision: 1,
      }),
    ).toThrow(InvariantFailure);
  });

  it("verifies deterministic replay", () => {
    expect(verifyDeterministicReplay(toyModel, makeInput(5))).toBe(true);
  });

  it("input hash excludes presentation but includes semantics", () => {
    const base = makeInput(2);
    expect(hashRunInput(base)).toBe(hashRunInput({ ...base }));
    expect(hashRunInput({ ...base, seed: 2 })).not.toBe(hashRunInput(base));
    expect(hashRunInput({ ...base, calibrationVersion: "cal-2.0" })).not.toBe(
      hashRunInput(base),
    );
  });
});

describe("sampling (V13)", () => {
  const spec: SamplingSpec = {
    sampleCount: 200,
    seed: 99,
    distributions: {
      a: { kind: "uniform", min: 0, max: 10 },
      b: { kind: "normal", mean: 5, sd: 1, clampMin: 0 },
    },
  };

  it("validates distributions and correlation matrices", () => {
    expect(validateSamplingSpec(spec).ok).toBe(true);
    expect(validateSamplingSpec({ ...spec, sampleCount: 0 }).ok).toBe(false);
    expect(
      validateSamplingSpec({
        ...spec,
        correlation: { variables: ["a"], matrix: [[1, 0.5]] },
      }).ok,
    ).toBe(false);
    expect(
      validateSamplingSpec({
        ...spec,
        correlation: {
          variables: ["a", "b"],
          matrix: [
            [1, 0.3],
            [0.31, 1],
          ],
        },
      }).ok,
    ).toBe(false); // asymmetric
    expect(
      validateSamplingSpec({
        ...spec,
        correlation: {
          variables: ["a", "b"],
          matrix: [
            [1, 0.3],
            [0.3, 1],
          ],
        },
      }).ok,
    ).toBe(false); // 'a' is uniform → correlation only for normals
    expect(
      validateSamplingSpec({
        sampleCount: 10,
        seed: 1,
        distributions: {
          x: { kind: "normal", mean: 0, sd: 1 },
          y: { kind: "normal", mean: 0, sd: 1 },
        },
        correlation: {
          variables: ["x", "y"],
          matrix: [
            [1, 0.9],
            [0.9, 1],
          ],
        },
      }).ok,
    ).toBe(true);
    // Not positive semidefinite:
    expect(
      validateSamplingSpec({
        sampleCount: 10,
        seed: 1,
        distributions: {
          x: { kind: "normal", mean: 0, sd: 1 },
          y: { kind: "normal", mean: 0, sd: 1 },
          z: { kind: "normal", mean: 0, sd: 1 },
        },
        correlation: {
          variables: ["x", "y", "z"],
          matrix: [
            [1, 0.9, 0.9],
            [0.9, 1, -0.9],
            [0.9, -0.9, 1],
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it("reproduces per-sample draws independent of order", () => {
    const forward = [0, 1, 2, 3].map((i) => sampleInputs(spec, i).draws);
    const backward = [3, 2, 1, 0]
      .map((i) => sampleInputs(spec, i).draws)
      .reverse();
    expect(forward).toEqual(backward);
  });

  it("computes quantiles", () => {
    const q = quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(q.p50).toBeCloseTo(5.5);
    expect(q.sampleCount).toBe(10);
    expect(q.p10).toBeGreaterThanOrEqual(1);
    expect(q.p90).toBeLessThanOrEqual(10);
    expect(() => quantiles([])).toThrow();
  });
});
