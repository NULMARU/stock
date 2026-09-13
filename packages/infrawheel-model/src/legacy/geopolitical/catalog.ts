import type { RiskId, RiskStage } from '../types';

/** Engine-facing shock channels used by the three regional risk modules. */
export type RiskImpactKey =
  | 'memory'
  | 'packaging'
  | 'deliverablePower'
  | 'leadTime'
  | 'cloudEfficiency'
  | 'revenueGrowth'
  | 'reinvestRatio'
  | 'policyCAPEX';

export type RiskImpacts = Partial<Record<RiskImpactKey, number>>;

export interface RiskStageDefinition {
  /** Stable English identifier for UI/i18n lookup and diagnostics. */
  condition: string;
  /** Signed proportional shocks: -0.2 = -20%, 0.5 = +50%. */
  impacts: RiskImpacts;
  /** Number of quarters for which the full shock is held. */
  sustainQ: number;
  /** Catalog recovery duration before channel-specific timing adjustments. */
  recoveryQ: number;
}

export type RiskStageCatalog = Record<RiskStage, RiskStageDefinition>;

const neutral = (condition: string): RiskStageDefinition => ({
  condition,
  impacts: {},
  sustainQ: 0,
  recoveryQ: 0,
});

export const RISK_IDS: readonly RiskId[] = ['taiwan', 'russiaNato', 'middleEast'];
export const RISK_STAGES: readonly RiskStage[] = [0, 1, 2, 3, 4];

/**
 * Initial stress values approved for InfraWheel Lite.
 *
 * The values are scenario assumptions, not probability forecasts. Stage 0 means
 * "no additional shock beyond the baseline", including for conflicts that are
 * already reflected in the baseline parameters.
 */
export const RISK_CATALOG: Record<RiskId, RiskStageCatalog> = {
  taiwan: {
    0: neutral('noAdditionalShock'),
    1: {
      condition: 'outlyingIslandsSeized',
      impacts: { packaging: -0.05, reinvestRatio: -0.15, policyCAPEX: 0.20 },
      sustainQ: 1,
      recoveryQ: 2,
    },
    2: {
      condition: 'quarantineAndSelectiveControls',
      impacts: { memory: -0.05, packaging: -0.30, reinvestRatio: -0.30, policyCAPEX: 0.50 },
      sustainQ: 2,
      recoveryQ: 6,
    },
    3: {
      condition: 'maritimeAndAirBlockade',
      impacts: { memory: -0.12, packaging: -0.80, reinvestRatio: -0.50, policyCAPEX: 1.00 },
      sustainQ: 4,
      recoveryQ: 12,
    },
    4: {
      condition: 'invasionAndRegionalWar',
      impacts: { memory: -0.20, packaging: -0.95, reinvestRatio: -0.70, policyCAPEX: 1.50 },
      sustainQ: 8,
      recoveryQ: 28,
    },
  },
  russiaNato: {
    0: neutral('noAdditionalShock'),
    1: {
      condition: 'escalationInsideUkraine',
      impacts: {
        deliverablePower: -0.02,
        leadTime: 0.05,
        revenueGrowth: -0.02,
        reinvestRatio: -0.05,
        policyCAPEX: 0.05,
      },
      sustainQ: 4,
      recoveryQ: 4,
    },
    2: {
      condition: 'energyAndBlackSeaExportDisruption',
      impacts: {
        deliverablePower: -0.06,
        leadTime: 0.15,
        revenueGrowth: -0.05,
        reinvestRatio: -0.12,
        policyCAPEX: 0.15,
      },
      sustainQ: 6,
      recoveryQ: 8,
    },
    3: {
      condition: 'limitedSpilloverOntoNatoTerritory',
      impacts: {
        deliverablePower: -0.12,
        leadTime: 0.30,
        cloudEfficiency: -0.04,
        revenueGrowth: -0.12,
        reinvestRatio: -0.30,
        policyCAPEX: 0.40,
      },
      sustainQ: 2,
      recoveryQ: 12,
    },
    4: {
      condition: 'sustainedDirectRussiaNatoWar',
      impacts: {
        deliverablePower: -0.22,
        leadTime: 0.50,
        cloudEfficiency: -0.10,
        revenueGrowth: -0.25,
        reinvestRatio: -0.50,
        policyCAPEX: 0.80,
      },
      sustainQ: 12,
      recoveryQ: 24,
    },
  },
  middleEast: {
    0: neutral('noAdditionalShock'),
    1: {
      condition: 'prolongedRedSeaRerouting',
      impacts: { leadTime: 0.05, revenueGrowth: -0.01, reinvestRatio: -0.03 },
      sustainQ: 4,
      recoveryQ: 3,
    },
    2: {
      condition: 'regionalEscalationIncludingPortsAndEnergyFacilities',
      impacts: {
        deliverablePower: -0.04,
        leadTime: 0.12,
        revenueGrowth: -0.04,
        reinvestRatio: -0.08,
        policyCAPEX: 0.10,
      },
      sustainQ: 4,
      recoveryQ: 6,
    },
    3: {
      condition: 'partialClosureOfHormuz',
      impacts: {
        deliverablePower: -0.12,
        leadTime: 0.25,
        revenueGrowth: -0.10,
        reinvestRatio: -0.20,
        policyCAPEX: 0.25,
      },
      sustainQ: 2,
      recoveryQ: 6,
    },
    4: {
      condition: 'prolongedHormuzBlockadeAndFacilityDestruction',
      impacts: {
        deliverablePower: -0.25,
        leadTime: 0.45,
        revenueGrowth: -0.20,
        reinvestRatio: -0.35,
        policyCAPEX: 0.50,
      },
      sustainQ: 4,
      recoveryQ: 12,
    },
  },
};

/** Defensive catalog lookup for decoded or otherwise untrusted runtime state. */
export function getRiskStageDefinition(riskId: RiskId, stage: RiskStage): RiskStageDefinition {
  return RISK_CATALOG[riskId][stage] ?? RISK_CATALOG[riskId][0];
}
