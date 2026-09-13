import { simulate } from '../engine';
import { aggregateLiteCycleOutput } from '../liteEngine';
import { expandLiteParams } from '../liteMapping';
import type {
  CycleOutput,
  GeoState,
  InfraWheelParams,
  LiteCycleOutput,
  LiteParams,
  RiskEvents,
  SimulationConfig,
} from '../types';
import {
  getRiskStageDefinition,
  RISK_IDS,
  type RiskImpactKey,
  type RiskImpacts,
} from './catalog';
import { combineRiskImpacts } from './saturation';
import { applyStructuralAxes } from './structuralAxes';
import { riskIntensityAtQuarter } from './timeline';

export const DEFAULT_RISK_EVENTS: RiskEvents = {
  taiwan: { stage: 0, startQuarter: '2025Q1' },
  russiaNato: { stage: 0, startQuarter: '2025Q1' },
  middleEast: { stage: 0, startQuarter: '2025Q1' },
};

export const DEFAULT_GEO_STATE: GeoState = {
  blocPct: 50,
  energyPct: 50,
  risks: DEFAULT_RISK_EVENTS,
};

export function createDefaultGeoState(startQuarter = '2025Q1'): GeoState {
  return {
    blocPct: 50,
    energyPct: 50,
    risks: {
      taiwan: { stage: 0, startQuarter },
      russiaNato: { stage: 0, startQuarter },
      middleEast: { stage: 0, startQuarter },
    },
  };
}

function cloneParams(params: Readonly<InfraWheelParams>): InfraWheelParams {
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

/** Return the saturated, signed event shocks active in a specific quarter. */
export function getCombinedRiskImpactsAtQuarter(
  geoState: GeoState,
  quarter: string,
): RiskImpacts {
  const activeImpacts: RiskImpacts[] = [];

  for (const riskId of RISK_IDS) {
    const event = geoState.risks[riskId];
    if (!event) continue;
    const definition = getRiskStageDefinition(riskId, event.stage);
    if (event.stage === 0) continue;

    const eventImpacts: RiskImpacts = {};
    for (const [impactKey, initialShock] of Object.entries(definition.impacts)) {
      const key = impactKey as RiskImpactKey;
      if (initialShock === undefined || !Number.isFinite(initialShock)) continue;
      const intensity = riskIntensityAtQuarter(event, definition, key, quarter);
      const activeShock = initialShock * intensity;
      if (Number.isFinite(activeShock) && activeShock !== 0) eventImpacts[key] = activeShock;
    }
    activeImpacts.push(eventImpacts);
  }

  return combineRiskImpacts(activeImpacts);
}

function applyMultiplier(value: number, adjustment: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(adjustment)) return Math.max(0, value);
  return Math.max(0, value * (1 + adjustment));
}

/**
 * Apply regional risk events to one quarter's evolving engine parameters.
 * The input is cloned, so repeatedly evaluating a full-impact hold never
 * compounds the same shock into the structural/evolving parameter state.
 */
export function applyRiskEventsAtQuarter(
  base: Readonly<InfraWheelParams>,
  geoState: GeoState,
  quarter: string,
): InfraWheelParams {
  const result = cloneParams(base);
  const impacts = getCombinedRiskImpactsAtQuarter(geoState, quarter);

  if (impacts.memory !== undefined) {
    result.silicon.bwMemory = applyMultiplier(result.silicon.bwMemory, impacts.memory);
    result.silicon.capMemory = applyMultiplier(result.silicon.capMemory, impacts.memory);
  }
  if (impacts.packaging !== undefined) {
    result.silicon.packaging = applyMultiplier(result.silicon.packaging, impacts.packaging);
  }
  if (impacts.deliverablePower !== undefined) {
    result.energy.deliverablePower = applyMultiplier(
      result.energy.deliverablePower,
      impacts.deliverablePower,
    );
  }
  if (impacts.leadTime !== undefined) {
    result.energy.leadTime = applyMultiplier(result.energy.leadTime, impacts.leadTime);
  }
  if (impacts.cloudEfficiency !== undefined) {
    result.hyperscaleDC.bisectionBW = applyMultiplier(
      result.hyperscaleDC.bisectionBW,
      impacts.cloudEfficiency,
    );
    result.hyperscaleDC.utilization = applyMultiplier(
      result.hyperscaleDC.utilization,
      impacts.cloudEfficiency,
    );
  }
  if (impacts.revenueGrowth !== undefined) {
    result.digitalAI.revenueGrowth = applyMultiplier(
      result.digitalAI.revenueGrowth,
      impacts.revenueGrowth,
    );
  }
  if (impacts.reinvestRatio !== undefined) {
    result.capital.reinvestRatio = applyMultiplier(
      result.capital.reinvestRatio,
      impacts.reinvestRatio,
    );
  }
  if (impacts.policyCAPEX !== undefined) {
    result.capital.policyCAPEX = applyMultiplier(result.capital.policyCAPEX, impacts.policyCAPEX);
  }

  return result;
}

/** Build the pure callback consumed by the engine's quarterly transform hook. */
export function createRiskQuarterlyTransform(geoState: GeoState) {
  return (evolving: Readonly<InfraWheelParams>, context: { quarter: string }): InfraWheelParams =>
    applyRiskEventsAtQuarter(evolving, geoState, context.quarter);
}

/**
 * Engine-parameter facade: structural axes once, then non-accumulating events
 * through the engine's per-quarter transform hook.
 */
export function simulateGeopoliticalEngine(
  params: InfraWheelParams,
  geoState: GeoState,
  config: SimulationConfig,
): CycleOutput[] {
  const structuralParams = applyStructuralAxes(params, geoState);
  return simulate(structuralParams, config, {
    quarterlyParamTransform: createRiskQuarterlyTransform(geoState),
  });
}

/** Run the complete geopolitical flow from the public 14-input Lite contract. */
export function simulateGeopolitical(
  params: LiteParams,
  geoState: GeoState,
  config: SimulationConfig,
): LiteCycleOutput[] {
  return simulateGeopoliticalEngine(expandLiteParams(params), geoState, config)
    .map(aggregateLiteCycleOutput);
}
