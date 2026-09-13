/**
 * InfraWheel Lite's single source of truth for the three composite indices.
 *
 * The public 14 inputs are expanded to the upstream engine's 18 parameters.
 * Reverse mapping is necessarily lossy for arbitrary legacy parameter pairs, so
 * pairs are projected onto the nearest point of the corresponding anchor curve.
 */

import { DEFAULT_PARAMS } from './defaults';
import type { InfraWheelParams, LiteParams } from './types';

export const MEMORY_SUPPLY_ANCHORS = [
  { index: 0, bwMemory: 20, capMemory: 50 },
  { index: 10, bwMemory: 35, capMemory: 150 },
  { index: 50, bwMemory: 85, capMemory: 550 },
  { index: 100, bwMemory: 120, capMemory: 2_000 },
] as const;

export const CLOUD_EFFICIENCY_ANCHORS = [
  { index: 0, bisectionBW: 10, utilization: 30 },
  { index: 50, bisectionBW: 75, utilization: 43 },
  { index: 100, bisectionBW: 200, utilization: 75 },
] as const;

export const EDGE_READINESS_ANCHORS = [
  { index: 0, deploymentRate: 0, perNodeTOPS: 50 },
  { index: 50, deploymentRate: 3, perNodeTOPS: 350 },
  { index: 55, deploymentRate: 6, perNodeTOPS: 350 },
  { index: 70, deploymentRate: 25, perNodeTOPS: 400 },
  { index: 80, deploymentRate: 35, perNodeTOPS: 600 },
  { index: 100, deploymentRate: 60, perNodeTOPS: 2_000 },
] as const;

interface CurveAnchor {
  index: number;
  values: readonly number[];
}

const MEMORY_CURVE: readonly CurveAnchor[] = MEMORY_SUPPLY_ANCHORS.map((anchor) => ({
  index: anchor.index,
  values: [anchor.bwMemory, anchor.capMemory],
}));

const CLOUD_CURVE: readonly CurveAnchor[] = CLOUD_EFFICIENCY_ANCHORS.map((anchor) => ({
  index: anchor.index,
  values: [anchor.bisectionBW, anchor.utilization],
}));

const EDGE_CURVE: readonly CurveAnchor[] = EDGE_READINESS_ANCHORS.map((anchor) => ({
  index: anchor.index,
  values: [anchor.deploymentRate, anchor.perNodeTOPS],
}));

export const DEFAULT_LITE_PARAMS: LiteParams = {
  silicon: {
    memorySupplyIndex: 50,
    packaging: DEFAULT_PARAMS.silicon.packaging,
  },
  energy: {
    deliverablePower: DEFAULT_PARAMS.energy.deliverablePower,
    leadTime: DEFAULT_PARAMS.energy.leadTime,
    computeDensity: DEFAULT_PARAMS.energy.computeDensity,
  },
  aiInfrastructure: {
    cloudEfficiencyIndex: 50,
    edgeReadinessIndex: 50,
  },
  intelligence: {
    algorithmicEfficiency: DEFAULT_PARAMS.intelligence.algorithmicEfficiency,
    transferRatio: DEFAULT_PARAMS.intelligence.transferRatio,
  },
  aiApplications: {
    revenueGrowth: DEFAULT_PARAMS.digitalAI.revenueGrowth,
    grossMargin: DEFAULT_PARAMS.digitalAI.grossMargin,
    unitEconomics: DEFAULT_PARAMS.physicalAI.unitEconomics,
  },
  capital: {
    reinvestRatio: DEFAULT_PARAMS.capital.reinvestRatio,
    policyCAPEX: DEFAULT_PARAMS.capital.policyCAPEX,
  },
};

interface Range {
  min: number;
  max: number;
}

const RANGES = {
  index: { min: 0, max: 100 },
  packaging: { min: 30, max: 200 },
  deliverablePower: { min: 15, max: 80 },
  leadTime: { min: 12, max: 60 },
  computeDensity: { min: 5, max: 50 },
  algorithmicEfficiency: { min: 100, max: 2_000 },
  transferRatio: { min: 10, max: 80 },
  revenueGrowth: { min: 15, max: 80 },
  grossMargin: { min: 20, max: 75 },
  unitEconomics: { min: 0.2, max: 1.5 },
  reinvestRatio: { min: 15, max: 50 },
  policyCAPEX: { min: 0, max: 80 },
} as const satisfies Record<string, Range>;

