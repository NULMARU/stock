/**
 * Deterministic sensitivity analysis (U01): one-factor range sweeps and
 * two-factor grids. No probability claims — outputs are conditional ranges
 * under the caller's chosen input values.
 */

export interface SweepPoint {
  value: number;
  /** Model-run summary metric for this point (caller-defined projection). */
  result: number;
}

export interface SweepResult<I> {
  path: keyof I & string;
  points: SweepPoint[];
}

/**
 * Run `evaluate` over `steps` evenly spaced values of one input path.
 * `evaluate` must be deterministic. We observe the full path — final-quarter
 * only checks miss threshold/saturation effects (validation doc §7).
 */
export function sweepInput<I extends Record<string, number>>(
  base: I,
  path: keyof I & string,
  min: number,
  max: number,
  steps: number,
  evaluate: (inputs: I) => number,
): SweepResult<I> {
  if (steps < 2 || steps>10000 || !Number.isInteger(steps))
    throw new Error("steps must be an integer >= 2");
  if (!Number.isFinite(min)||!Number.isFinite(max)||!(min < max)) throw new Error("sweep requires min < max");
  const points: SweepPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const value = min + ((max - min) * i) / (steps - 1);
    points.push({ value, result: evaluate({ ...base, [path]: value }) });
  }
  return { path, points };
}

export interface GridResult {
  xPath: string;
  yPath: string;
  xValues: number[];
  yValues: number[];
  /** results[y][x] */
  results: number[][];
}

export function gridInputs<I extends Record<string, number>>(
  base: I,
  xPath: keyof I & string,
  yPath: keyof I & string,
  xRange: { min: number; max: number; steps: number },
  yRange: { min: number; max: number; steps: number },
  evaluate: (inputs: I) => number,
): GridResult {
  if(xPath===yPath||xRange.steps*yRange.steps>100000)throw new Error("invalid grid dimensions");
  const linspace = (r: { min: number; max: number; steps: number }) => {
    if (!Number.isInteger(r.steps)||r.steps < 2 || !Number.isFinite(r.min)||!Number.isFinite(r.max)||!(r.min < r.max))
      throw new Error("grid range requires min < max and steps >= 2");
    return Array.from(
      { length: r.steps },
      (_, i) => r.min + ((r.max - r.min) * i) / (r.steps - 1),
    );
  };
  const xValues = linspace(xRange);
  const yValues = linspace(yRange);
  const results = yValues.map((y) =>
    xValues.map((x) => evaluate({ ...base, [xPath]: x, [yPath]: y })),
  );
  return { xPath, yPath, xValues, yValues, results };
}
