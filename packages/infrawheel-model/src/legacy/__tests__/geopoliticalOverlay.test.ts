import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_PARAMS } from '../defaults';
import { simulate } from '../engine';
import { simulateLite } from '../liteEngine';
import { DEFAULT_LITE_PARAMS } from '../liteMapping';
import {
  DEFAULT_GEO_STATE,
  applyRiskEventsAtQuarter,
  getCombinedRiskImpactsAtQuarter,
  simulateGeopolitical,
  simulateGeopoliticalEngine,
} from '../geopolitical/overlay';
import {
  combineImpactChannel,
  combineSaturatedSeverities,
} from '../geopolitical/saturation';
import {
  applyStructuralAxes,
  getStructuralAdjustmentPcts,
} from '../geopolitical/structuralAxes';
import type { GeoState, RiskEvents } from '../types';

function geoWith(risks: Partial<RiskEvents>, axes = { blocPct: 50, energyPct: 50 }): GeoState {
  return {
    ...axes,
    risks: {
      taiwan: { ...DEFAULT_GEO_STATE.risks.taiwan },
      russiaNato: { ...DEFAULT_GEO_STATE.risks.russiaNato },
      middleEast: { ...DEFAULT_GEO_STATE.risks.middleEast },
      ...risks,
    },
  };
}

function expectAllNumbersFiniteAndNonNegative(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) expectAllNumbersFiniteAndNonNegative(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) expectAllNumbersFiniteAndNonNegative(item);
  }
}

describe('structural geopolitical axes', () => {
  it('uses 50/50 as an exact no-adjustment baseline and does not mutate input', () => {
    const before = structuredClone(DEFAULT_PARAMS);
    expect(applyStructuralAxes(DEFAULT_PARAMS, { blocPct: 50, energyPct: 50 }))
      .toEqual(DEFAULT_PARAMS);
    expect(DEFAULT_PARAMS).toEqual(before);
  });

  it('preserves the approved endpoint multipliers', () => {
    const integrated = applyStructuralAxes(DEFAULT_PARAMS, { blocPct: 0, energyPct: 50 });
    expect(integrated.silicon.packaging).toBeCloseTo(DEFAULT_PARAMS.silicon.packaging * 1.15);
    expect(integrated.silicon.bwMemory).toBeCloseTo(DEFAULT_PARAMS.silicon.bwMemory * 1.05);
    expect(integrated.capital.policyCAPEX).toBeCloseTo(DEFAULT_PARAMS.capital.policyCAPEX * 0.70);

    const tripolar = applyStructuralAxes(DEFAULT_PARAMS, { blocPct: 100, energyPct: 50 });
    expect(tripolar.silicon.packaging).toBeCloseTo(DEFAULT_PARAMS.silicon.packaging * 0.65);
    expect(tripolar.capital.policyCAPEX).toBeCloseTo(DEFAULT_PARAMS.capital.policyCAPEX * 1.80);

    const abundant = applyStructuralAxes(DEFAULT_PARAMS, { blocPct: 50, energyPct: 100 });
    expect(abundant.energy.deliverablePower).toBeCloseTo(DEFAULT_PARAMS.energy.deliverablePower * 1.40);
    expect(abundant.energy.leadTime).toBeCloseTo(DEFAULT_PARAMS.energy.leadTime * 0.60);
  });

  it('clamps finite axes and treats non-finite axes as the 50 baseline', () => {
    expect(getStructuralAdjustmentPcts({ blocPct: 200, energyPct: -20 }))
      .toEqual(getStructuralAdjustmentPcts({ blocPct: 100, energyPct: 0 }));
    expect(applyStructuralAxes(DEFAULT_PARAMS, { blocPct: Number.NaN, energyPct: Infinity }))
      .toEqual(DEFAULT_PARAMS);
  });
});

describe('saturated event coupling', () => {
  it('has neutral, singleton, commutative and bounded behavior', () => {
    expect(combineSaturatedSeverities([], 0.5)).toBe(0);
    expect(combineSaturatedSeverities([0.2], 0.5)).toBeCloseTo(0.2);
    expect(combineSaturatedSeverities([0.2, 0.25], 0.5))
      .toBeCloseTo(combineSaturatedSeverities([0.25, 0.2], 0.5));
    expect(combineSaturatedSeverities([0.5, 0.5, 0.5], 0.5)).toBeLessThanOrEqual(0.5);
  });

  it('ignores non-finite severities and enforces each channel direction', () => {
    expect(combineSaturatedSeverities([NaN, Infinity, -1, 0, 0.25], 0.5)).toBeCloseTo(0.25);
    expect(combineImpactChannel('deliverablePower', [-0.22, -0.25])).toBeCloseTo(-0.36);
    expect(combineImpactChannel('leadTime', [0.50, 0.45])).toBeCloseTo(0.725);
  });

  it('reproduces exact simultaneous stage-4 coupling values', () => {
    const geo = geoWith({
      taiwan: { stage: 4, startQuarter: '2025Q1' },
      russiaNato: { stage: 4, startQuarter: '2025Q1' },
      middleEast: { stage: 4, startQuarter: '2025Q1' },
    });
    const operationalAndMarket = getCombinedRiskImpactsAtQuarter(geo, '2025Q1');
    expect(operationalAndMarket.memory).toBeCloseTo(-0.20);
    expect(operationalAndMarket.packaging).toBeCloseTo(-0.95);
    expect(operationalAndMarket.deliverablePower).toBeCloseTo(-0.36);
    expect(operationalAndMarket.leadTime).toBeCloseTo(0.725);
    expect(operationalAndMarket.cloudEfficiency).toBeCloseTo(-0.10);
    expect(operationalAndMarket.revenueGrowth).toBeCloseTo(-0.3666666667);
    expect(operationalAndMarket.reinvestRatio).toBeCloseTo(-0.77890625);
    expect(operationalAndMarket.policyCAPEX).toBeUndefined();

    const policyStarted = getCombinedRiskImpactsAtQuarter(geo, '2025Q2');
    expect(policyStarted.policyCAPEX).toBeCloseTo(1.775);
  });
});