function finiteClamped(value: unknown, fallback: number, range: Range): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

/** Return a finite, in-range deep copy suitable for engine expansion. */
export function normalizeLiteParams(params: LiteParams): LiteParams {
  return {
    silicon: {
      memorySupplyIndex: finiteClamped(
        params.silicon.memorySupplyIndex,
        DEFAULT_LITE_PARAMS.silicon.memorySupplyIndex,
        RANGES.index,
      ),
      packaging: finiteClamped(
        params.silicon.packaging,
        DEFAULT_LITE_PARAMS.silicon.packaging,
        RANGES.packaging,
      ),
    },
    energy: {
      deliverablePower: finiteClamped(
        params.energy.deliverablePower,
        DEFAULT_LITE_PARAMS.energy.deliverablePower,
        RANGES.deliverablePower,
      ),
      leadTime: finiteClamped(
        params.energy.leadTime,
        DEFAULT_LITE_PARAMS.energy.leadTime,
        RANGES.leadTime,
      ),
      computeDensity: finiteClamped(
        params.energy.computeDensity,
        DEFAULT_LITE_PARAMS.energy.computeDensity,
        RANGES.computeDensity,
      ),
    },
    aiInfrastructure: {
      cloudEfficiencyIndex: finiteClamped(
        params.aiInfrastructure.cloudEfficiencyIndex,
        DEFAULT_LITE_PARAMS.aiInfrastructure.cloudEfficiencyIndex,
        RANGES.index,
      ),
      edgeReadinessIndex: finiteClamped(
        params.aiInfrastructure.edgeReadinessIndex,
        DEFAULT_LITE_PARAMS.aiInfrastructure.edgeReadinessIndex,
        RANGES.index,
      ),
    },
    intelligence: {
      algorithmicEfficiency: finiteClamped(
        params.intelligence.algorithmicEfficiency,
        DEFAULT_LITE_PARAMS.intelligence.algorithmicEfficiency,
        RANGES.algorithmicEfficiency,
      ),
      transferRatio: finiteClamped(
        params.intelligence.transferRatio,
        DEFAULT_LITE_PARAMS.intelligence.transferRatio,
        RANGES.transferRatio,
      ),
    },
    aiApplications: {
      revenueGrowth: finiteClamped(
        params.aiApplications.revenueGrowth,
        DEFAULT_LITE_PARAMS.aiApplications.revenueGrowth,
        RANGES.revenueGrowth,
      ),
      grossMargin: finiteClamped(
        params.aiApplications.grossMargin,
        DEFAULT_LITE_PARAMS.aiApplications.grossMargin,
        RANGES.grossMargin,
      ),
      unitEconomics: finiteClamped(
        params.aiApplications.unitEconomics,
        DEFAULT_LITE_PARAMS.aiApplications.unitEconomics,
        RANGES.unitEconomics,
      ),
    },
    capital: {
      reinvestRatio: finiteClamped(
        params.capital.reinvestRatio,
        DEFAULT_LITE_PARAMS.capital.reinvestRatio,
        RANGES.reinvestRatio,
      ),
      policyCAPEX: finiteClamped(
        params.capital.policyCAPEX,
        DEFAULT_LITE_PARAMS.capital.policyCAPEX,
        RANGES.policyCAPEX,
      ),
    },
  };
}

function interpolateCurve(index: number, curve: readonly CurveAnchor[]): number[] {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  const safeIndex = finiteClamped(index, 50, { min: first.index, max: last.index });

  if (safeIndex <= first.index) return [...first.values];
  if (safeIndex >= last.index) return [...last.values];

  for (let i = 1; i < curve.length; i++) {
    const upper = curve[i]!;
    if (safeIndex > upper.index) continue;
    const lower = curve[i - 1]!;
    const t = (safeIndex - lower.index) / (upper.index - lower.index);
    return lower.values.map((value, valueIndex) => {
      const upperValue = upper.values[valueIndex]!;
      return value + (upperValue - value) * t;
    });
  }

  return [...last.values];
}

