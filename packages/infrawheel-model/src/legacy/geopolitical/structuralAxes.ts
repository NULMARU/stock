import type { GeoState, InfraWheelParams } from '../types';

export type StructuralAxes = Pick<GeoState, 'blocPct' | 'energyPct'>;

type EngineAdjustmentKey =
  | 'bwMemory'
  | 'packaging'
  | 'deliverablePower'
  | 'leadTime'
  | 'computeDensity'
  | 'algorithmicEfficiency'
  | 'transferRatio'
  | 'policyCAPEX'
  | 'reinvestRatio'
  | 'utilization'
  | 'deploymentRate'
  | 'revenueGrowth';

type StructuralAdjustments = Partial<Record<EngineAdjustmentKey, number>>;

const PARAM_NODE_MAP: Record<
  EngineAdjustmentKey,
  { node: keyof InfraWheelParams; key: string }
> = {
  bwMemory: { node: 'silicon', key: 'bwMemory' },
  packaging: { node: 'silicon', key: 'packaging' },
  deliverablePower: { node: 'energy', key: 'deliverablePower' },
  leadTime: { node: 'energy', key: 'leadTime' },
  computeDensity: { node: 'energy', key: 'computeDensity' },
  algorithmicEfficiency: { node: 'intelligence', key: 'algorithmicEfficiency' },
  transferRatio: { node: 'intelligence', key: 'transferRatio' },
  policyCAPEX: { node: 'capital', key: 'policyCAPEX' },
  reinvestRatio: { node: 'capital', key: 'reinvestRatio' },
  utilization: { node: 'hyperscaleDC', key: 'utilization' },
  deploymentRate: { node: 'spatialCompute', key: 'deploymentRate' },
  revenueGrowth: { node: 'digitalAI', key: 'revenueGrowth' },
};

function cloneParams(params: InfraWheelParams): InfraWheelParams {
  return {
    silicon: { ...params.silicon },
    energy: { ...params.energy },
    intelligence: { ...params.intelligence },
    capital: { ...params.capital },
    hyperscaleDC: { ...params.hyperscaleDC },
    digitalAI: { ...params.digitalAI },
    spatialCompute: { ...params.spatialCompute },
    physicalAI: { ...params.physicalAI },
  };
}

function normalizedAxis(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

/** Piecewise-linear adjustment anchored to zero at the current-world value 50. */
function anchoredLerp(pct: number, lowAdjustment: number, highAdjustment: number): number {
  if (pct <= 50) return lowAdjustment * (1 - pct / 50);
  return highAdjustment * ((pct - 50) / 50);
}

function blocAdjustments(value: number): StructuralAdjustments {
  const blocPct = normalizedAxis(value);
  return {
    packaging: anchoredLerp(blocPct, 0.15, -0.35),
    bwMemory: anchoredLerp(blocPct, 0.05, -0.15),
    policyCAPEX: anchoredLerp(blocPct, -0.30, 0.80),
    reinvestRatio: anchoredLerp(blocPct, 0.05, -0.15),
    algorithmicEfficiency: anchoredLerp(blocPct, -0.05, 0.15),
    transferRatio: anchoredLerp(blocPct, 0.10, -0.25),
    deploymentRate: anchoredLerp(blocPct, 0, 0.10),
    revenueGrowth: anchoredLerp(blocPct, 0.05, -0.15),
  };
}

function energyAdjustments(value: number): StructuralAdjustments {
  const energyPct = normalizedAxis(value);
  return {
    deliverablePower: anchoredLerp(energyPct, -0.30, 0.40),
    leadTime: anchoredLerp(energyPct, 0.50, -0.40),
    computeDensity: anchoredLerp(energyPct, -0.10, 0.20),
    utilization: anchoredLerp(energyPct, -0.05, 0.05),
  };
}

/** Return engine-parameter adjustment percentages for UI and diagnostics. */
export function getStructuralAdjustmentPcts(axes: StructuralAxes): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const adjustments of [blocAdjustments(axes.blocPct), energyAdjustments(axes.energyPct)]) {
    for (const [key, adjustment] of Object.entries(adjustments)) {
      if (adjustment === undefined || !Number.isFinite(adjustment)) continue;
      combined[key] = (combined[key] ?? 0) + adjustment;
    }
  }
  return combined;
}

/** Apply the long-run bloc and energy axes exactly once without mutating input. */
export function applyStructuralAxes(
  base: InfraWheelParams,
  axes: StructuralAxes,
): InfraWheelParams {
  const result = cloneParams(base);
  const adjustments = getStructuralAdjustmentPcts(axes);

  for (const [key, adjustment] of Object.entries(adjustments)) {
    const mapping = PARAM_NODE_MAP[key as EngineAdjustmentKey];
    if (!mapping) continue;
    const node = result[mapping.node] as Record<string, number>;
    const baseValue = node[mapping.key];
    if (baseValue === undefined || !Number.isFinite(baseValue)) continue;
    node[mapping.key] = Math.max(0, baseValue * (1 + adjustment));
  }

  return result;
}
