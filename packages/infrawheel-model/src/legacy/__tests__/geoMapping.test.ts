import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GEO_STATE,
  applyStructuralAxes,
  simulateGeopoliticalEngine,
} from '../geopolitical/index';
import { simulate } from '../engine';
import { DEFAULT_PARAMS, DEFAULT_CONFIG } from '../defaults';
import type { CycleOutput } from '../types';

const lastOf = (r: CycleOutput[]) => r[r.length - 1]!;

describe('Geopolitical bloc axis (P2)', () => {
  it('blocPct 50 is the no-adjustment baseline', () => {
    expect(applyStructuralAxes(DEFAULT_PARAMS, { ...DEFAULT_GEO_STATE, blocPct: 50 }))
      .toEqual(DEFAULT_PARAMS);
  });

  it('moving 50 → 0 (integration) heals packaging/transfer/revenue and cuts policy CAPEX', () => {
    const integrated = applyStructuralAxes(DEFAULT_PARAMS, { ...DEFAULT_GEO_STATE, blocPct: 0 });
    expect(integrated.silicon.packaging).toBeGreaterThan(DEFAULT_PARAMS.silicon.packaging);
    expect(integrated.intelligence.transferRatio).toBeGreaterThan(DEFAULT_PARAMS.intelligence.transferRatio);
    expect(integrated.digitalAI.revenueGrowth).toBeGreaterThan(DEFAULT_PARAMS.digitalAI.revenueGrowth);
    expect(integrated.capital.policyCAPEX).toBeLessThan(DEFAULT_PARAMS.capital.policyCAPEX);
  });

  it('moving 50 → 100 (tripolar) hurts packaging and raises policy CAPEX', () => {
    const tripolar = applyStructuralAxes(DEFAULT_PARAMS, { ...DEFAULT_GEO_STATE, blocPct: 100 });
    expect(tripolar.silicon.packaging).toBeLessThan(DEFAULT_PARAMS.silicon.packaging);
    expect(tripolar.capital.policyCAPEX).toBeGreaterThan(DEFAULT_PARAMS.capital.policyCAPEX);
  });

  it('Golden Age (bloc 10 / energy 85) clearly beats base on revenue and effective compute', () => {
    const base = simulate(DEFAULT_PARAMS, DEFAULT_CONFIG);
    const golden = simulateGeopoliticalEngine(
      DEFAULT_PARAMS,
      { ...DEFAULT_GEO_STATE, blocPct: 10, energyPct: 85 },
      DEFAULT_CONFIG,
    );
    expect(lastOf(golden).totalRevenue).toBeGreaterThan(lastOf(base).totalRevenue);
    expect(lastOf(golden).nodeOutputs.hyperscaleEffective)
      .toBeGreaterThan(lastOf(base).nodeOutputs.hyperscaleEffective);
  });
});