/** Expand the 14 public inputs to the existing 18-parameter engine contract. */
export function expandLiteParams(params: LiteParams): InfraWheelParams {
  const lite = normalizeLiteParams(params);
  const [bwMemory, capMemory] = interpolateCurve(lite.silicon.memorySupplyIndex, MEMORY_CURVE);
  const [bisectionBW, utilization] = interpolateCurve(
    lite.aiInfrastructure.cloudEfficiencyIndex,
    CLOUD_CURVE,
  );
  const [deploymentRate, perNodeTOPS] = interpolateCurve(
    lite.aiInfrastructure.edgeReadinessIndex,
    EDGE_CURVE,
  );

  return {
    silicon: {
      bwMemory: bwMemory!,
      capMemory: capMemory!,
      packaging: lite.silicon.packaging,
    },
    energy: { ...lite.energy },
    intelligence: { ...lite.intelligence },
    capital: { ...lite.capital },
    hyperscaleDC: {
      bisectionBW: bisectionBW!,
      utilization: utilization!,
    },
    digitalAI: {
      revenueGrowth: lite.aiApplications.revenueGrowth,
      grossMargin: lite.aiApplications.grossMargin,
    },
    spatialCompute: {
      deploymentRate: deploymentRate!,
      perNodeTOPS: perNodeTOPS!,
    },
    physicalAI: {
      fleetDeployment: DEFAULT_PARAMS.physicalAI.fleetDeployment,
      unitEconomics: lite.aiApplications.unitEconomics,
    },
  };
}

/**
 * Project a legacy parameter vector onto a piecewise-linear composite curve.
 * Each dimension is divided by its full anchor span so unlike units contribute
 * comparably to the distance.
 */
function projectOntoCurve(
  rawValues: readonly number[],
  curve: readonly CurveAnchor[],
  fallbackValues: readonly number[],
): number {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  const values = rawValues.map((value, index) =>
    Number.isFinite(value) ? value : fallbackValues[index]!,
  );
  const spans = first.values.map((value, index) =>
    Math.max(Math.abs(last.values[index]! - value), Number.EPSILON),
  );

  let bestIndex = 50;
  let bestError = Number.POSITIVE_INFINITY;

  for (let i = 1; i < curve.length; i++) {
    const lower = curve[i - 1]!;
    const upper = curve[i]!;
    let numerator = 0;
    let denominator = 0;

    for (let j = 0; j < values.length; j++) {
      const start = lower.values[j]! / spans[j]!;
      const direction = (upper.values[j]! - lower.values[j]!) / spans[j]!;
      const targetOffset = values[j]! / spans[j]! - start;
      numerator += targetOffset * direction;
      denominator += direction * direction;
    }

    const t = denominator > 0
      ? Math.min(1, Math.max(0, numerator / denominator))
      : 0;
    let error = 0;
    for (let j = 0; j < values.length; j++) {
      const projected = lower.values[j]! + (upper.values[j]! - lower.values[j]!) * t;
      const residual = (values[j]! - projected) / spans[j]!;
      error += residual * residual;
    }

    if (error < bestError) {
      bestError = error;
      bestIndex = lower.index + (upper.index - lower.index) * t;
    }
  }

  return finiteClamped(bestIndex, 50, RANGES.index);
}

/** Collapse legacy 18-parameter state into the closest 14-input Lite state. */
export function collapseEngineParams(params: InfraWheelParams): LiteParams {
  return normalizeLiteParams({
    silicon: {
      memorySupplyIndex: projectOntoCurve(
        [params.silicon.bwMemory, params.silicon.capMemory],
        MEMORY_CURVE,
        [DEFAULT_PARAMS.silicon.bwMemory, DEFAULT_PARAMS.silicon.capMemory],
      ),
      packaging: params.silicon.packaging,
    },
    energy: { ...params.energy },
    aiInfrastructure: {
      cloudEfficiencyIndex: projectOntoCurve(
        [params.hyperscaleDC.bisectionBW, params.hyperscaleDC.utilization],
        CLOUD_CURVE,
        [DEFAULT_PARAMS.hyperscaleDC.bisectionBW, DEFAULT_PARAMS.hyperscaleDC.utilization],
      ),
      edgeReadinessIndex: projectOntoCurve(
        [params.spatialCompute.deploymentRate, params.spatialCompute.perNodeTOPS],
        EDGE_CURVE,
        [DEFAULT_PARAMS.spatialCompute.deploymentRate, DEFAULT_PARAMS.spatialCompute.perNodeTOPS],
      ),
    },
    intelligence: { ...params.intelligence },
    aiApplications: {
      revenueGrowth: params.digitalAI.revenueGrowth,
      grossMargin: params.digitalAI.grossMargin,
      unitEconomics: params.physicalAI.unitEconomics,
    },
    capital: { ...params.capital },
  });
}