describe('quarterly geopolitical overlay', () => {
  it('maps Taiwan memory to both memory fields and delays policy capital', () => {
    const geo = geoWith({ taiwan: { stage: 3, startQuarter: '2025Q2' } });
    expect(applyRiskEventsAtQuarter(DEFAULT_PARAMS, geo, '2025Q1')).toEqual(DEFAULT_PARAMS);

    const start = applyRiskEventsAtQuarter(DEFAULT_PARAMS, geo, '2025Q2');
    expect(start.silicon.bwMemory).toBeCloseTo(DEFAULT_PARAMS.silicon.bwMemory * 0.88);
    expect(start.silicon.capMemory).toBeCloseTo(DEFAULT_PARAMS.silicon.capMemory * 0.88);
    expect(start.silicon.packaging).toBeCloseTo(DEFAULT_PARAMS.silicon.packaging * 0.20);
    expect(start.capital.reinvestRatio).toBeCloseTo(DEFAULT_PARAMS.capital.reinvestRatio * 0.50);
    expect(start.capital.policyCAPEX).toBe(DEFAULT_PARAMS.capital.policyCAPEX);

    const next = applyRiskEventsAtQuarter(DEFAULT_PARAMS, geo, '2025Q3');
    expect(next.capital.policyCAPEX).toBeCloseTo(DEFAULT_PARAMS.capital.policyCAPEX * 2);
  });

  it('maps Russia cloud efficiency to bisection bandwidth and utilization', () => {
    const geo = geoWith({ russiaNato: { stage: 4, startQuarter: '2025Q1' } });
    const result = applyRiskEventsAtQuarter(DEFAULT_PARAMS, geo, '2025Q1');
    expect(result.hyperscaleDC.bisectionBW)
      .toBeCloseTo(DEFAULT_PARAMS.hyperscaleDC.bisectionBW * 0.90);
    expect(result.hyperscaleDC.utilization)
      .toBeCloseTo(DEFAULT_PARAMS.hyperscaleDC.utilization * 0.90);
  });

  it('is immutable and never compounds a held shock into its input', () => {
    const geo = geoWith({ taiwan: { stage: 3, startQuarter: '2025Q1' } });
    const before = structuredClone(DEFAULT_PARAMS);
    const first = applyRiskEventsAtQuarter(DEFAULT_PARAMS, geo, '2025Q1');
    const second = applyRiskEventsAtQuarter(DEFAULT_PARAMS, geo, '2025Q2');
    expect(second.silicon.packaging).toBeCloseTo(first.silicon.packaging);
    expect(DEFAULT_PARAMS).toEqual(before);
  });

  it('keeps the all-stage-0 engine result cycle-for-cycle identical', () => {
    const baseline = simulate(DEFAULT_PARAMS, DEFAULT_CONFIG);
    const geopolitical = simulateGeopoliticalEngine(DEFAULT_PARAMS, DEFAULT_GEO_STATE, DEFAULT_CONFIG);
    expect(geopolitical).toEqual(baseline);
  });

  it('exposes the same neutral result through the 14-input Lite facade', () => {
    expect(simulateGeopolitical(DEFAULT_LITE_PARAMS, DEFAULT_GEO_STATE, DEFAULT_CONFIG))
      .toEqual(simulateLite(DEFAULT_LITE_PARAMS, DEFAULT_CONFIG));
  });

  it('has no simulated impact before the configured start quarter', () => {
    const geo = geoWith({ taiwan: { stage: 4, startQuarter: '2025Q3' } });
    const config = { ...DEFAULT_CONFIG, endQuarter: '2025Q4' };
    const baseline = simulate(DEFAULT_PARAMS, config);
    const geopolitical = simulateGeopoliticalEngine(DEFAULT_PARAMS, geo, config);
    expect(geopolitical.slice(0, 2)).toEqual(baseline.slice(0, 2));
    expect(geopolitical[2]!.effectiveParams.silicon.packaging)
      .toBeLessThan(baseline[2]!.effectiveParams.silicon.packaging);
  });

  it('keeps an overlapping worst-case run finite and non-negative', () => {
    const geo = geoWith({
      taiwan: { stage: 4, startQuarter: '2025Q1', durationOverrideQ: Number.POSITIVE_INFINITY },
      russiaNato: { stage: 4, startQuarter: '2025Q1' },
      middleEast: { stage: 4, startQuarter: '2025Q1' },
    }, { blocPct: Number.NaN, energyPct: Infinity });
    const results = simulateGeopoliticalEngine(DEFAULT_PARAMS, geo, DEFAULT_CONFIG);
    expect(results).toHaveLength(44);
    expectAllNumbersFiniteAndNonNegative(results);
  });
});
