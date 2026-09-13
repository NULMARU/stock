import type { RiskEvent } from '../types';
import type { RiskImpactKey, RiskStageDefinition } from './catalog';

export type RiskTimingProfile = 'operational' | 'market' | 'policy';

const PROFILE_BY_IMPACT: Record<RiskImpactKey, RiskTimingProfile> = {
  memory: 'operational',
  packaging: 'operational',
  deliverablePower: 'operational',
  leadTime: 'operational',
  cloudEfficiency: 'operational',
  revenueGrowth: 'market',
  reinvestRatio: 'market',
  policyCAPEX: 'policy',
};

export interface RiskTiming {
  delayQ: number;
  sustainQ: number;
  recoveryQ: number;
}

/** Convert a strict `YYYYQn` label to a monotonically increasing quarter index. */
export function quarterOrdinal(quarter: string): number | null {
  const match = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (!match) return null;
  const year = Number(match[1]);
  const q = Number(match[2]);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(q)) return null;
  return year * 4 + q - 1;
}

function normalizedHoldOverride(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

/** Resolve the channel-specific delay, full-impact hold and recovery durations. */
export function getRiskTiming(
  event: RiskEvent,
  definition: RiskStageDefinition,
  impactKey: RiskImpactKey,
): RiskTiming {
  const profile = PROFILE_BY_IMPACT[impactKey];
  const sustainQ = normalizedHoldOverride(event.durationOverrideQ, definition.sustainQ);

  if (profile === 'market') {
    return { delayQ: 0, sustainQ, recoveryQ: Math.ceil(definition.recoveryQ / 2) };
  }
  if (profile === 'policy') {
    return { delayQ: 1, sustainQ, recoveryQ: Math.ceil(definition.recoveryQ * 1.5) };
  }
  return { delayQ: 0, sustainQ, recoveryQ: definition.recoveryQ };
}

/**
 * Return the shock intensity at one quarter, in the inclusive range [0, 1].
 *
 * Full impact occupies offsets `0..sustainQ-1`. During recovery, zero-based
 * recovery offset `r` uses `1 - (r + 1) / recoveryQ`, so the channel is fully
 * recovered at the end of the stated recovery duration.
 */
export function riskIntensityAtQuarter(
  event: RiskEvent,
  definition: RiskStageDefinition,
  impactKey: RiskImpactKey,
  quarter: string,
): number {
  if (event.stage === 0) return 0;

  const current = quarterOrdinal(quarter);
  const start = quarterOrdinal(event.startQuarter);
  if (current === null || start === null) return 0;

  const timing = getRiskTiming(event, definition, impactKey);
  const elapsed = current - start - timing.delayQ;
  if (elapsed < 0) return 0;
  if (elapsed < timing.sustainQ) return 1;
  if (timing.recoveryQ <= 0) return 0;

  const recoveryOffset = elapsed - timing.sustainQ;
  return Math.max(0, Math.min(1, 1 - (recoveryOffset + 1) / timing.recoveryQ));
}
