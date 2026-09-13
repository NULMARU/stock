/**
 * Versioned assumption set for Structural v2 (`base-case-2026.v1`).
 *
 * Every coefficient that is not directly observable is an ASSUMPTION and is
 * labelled as such. Nothing here is a calibrated or measured value; see
 * docs/simulation-model-validation.md §6 — calibration requires observed data
 * that has not been secured. Defaults describe "Base Case 2026" and the
 * default timeline therefore starts 2026Q1 (F10 fix).
 */

import type { V2Params } from "./types";

export const ASSUMPTION_SET_ID = "base-case-2026.v1";

export interface AssumptionNote {
  key: keyof V2Params;
  unit: string;
  status: "assumption" | "declared-input";
  note: string;
}

/** Default Structural v2 parameters (Base Case 2026, all values assumptions). */
export const DEFAULT_V2_PARAMS: V2Params = {
  // Base: 45 GW × 1,000 MW/GW × 20 PFLOPS/MW = 900,000 PFLOPS (F01 fix).
  initialComputePFLOPS: 900_000,
  initialPowerMW: 45_000,
  mwPerPFLOPS: 1 / 20,
  utilization: 0.43,
  interconnectFactor: 0.75,
  initialDigitalDemandB: 35,
  digitalDemandGrowthQ: Math.pow(1.45, 0.25) - 1, // 45% YoY → quarterly
  revenuePerPFLOPS: 0.0015, // $1.5M/quarter per PFLOPS of effective serving capacity
  digitalGrossMargin: 0.5,
  opexRatio: 0.35,
  reinvestRatio: 0.4,
  policyFundingBPerQ: 7.5, // $30B/year
  computePerCapexB: 2_000, // PFLOPS per $B — assumption
  mwPerCapexB: 60, // MW per $B — assumption
  computeLeadQuarters: 4,
  powerLeadQuarters: 11, // ~33 months
  investmentPowerShare: 0.25,
  algoGrowthQ: 0.045,
  algoCeiling: 10,
  densityGrowthQ: 0.005,
  initialFleetUnits: 70_000,
  tasksPerUnitQ: 20_000, // assumption
  edgeComputePerUnit: 0.35, // Assumed FP16-equivalent workload; not direct TOPS conversion
  initialPhysicalTaskDemand: 500_000_000,
  physicalDemandGrowthQ: 0.03,
  revenuePerTask: 1.125, // $ per task — assumption; 70000 * 20000 * 1.125 / 1e9 = 1.575B
  physicalOpMargin: 0.25,
  unitsPerCapexB: 1_500, // units per $B — assumption
  investmentPhysicalShare: 0.1,
  physicalActivationThreshold: 0.5,
  transferRatio: 0.6,
  hardwareFlowPFLOPS: 40000,
};

export const ASSUMPTION_NOTES: AssumptionNote[] = [
  {
    key: "initialComputePFLOPS",
    unit: "PFLOPS",
    status: "declared-input",
    note: "Power (GW→MW) × density (PFLOPS/MW); unit conversion explicit (F01).",
  },
  {
    key: "revenuePerPFLOPS",
    unit: "$B/quarter/PFLOPS",
    status: "assumption",
    note: "Serving-capacity→revenue conversion; not observed. Calibration target.",
  },
  {
    key: "opexRatio",
    unit: "0-1",
    status: "assumption",
    note: 'Simplified operating cost share of revenue. Result is labelled "modelled reinvestable cash", not free cash flow.',
  },
  {
    key: "computePerCapexB",
    unit: "PFLOPS/$B",
    status: "assumption",
    note: "Investment efficiency of compute build-out; not observed.",
  },
  {
    key: "mwPerCapexB",
    unit: "MW/$B",
    status: "assumption",
    note: "Investment efficiency of power build-out; not observed.",
  },
  {
    key: "algoGrowthQ",
    unit: "0-1/quarter",
    status: "assumption",
    note: "Exogenous technology trend; persists at zero investment (F06).",
  },
  {
    key: "densityGrowthQ",
    unit: "0-1/quarter",
    status: "assumption",
    note: "Exogenous perf/watt trend; persists at zero investment (F06).",
  },
  {
    key: "tasksPerUnitQ",
    unit: "tasks/unit/quarter",
    status: "assumption",
    note: "Physical AI task throughput per device; not observed.",
  },
  {
    key: "edgeComputePerUnit",
    unit: "PFLOPS/unit",
    status: "assumption",
    note: "Edge device inference capacity; 350 TOPS default.",
  },
  {
    key: "revenuePerTask",
    unit: "$/task",
    status: "assumption",
    note: "Physical AI monetization per task; not observed.",
  },
  {
    key: "unitsPerCapexB",
    unit: "units/$B",
    status: "assumption",
    note: "Fleet expansion per invested $B; not observed.",
  },
  {
    key: "physicalActivationThreshold",
    unit: "0-1",
    status: "assumption",
    note: "Capability threshold for Physical AI activation; activation additionally requires real serving capacity (F03 fix).",
  },
];
