import { expect, test } from 'vitest';
import { simulate } from '../engine';
import { DEFAULT_CONFIG } from '../defaults';
import { SCENARIOS } from '../scenarios';

test('preserves the upstream scenario anchors', () => {
  const quarters = ['2025Q1', '2030Q4', '2035Q4'];
  const fixture = Object.fromEntries(SCENARIOS.map((scenario) => {
    const results = simulate(scenario.params, { ...DEFAULT_CONFIG, ...scenario.config });
    return [scenario.id, Object.fromEntries(quarters.map((quarter) => {
      const cycle = results.find((item) => item.quarter === quarter)!;
      return [quarter, {
        totalRevenue: cycle.totalRevenue,
        totalCAPEX: cycle.totalCAPEX,
        bottleneckRatio: cycle.bottleneckRatio,
        confidence: cycle.nodeOutputs.confidence,
        hyperscale: cycle.loopSpeeds.hyperscale,
        spatial: cycle.loopSpeeds.spatial,
        physicalAIActive: cycle.nodeOutputs.physicalAIActive,
      }];
    }))];
  }));
  expect(fixture).toMatchSnapshot();
});
