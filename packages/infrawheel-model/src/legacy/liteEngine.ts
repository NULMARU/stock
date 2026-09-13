/** Thin compatibility facade from InfraWheel Lite to the verified 18-input engine. */

import { simulate } from './engine';
import { expandLiteParams } from './liteMapping';
import type {
  CycleOutput,
  LiteCycleOutput,
  LiteNodeId,
  LiteParams,
  NodeId,
  SimulationConfig,
} from './types';

const ENGINE_TO_LITE_NODE: Record<NodeId, LiteNodeId> = {
  silicon: 'silicon',
  energy: 'energy',
  hyperscaleDC: 'aiInfrastructure',
  spatialCompute: 'aiInfrastructure',
  intelligence: 'intelligence',
  digitalAI: 'aiApplications',
  physicalAI: 'aiApplications',
  capital: 'capital',
};

export function mapEngineNodeToLite(node: NodeId): LiteNodeId {
  return ENGINE_TO_LITE_NODE[node];
}

/**
 * Aggregate only the display identity of a cycle's bottleneck. The engine's
 * ratio, confidence, tie ordering, and all numeric outputs remain untouched.
 */
export function aggregateLiteCycleOutput(cycle: CycleOutput): LiteCycleOutput {
  const bottleneckCause = cycle.bottleneckNode;
  const bottleneckNode = mapEngineNodeToLite(bottleneckCause);

  return {
    ...cycle,
    bottleneckNode,
    bottleneckCause,
    nodeOutputs: {
      ...cycle.nodeOutputs,
      bottleneckNode,
      bottleneckCause,
    },
  };
}

/** Run the existing engine from the 14-input Lite contract. */
export function simulateLite(
  params: LiteParams,
  config: SimulationConfig,
): LiteCycleOutput[] {
  return simulate(expandLiteParams(params), config).map(aggregateLiteCycleOutput);
}
