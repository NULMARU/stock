// Read-only exploratory probes for InfraWheel commit 09c710e.
// Usage: node probe-infrawheel.cjs /absolute/path/to/compiled-commonjs-core
// The engine directory must be compiled from the pinned source described in
// ../simulation-model-validation.md. This runner does not fetch data or edit it.
const path = require('node:path');
const { performance } = require('node:perf_hooks');

if (!process.argv[2]) {
  process.stderr.write('Usage: node probe-infrawheel.cjs <compiled-core-directory>\n');
  process.exit(1);
}

const coreDir = path.resolve(process.argv[2]);
const {
  simulate,
  simulateLite,
  DEFAULT_PARAMS: params,
  DEFAULT_LITE_PARAMS: liteParams,
  DEFAULT_CONFIG: config,
} = require(path.join(coreDir, 'index.js'));
const {
  simulateGeopolitical,
  DEFAULT_GEO_STATE: geoState,
} = require(path.join(coreDir, 'geopolitical/index.js'));
const { SCENARIO_BY_ID } = require(path.join(coreDir, 'scenarios.js'));

const baseline = simulate(params, config);
const firstConfig = { ...config, endQuarter: config.startQuarter };
const zeroPowerParams = structuredClone(params);
zeroPowerParams.energy.deliverablePower = 0;
const noCapitalParams = structuredClone(params);
noCapitalParams.capital.reinvestRatio = 0;
noCapitalParams.capital.policyCAPEX = 0;
const noCapital = simulate(noCapitalParams, config);
const firstNormal = simulate(params, firstConfig)[0].nodeOutputs;
const firstZero = simulate(zeroPowerParams, firstConfig)[0].nodeOutputs;

const result = {
  sourceCommit: '09c710e1f790ad505af4f8f9807944bed8663b99',
  modelDefaults: {
    start: config.startQuarter,
    end: config.endQuarter,
    count: baseline.length,
  },
  powerUnitExample: {
    inputGW: params.energy.deliverablePower,
    inputPFLOPSperMW: params.energy.computeDensity,
    actualPFLOPS: firstNormal.usableCompute,
    dimensionallyExpectedPFLOPS:
      params.energy.deliverablePower * 1000 * params.energy.computeDensity,
  },
  zeroPowerBoundary: {
    normal: { spatial: firstNormal.spatialEffective, edge: firstNormal.edgeCapability },
    zero: { spatial: firstZero.spatialEffective, edge: firstZero.edgeCapability },
  },
  monthlyEqualsQuarterly:
    JSON.stringify(baseline) ===
    JSON.stringify(simulate(params, { ...config, cycleUnit: 'month' })),
  reversedRange:
    simulate(params, { ...config, startQuarter: '2035Q4', endQuarter: '2025Q1' }).length,
  noCapital: {
    firstAlgo: noCapital[0].effectiveParams.intelligence.algorithmicEfficiency,
    lastAlgo: noCapital.at(-1).effectiveParams.intelligence.algorithmicEfficiency,
    firstComputeDensity: noCapital[0].effectiveParams.energy.computeDensity,
    lastComputeDensity: noCapital.at(-1).effectiveParams.energy.computeDensity,
  },
};

const durations = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  simulateLite(liteParams, config);
  simulateGeopolitical(liteParams, geoState, config);
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
result.localTiming = {
  runs: 100,
  work: 'base + geopolitical, 44 quarters each',
  node: process.version,
  medianMs: durations[50],
  p95Ms: durations[94],
  scope: 'single local Node process; not browser/mobile or corrected model benchmark',
};

const scenario = SCENARIO_BY_ID.physicalAITakeoff;
const activeParams = structuredClone(scenario.params);
const activeZeroParams = structuredClone(activeParams);
activeZeroParams.energy.deliverablePower = 0;
const activeConfig = { ...config, ...scenario.config, endQuarter: config.startQuarter };
const active = simulate(activeParams, activeConfig)[0];
const activeZero = simulate(activeZeroParams, activeConfig)[0];
result.activePhysicalScenario = {
  scenario: scenario.id,
  quarter: active.quarter,
  normal: {
    physicalAIActive: active.nodeOutputs.physicalAIActive,
    physicalRevenue: active.nodeOutputs.physicalRevenue,
    spatial: active.nodeOutputs.spatialEffective,
  },
  zeroPower: {
    physicalAIActive: activeZero.nodeOutputs.physicalAIActive,
    physicalRevenue: activeZero.nodeOutputs.physicalRevenue,
    spatial: activeZero.nodeOutputs.spatialEffective,
  },
  physicalRevenueInBillionIfUnitsAsDeclared: active.nodeOutputs.physicalRevenue / 1000,
  note: 'zero power is an adversarial engine-boundary input, below Lite UI minimum; exposes missing resource coupling',
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
