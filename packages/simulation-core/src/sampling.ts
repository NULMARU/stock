/**
 * Seeded sampling (P5/U02): distribution validation, correlation checks, and
 * per-sample streams that do not depend on worker count or completion order.
 * Underspecified distributions are never invented — sampling runs only over
 * inputs the caller explicitly assigned a distribution to.
 */

import { createSamplePrng, PRNG_VERSION, type Prng } from "./prng";
import type { Diagnostic, DistributionSpec, SamplingSpec } from "./contracts";

export interface SamplingValidation {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export function validateSamplingSpec(spec: SamplingSpec): SamplingValidation {
  const diagnostics: Diagnostic[] = [];
  if (
    !spec ||
    !spec.distributions ||
    typeof spec.distributions !== "object" ||
    Array.isArray(spec.distributions)
  )
    return {
      ok: false,
      diagnostics: [
        { level: "error", code: "SHAPE", message: "분포 입력 형식 오류" },
      ],
    };
  if (
    !Number.isInteger(spec.sampleCount) ||
    spec.sampleCount < 1 ||
    spec.sampleCount > 100_000
  ) {
    diagnostics.push({
      level: "error",
      code: "BAD_SAMPLE_COUNT",
      message: `sampleCount must be an integer in 1..100000, got ${spec.sampleCount}`,
    });
  }
  if (!Number.isInteger(spec.seed)) {
    diagnostics.push({
      level: "error",
      code: "BAD_SEED",
      message: "seed must be an integer",
    });
  }
  for (const [path, dist] of Object.entries(spec.distributions)) {
    const err = validateDistribution(dist);
    if (err)
      diagnostics.push({
        level: "error",
        code: "BAD_DISTRIBUTION",
        message: `${path}: ${err}`,
      });
  }
  if (spec.correlation) {
    const { variables, matrix } = spec.correlation;
    if (!Array.isArray(variables) || !Array.isArray(matrix))
      return {
        ok: false,
        diagnostics: [
          {
            level: "error",
            code: "BAD_CORRELATION",
            message: "상관 행렬 형식 오류",
          },
        ],
      };
    const n = variables.length;
    if (
      new Set(variables).size !== n ||
      !matrix.every((row) => Array.isArray(row) && row.every(Number.isFinite))
    )
      return {
        ok: false,
        diagnostics: [
          {
            level: "error",
            code: "BAD_CORRELATION",
            message: "중복 변수 또는 유한하지 않은 상관 값",
          },
        ],
      };
    if (matrix.length !== n || matrix.some((row) => row.length !== n)) {
      diagnostics.push({
        level: "error",
        code: "BAD_CORRELATION",
        message: "correlation matrix must be square and match variables",
      });
    } else {
      for (let i = 0; i < n; i++) {
        if (Math.abs(matrix[i]![i]! - 1) > 1e-9) {
          diagnostics.push({
            level: "error",
            code: "BAD_CORRELATION",
            message: `correlation diagonal [${i}] must be 1`,
          });
        }
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(matrix[i]![j]! - matrix[j]![i]!) > 1e-12) {
            diagnostics.push({
              level: "error",
              code: "BAD_CORRELATION",
              message: "correlation matrix must be symmetric",
            });
          }
          if (Math.abs(matrix[i]![j]!) > 1 + 1e-9) {
            diagnostics.push({
              level: "error",
              code: "BAD_CORRELATION",
              message: "correlation entries must be within [-1, 1]",
            });
          }
        }
      }
      // Positive-semidefinite check via Sylvester's criterion on the Cholesky
      // factorization attempt: if it fails, the matrix is not a valid correlation.
      if (!isPositiveSemidefinite(matrix)) {
        diagnostics.push({
          level: "error",
          code: "BAD_CORRELATION",
          message: "correlation matrix is not positive semidefinite",
        });
      }
      for (const v of variables) {
        if (!(v in spec.distributions)) {
          diagnostics.push({
            level: "error",
            code: "BAD_CORRELATION",
            message: `correlated variable ${v} has no distribution`,
          });
        } else if (spec.distributions[v]!.kind !== "normal") {
          diagnostics.push({
            level: "error",
            code: "BAD_CORRELATION",
            message: `correlated variable ${v} must have a normal marginal (Cholesky coupling); got ${spec.distributions[v]!.kind}`,
          });
        }
      }
    }
  }
  return { ok: diagnostics.every((d) => d.level !== "error"), diagnostics };
}

function validateDistribution(d: DistributionSpec): string | null {
  if (!d || typeof d !== "object") return "invalid distribution";
  switch (d.kind) {
    case "uniform":
      return Number.isFinite(d.min) && Number.isFinite(d.max) && d.min < d.max
        ? null
        : "uniform requires finite min < max";
    case "normal":
      if (!Number.isFinite(d.mean) || !Number.isFinite(d.sd) || d.sd <= 0)
        return "normal requires finite mean and sd > 0";
      if (
        [d.clampMin, d.clampMax].some(
          (v) => v !== undefined && !Number.isFinite(v),
        )
      )
        return "clamps must be finite";
      if (
        d.clampMin !== undefined &&
        d.clampMax !== undefined &&
        d.clampMin >= d.clampMax
      )
        return "normal clamps must satisfy clampMin < clampMax";
      return null;
    case "triangular":
      return Number.isFinite(d.min) &&
        Number.isFinite(d.mode) &&
        Number.isFinite(d.max) &&
        d.min <= d.mode &&
        d.mode <= d.max &&
        d.min < d.max
        ? null
        : "triangular requires min <= mode <= max and min < max";
    default:
      return "unknown distribution kind";
  }
}

