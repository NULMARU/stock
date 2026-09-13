import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../defaults';
import {
  CLOUD_EFFICIENCY_ANCHORS,
  DEFAULT_LITE_PARAMS,
  EDGE_READINESS_ANCHORS,
  MEMORY_SUPPLY_ANCHORS,
  collapseEngineParams,
  expandLiteParams,
  normalizeLiteParams,
} from '../liteMapping';
import type { InfraWheelParams, LiteParams } from '../types';

function leafCount(value: object): number {
  return Object.values(value).reduce(
    (count, group) => count + Object.keys(group as object).length,
    0,
  );
}

function withEngineParams(
  mutate: (params: InfraWheelParams) => void,
): InfraWheelParams {
  const params: InfraWheelParams = {
    silicon: { ...DEFAULT_PARAMS.silicon },
    energy: { ...DEFAULT_PARAMS.energy },
    intelligence: { ...DEFAULT_PARAMS.intelligence },
    capital: { ...DEFAULT_PARAMS.capital },
    hyperscaleDC: { ...DEFAULT_PARAMS.hyperscaleDC },
    digitalAI: { ...DEFAULT_PARAMS.digitalAI },
    spatialCompute: { ...DEFAULT_PARAMS.spatialCompute },
    physicalAI: { ...DEFAULT_PARAMS.physicalAI },
  };
  mutate(params);
  return params;
}

describe('Lite parameter contract', () => {
  it('contains exactly 14 public inputs', () => {
    expect(Object.keys(DEFAULT_LITE_PARAMS)).toHaveLength(6);
    expect(leafCount(DEFAULT_LITE_PARAMS)).toBe(14);
  });

  it('expands the Lite defaults exactly to the verified engine defaults', () => {
    expect(expandLiteParams(DEFAULT_LITE_PARAMS)).toEqual(DEFAULT_PARAMS);
  });

  it('keeps fleet deployment internal at 70K', () => {
    expect(expandLiteParams({
      ...DEFAULT_LITE_PARAMS,
      aiApplications: { ...DEFAULT_LITE_PARAMS.aiApplications, unitEconomics: 1.2 },
    }).physicalAI).toEqual({ fleetDeployment: 70, unitEconomics: 1.2 });
  });
});

describe('piecewise anchor expansion', () => {
  it.each(MEMORY_SUPPLY_ANCHORS)('reproduces memory anchor $index', (anchor) => {
    const params = expandLiteParams({
      ...DEFAULT_LITE_PARAMS,
      silicon: { ...DEFAULT_LITE_PARAMS.silicon, memorySupplyIndex: anchor.index },
    });
    expect(params.silicon.bwMemory).toBe(anchor.bwMemory);
    expect(params.silicon.capMemory).toBe(anchor.capMemory);
  });

  it.each(CLOUD_EFFICIENCY_ANCHORS)('reproduces cloud anchor $index', (anchor) => {
    const params = expandLiteParams({
      ...DEFAULT_LITE_PARAMS,
      aiInfrastructure: {
        ...DEFAULT_LITE_PARAMS.aiInfrastructure,
        cloudEfficiencyIndex: anchor.index,
      },
    });
    expect(params.hyperscaleDC.bisectionBW).toBe(anchor.bisectionBW);
    expect(params.hyperscaleDC.utilization).toBe(anchor.utilization);
  });

  it.each(EDGE_READINESS_ANCHORS)('reproduces edge anchor $index', (anchor) => {
    const params = expandLiteParams({
      ...DEFAULT_LITE_PARAMS,
      aiInfrastructure: {
        ...DEFAULT_LITE_PARAMS.aiInfrastructure,
        edgeReadinessIndex: anchor.index,
      },
    });
    expect(params.spatialCompute.deploymentRate).toBe(anchor.deploymentRate);
    expect(params.spatialCompute.perNodeTOPS).toBe(anchor.perNodeTOPS);
  });

  it('uses linear interpolation within a segment rather than a global average', () => {
    const params = expandLiteParams({
      ...DEFAULT_LITE_PARAMS,
      silicon: { ...DEFAULT_LITE_PARAMS.silicon, memorySupplyIndex: 30 },
      aiInfrastructure: {
        cloudEfficiencyIndex: 25,
        edgeReadinessIndex: 52.5,
      },
    });
    expect(params.silicon.bwMemory).toBe(60);
    expect(params.silicon.capMemory).toBe(350);
    expect(params.hyperscaleDC.bisectionBW).toBe(42.5);
    expect(params.hyperscaleDC.utilization).toBe(36.5);
    expect(params.spatialCompute.deploymentRate).toBe(4.5);
    expect(params.spatialCompute.perNodeTOPS).toBe(350);
  });
});

describe('legacy reverse mapping', () => {
  it('round-trips every exact composite anchor', () => {
    for (const anchor of MEMORY_SUPPLY_ANCHORS) {
      const lite = collapseEngineParams(withEngineParams((params) => {
        params.silicon.bwMemory = anchor.bwMemory;
        params.silicon.capMemory = anchor.capMemory;
      }));
      expect(lite.silicon.memorySupplyIndex).toBeCloseTo(anchor.index, 10);
    }
    for (const anchor of CLOUD_EFFICIENCY_ANCHORS) {
      const lite = collapseEngineParams(withEngineParams((params) => {
        params.hyperscaleDC.bisectionBW = anchor.bisectionBW;
        params.hyperscaleDC.utilization = anchor.utilization;
      }));
      expect(lite.aiInfrastructure.cloudEfficiencyIndex).toBeCloseTo(anchor.index, 10);
    }
    for (const anchor of EDGE_READINESS_ANCHORS) {
      const lite = collapseEngineParams(withEngineParams((params) => {
        params.spatialCompute.deploymentRate = anchor.deploymentRate;
        params.spatialCompute.perNodeTOPS = anchor.perNodeTOPS;
      }));
      expect(lite.aiInfrastructure.edgeReadinessIndex).toBeCloseTo(anchor.index, 10);
    }
  });

  it('resolves the edge plateau pair 6% / 350 TOPS to index 55', () => {
    const lite = collapseEngineParams(withEngineParams((params) => {
      params.spatialCompute.deploymentRate = 6;
      params.spatialCompute.perNodeTOPS = 350;
    }));
    expect(lite.aiInfrastructure.edgeReadinessIndex).toBeCloseTo(55, 10);
  });

  it('does not mutate the legacy engine input', () => {
    const engine = withEngineParams(() => undefined);
    const before = structuredClone(engine);
    collapseEngineParams(engine);
    expect(engine).toEqual(before);
  });
});

describe('finite guards', () => {
  it('clamps ranges and replaces non-finite values with defaults', () => {
    const unsafe = structuredClone(DEFAULT_LITE_PARAMS) as LiteParams;
    unsafe.silicon.memorySupplyIndex = Number.NaN;
    unsafe.silicon.packaging = -100;
    unsafe.energy.deliverablePower = Number.POSITIVE_INFINITY;
    unsafe.aiInfrastructure.edgeReadinessIndex = 1_000;
    unsafe.aiApplications.unitEconomics = -1;

    const safe = normalizeLiteParams(unsafe);
    expect(safe.silicon.memorySupplyIndex).toBe(50);
    expect(safe.silicon.packaging).toBe(30);
    expect(safe.energy.deliverablePower).toBe(45);
    expect(safe.aiInfrastructure.edgeReadinessIndex).toBe(100);
    expect(safe.aiApplications.unitEconomics).toBe(0.2);

    const expanded = expandLiteParams(unsafe);
    for (const group of Object.values(expanded)) {
      for (const value of Object.values(group)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
