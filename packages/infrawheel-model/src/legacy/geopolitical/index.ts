export {
  RISK_CATALOG,
  RISK_IDS,
  RISK_STAGES,
  getRiskStageDefinition,
} from './catalog';
export type {
  RiskImpactKey,
  RiskImpacts,
  RiskStageCatalog,
  RiskStageDefinition,
} from './catalog';

export {
  IMPACT_LIMITS,
  combineImpactChannel,
  combineRiskImpacts,
  combineSaturatedSeverities,
} from './saturation';
export type { ImpactDirection, ImpactLimit } from './saturation';

export {
  getRiskTiming,
  quarterOrdinal,
  riskIntensityAtQuarter,
} from './timeline';
export type { RiskTiming, RiskTimingProfile } from './timeline';

export {
  applyStructuralAxes,
  getStructuralAdjustmentPcts,
} from './structuralAxes';
export type { StructuralAxes } from './structuralAxes';

export {
  DEFAULT_GEO_STATE,
  DEFAULT_RISK_EVENTS,
  applyRiskEventsAtQuarter,
  createDefaultGeoState,
  createRiskQuarterlyTransform,
  getCombinedRiskImpactsAtQuarter,
  simulateGeopolitical,
  simulateGeopoliticalEngine,
} from './overlay';

export type {
  GeoState,
  RiskEvent,
  RiskEvents,
  RiskId,
  RiskStage,
} from '../types';