function isPositiveSemidefinite(m: number[][]): boolean {
  const n = m.length;
  // Cholesky with small negative tolerance.
  const l: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i]![j]!;
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (sum < -1e-9) return false;
        l[i]![j] = Math.sqrt(Math.max(0, sum));
      } else {
        const diag = l[j]![j]!;
        if (diag <= 1e-12 && Math.abs(sum) > 1e-9) return false;
        l[i]![j] = diag > 1e-12 ? sum / diag : 0;
      }
    }
  }
  return true;
}

/** Draw one value for a distribution from the given stream. */
export function drawDistribution(dist: DistributionSpec, prng: Prng): number {
  switch (dist.kind) {
    case "uniform":
      return dist.min + (dist.max - dist.min) * prng.next();
    case "normal": {
      // Box-Muller
      const u1 = Math.max(prng.next(), Number.MIN_VALUE);
      const u2 = prng.next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      let v = dist.mean + dist.sd * z;
      if (dist.clampMin !== undefined) v = Math.max(dist.clampMin, v);
      if (dist.clampMax !== undefined) v = Math.min(dist.clampMax, v);
      return v;
    }
    case "triangular": {
      const u = prng.next();
      const fc = (dist.mode - dist.min) / (dist.max - dist.min);
      if (u < fc)
        return (
          dist.min +
          Math.sqrt(u * (dist.max - dist.min) * (dist.mode - dist.min))
        );
      return (
        dist.max -
        Math.sqrt((1 - u) * (dist.max - dist.min) * (dist.max - dist.mode))
      );
    }
  }
}

/**
 * Deterministically sample the inputs for sample i. Each sample uses its own
 * derived stream, so parallel execution in any order gives identical results.
 * Correlated variables share a correlated normal draw mapped through inverse
 * CDFs (normals) — for non-normal marginals we keep independence and record a
 * diagnostic at the call site instead of silently approximating.
 */
export function sampleInputs(
  spec: SamplingSpec,
  sampleIndex: number,
): { draws: Record<string, number>; diagnostics: Diagnostic[] } {
  const valid = validateSamplingSpec(spec);
  if (
    !valid.ok ||
    !Number.isSafeInteger(sampleIndex) ||
    sampleIndex < 0 ||
    sampleIndex >= spec.sampleCount
  )
    throw new Error("Invalid sampling input");
  const prng = createSamplePrng(spec.seed, sampleIndex);
  const draws: Record<string, number> = {};
  const diagnostics: Diagnostic[] = [];

  const paths = Object.keys(spec.distributions).sort();
  if (spec.correlation) {
    const { variables, matrix } = spec.correlation;
    const allNormal = variables.every(
      (v) => spec.distributions[v]?.kind === "normal",
    );
    if (!allNormal) {
      diagnostics.push({
        level: "warning",
        code: "CORRELATION_IGNORED",
        message:
          "correlation is applied only to normal marginals; non-normal correlated variables are sampled independently",
      });
    } else {
      // Cholesky-correlated standard normals in fixed variable order.
      const l = cholesky(matrix);
      const z = variables.map(() => {
        const u1 = Math.max(prng.next(), Number.MIN_VALUE);
        const u2 = prng.next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      });
      const correlated = variables.map((_, i) => {
        let s = 0;
        for (let k = 0; k <= i; k++) s += l[i]![k]! * z[k]!;
        return s;
      });
      variables.forEach((v, i) => {
        const d = spec.distributions[v]!;
        if (d.kind === "normal") {
          let val = d.mean + d.sd * correlated[i]!;
          if (d.clampMin !== undefined) val = Math.max(d.clampMin, val);
          if (d.clampMax !== undefined) val = Math.min(d.clampMax, val);
          draws[v] = val;
        }
      });
    }
  }
  for (const path of paths) {
    if (path in draws) continue;
    draws[path] = drawDistribution(spec.distributions[path]!, prng);
  }
  return { draws, diagnostics };
}

function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const l: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i]![j]!;
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        l[i]![j] = Math.sqrt(Math.max(0, sum));
      } else {
        const diag = l[j]![j]!;
        l[i]![j] = diag > 1e-12 ? sum / diag : 0;
      }
    }
  }
  return l;
}

export interface Quantiles {
  p10: number;
  p50: number;
  p90: number;
  sampleCount: number;
}

export function quantiles(values: readonly number[]): Quantiles {
  if (!values.every(Number.isFinite)) throw new Error("nonfinite sample");
  if (values.length === 0) throw new Error("quantiles of empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const w = idx - lo;
    return sorted[lo]! * (1 - w) + sorted[hi]! * w;
  };
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), sampleCount: values.length };
}

/**
 * Sample-count stability: compare quantiles across increasing sample counts
 * (e.g. 250 → 500 → 1000). Callers decide the acceptable drift; this reports
 * the max absolute change between consecutive sizes per metric band.
 */
export function quantileStability(series: number[][]): {
  perStepMaxDrift: number[];
} {
  const perStepMaxDrift: number[] = [];
  let prev: Quantiles | null = null;
  for (const values of series) {
    const q = quantiles(values);
    if (prev) {
      perStepMaxDrift.push(
        Math.max(
          Math.abs(q.p10 - prev.p10),
          Math.abs(q.p50 - prev.p50),
          Math.abs(q.p90 - prev.p90),
        ),
      );
    }
    prev = q;
  }
  return { perStepMaxDrift };
}

export { PRNG_VERSION };
