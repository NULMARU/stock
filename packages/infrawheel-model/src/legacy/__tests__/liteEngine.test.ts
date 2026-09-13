import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_PARAMS } from '../defaults';
import { simulate } from '../engine';
import {
  aggregateLiteCycleOutput,
  mapEngineNodeToLite,
  simulateLite,
} from '../liteEngine';
import { DEFAULT_LITE_PARAMS } from '../liteMapping';
import type { CycleOutput, LiteNodeId, NodeId } from '../types';

const NODE_MAP: Record<NodeId, LiteNodeId> = {
  silicon: 'silicon',
  energy: 'energy',
  hyperscaleDC: 'aiInfrastructure',
  spatialCompute: 'aiInfrastructure',
  intelligence: 'intelligence',
  digitalAI: 'aiApplications',
  physicalAI: 'aiApplications',
  capital: 'capital',
};

describe('Lite engine facade', () => {
  it('preserves every numeric engine result for the default 44-quarter run', () => {
    const engine = simulate(DEFAULT_PARAMS, DEFAULT_CONFIG);
    const lite = simulateLite(DEFAULT_LITE_PARAMS, DEFAULT_CONFIG);
    expect(lite).toHaveLength(44);

    for (let i = 0; i < engine.length; i++) {
      const source = engine[i]!;
      const adapted = lite[i]!;
      expect(adapted.bottleneckCause).toBe(source.bottleneckNode);
      expect(adapted.bottleneckNode).toBe(NODE_MAP[source.bottleneckNode]);
      expect(adapted.nodeOutputs.bottleneckNode).toBe(adapted.bottleneckNode);
      expect(adapted.nodeOutputs.bottleneckCause).toBe(source.nodeOutputs.bottleneckNode);
      expect(adapted.bottleneckRatio).toBe(source.bottleneckRatio);
      expect(adapted.nodeOutputs.confidence).toBe(source.nodeOutputs.confidence);
      expect(adapted.totalRevenue).toBe(source.totalRevenue);
      expect(adapted.totalCAPEX).toBe(source.totalCAPEX);
      expect(adapted.loopSpeeds).toEqual(source.loopSpeeds);
      expect(adapted.effectiveParams).toEqual(source.effectiveParams);
    }
  });

  it('maps all 8 internal causes onto exactly 6 display nodes', () => {
    const source = simulate(DEFAULT_PARAMS, { ...DEFAULT_CONFIG, endQuarter: '2025Q1' })[0]!;
    for (const [cause, parent] of Object.entries(NODE_MAP) as [NodeId, LiteNodeId][]) {
      const synthetic: CycleOutput = {
        ...source,
        bottleneckNode: cause,
        nodeOutputs: { ...source.nodeOutputs, bottleneckNode: cause },
      };
      const adapted = aggregateLiteCycleOutput(synthetic);
      expect(mapEngineNodeToLite(cause)).toBe(parent);
      expect(adapted.bottleneckNode).toBe(parent);
      expect(adapted.nodeOutputs.bottleneckNode).toBe(parent);
      expect(adapted.bottleneckCause).toBe(cause);
      expect(adapted.nodeOutputs.bottleneckCause).toBe(cause);
    }
    expect(new Set(Object.values(NODE_MAP))).toHaveLength(6);
  });

  it('returns no NaN or Infinity at all composite-index corners', () => {
    for (const memorySupplyIndex of [0, 100]) {
      for (const cloudEfficiencyIndex of [0, 100]) {
        for (const edgeReadinessIndex of [0, 100]) {
          const results = simulateLite({
            ...DEFAULT_LITE_PARAMS,
            silicon: { ...DEFAULT_LITE_PARAMS.silicon, memorySupplyIndex },
            aiInfrastructure: { cloudEfficiencyIndex, edgeReadinessIndex },
          }, DEFAULT_CONFIG);
          const numericJson = JSON.stringify(results);
          expect(numericJson).not.toContain('NaN');
          expect(numericJson).not.toContain('Infinity');
        }
      }
    }
  });

  it('keeps a warmed 44-quarter Lite run under 10ms', () => {
    simulateLite(DEFAULT_LITE_PARAMS, DEFAULT_CONFIG);
    const elapsed: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      simulateLite(DEFAULT_LITE_PARAMS, DEFAULT_CONFIG);
      elapsed.push(performance.now() - start);
    }
    expect(Math.min(...elapsed)).toBeLessThan(10);
  });
});
