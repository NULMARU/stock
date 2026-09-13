import type { RiskImpactKey, RiskImpacts } from './catalog';

export type ImpactDirection = 'decrease' | 'increase';

export interface ImpactLimit {
  direction: ImpactDirection;
  /** Positive proportional bound: 0.97 = at most a 97% reduction. */
  limit: number;
}

/** Approved maximum combined shocks for simultaneous regional events. */
export const IMPACT_LIMITS: Record<RiskImpactKey, ImpactLimit> = {
  packaging: { direction: 'decrease', limit: 0.97 },
  memory: { direction: 'decrease', limit: 0.40 },
  deliverablePower: { direction: 'decrease', limit: 0.50 },
  cloudEfficiency: { direction: 'decrease', limit: 0.25 },
  revenueGrowth: { direction: 'decrease', limit: 0.60 },
  reinvestRatio: { direction: 'decrease', limit: 0.80 },
  leadTime: { direction: 'increase', limit: 1.00 },
  policyCAPEX: { direction: 'increase', limit: 2.00 },
};

/**
 * Combine positive severities without exceeding `limit`.
 * Non-finite, zero and negative entries are neutral; individual values are
 * clamped to the same limit before multiplication.
 */
export function combineSaturatedSeverities(
  severities: readonly number[],
  limit: number,
): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;

  let remainder = 1;
  for (const value of severities) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const bounded = Math.min(value, limit);
    remainder *= 1 - bounded / limit;
  }
  return limit * (1 - remainder);
}

/** Combine one signed channel and return a signed proportional adjustment. */
export function combineImpactChannel(
  impactKey: RiskImpactKey,
  signedImpacts: readonly number[],
): number {
  const { direction, limit } = IMPACT_LIMITS[impactKey];
  const severities = signedImpacts.map((impact) => (
    direction === 'decrease' ? -impact : impact
  ));
  const combined = combineSaturatedSeverities(severities, limit);
  return direction === 'decrease' ? -combined : combined;
}

/** Combine a list of event impact vectors independently for every channel. */
export function combineRiskImpacts(events: readonly RiskImpacts[]): RiskImpacts {
  const combined: RiskImpacts = {};

  for (const impactKey of Object.keys(IMPACT_LIMITS) as RiskImpactKey[]) {
    const values = events
      .map((event) => event[impactKey])
      .filter((value): value is number => value !== undefined);
    if (values.length === 0) continue;
    const value = combineImpactChannel(impactKey, values);
    if (value !== 0) combined[impactKey] = value;
  }

  return combined;
}
