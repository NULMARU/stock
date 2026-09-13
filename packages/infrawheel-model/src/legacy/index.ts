/**
 * Frozen upstream snapshot: infrawheel-lite @ 09c710e1f790ad505af4f8f9807944bed8663b99
 *
 * The TypeScript sources in this directory (engine, types, defaults, liteMapping,
 * liteEngine, scenarios, geopolitical/) are byte-identical copies of the upstream
 * repository except for the barrel file `index.ts`, which additionally re-exports
 * the geopolitical module (upstream does not expose it from its top-level barrel).
 *
 * Provenance and licence status: see UPSTREAM_SOURCE.md (preserved verbatim).
 * Known model issues: see MODEL_ACCURACY_NOTES.md (preserved verbatim) and
 * docs/simulation-model-validation.md section 1 (F01–F10) in the Stock repo.
 *
 * This module is the `legacy-09c710e` model version. It is kept for regression
 * and to explain previously produced results. Do not fix bugs here — the
 * corrected model is ../v2 (Structural v2).
 *
 * Upstream test classification (upstream `npm test`: 12 files, 154 tests pass):
 * - Core/engine tests copied to ./__tests__ (9 files): engine, liteMapping,
 *   liteEngine, scenarios, geopoliticalCatalog/Overlay/Timeline, geoMapping,
 *   goldenMaster. They run unchanged under the Stock workspace vitest runner.
 * - UI tests NOT copied (3 files): store.test.ts and urlState.test.ts depend on
 *   zustand + direct `location.hash`/`history.replaceState` access, and
 *   ui/liteUi.test.ts depends on the upstream UI store. Those responsibilities
 *   are replaced in the lab app by React Router state and IndexedDB
 *   persistence; replacement coverage lives in:
 *     - src/apps/simulation-lab/sharing/__tests__ (URL/share-state round-trip)
 *     - src/apps/simulation-lab/persistence/__tests__ (repository behaviour)
 *   See docs/implementation-report.md for the mapping table.
 */
export * from './engine';
export { DEFAULT_PARAMS, DEFAULT_CONFIG } from './defaults';
export {
  CLOUD_EFFICIENCY_ANCHORS,
  DEFAULT_LITE_PARAMS,
  EDGE_READINESS_ANCHORS,
  MEMORY_SUPPLY_ANCHORS,
  collapseEngineParams,
  expandLiteParams,
  normalizeLiteParams,
} from './liteMapping';
export {
  aggregateLiteCycleOutput,
  mapEngineNodeToLite,
  simulateLite,
} from './liteEngine';
export * as geopolitical from './geopolitical/index';
export type {
  InfraWheelParams,
  SimulationConfig,
  CycleOutput,
  NodeOutputs,
  NodeId,
  LiteParams,
  LiteNodeId,
  LiteCycleOutput,
  LiteNodeOutputs,
  RiskStage,
  RiskId,
  RiskEvent,
  RiskEvents,
  GeoState,
} from './types';
