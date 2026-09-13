/**
 * Structural v2 model types (docs/simulation-model-validation.md §3–§5).
 * All quantities carry explicit units in their names; `min()` is only ever
 * applied to quantities of the same kind and unit.
 */

import type { ScenarioEvent } from "@stock/simulation-core";

/** Normalized v2 inputs. Ratios are 0–1; money is USD billions; power is MW. */
export interface V2Params {
  /** Installed compute stock at start (PFLOPS, FP16-equivalent basis). */
  initialComputePFLOPS: number;
  /** Online deliverable power at start (MW). */
  initialPowerMW: number;
  /** Power required per unit of compute stock (MW per PFLOPS) — inverse of compute density. */
  mwPerPFLOPS: number;
  /** Cluster utilization ceiling (0–1). */
  utilization: number;
  /** Interconnect sufficiency (0–1): min(1, availableBW/requiredBW). */
  interconnectFactor: number;
  /** Digital AI revenue opportunity at start ($B/quarter). */
  initialDigitalDemandB: number;
  /** Digital demand growth per quarter (0–1), from the YoY input via (1+y)^0.25-1. */
  digitalDemandGrowthQ: number;
  /** Revenue per effective PFLOPS served ($B/quarter per PFLOPS, ×1e-6 scale handled by assumption). */
  revenuePerPFLOPS: number;
  /** Gross margin on digital revenue (0–1). */
  digitalGrossMargin: number;
  /** Operating cost ratio on revenue (0–1) — explicit simplification, see assumptions. */
  opexRatio: number;
  /** Reinvestment ratio of modelled reinvestable cash (0–1). */
  reinvestRatio: number;
  /** Exogenous policy funding ($B/quarter). */
  policyFundingBPerQ: number;
  /** Compute capacity added per $B invested in compute (PFLOPS/$B) — assumption. */
  computePerCapexB: number;
  /** Power added per $B invested in power (MW/$B) — assumption. */
  mwPerCapexB: number;
  /** Lead time for compute projects (quarters, ≥1). */
  computeLeadQuarters: number;
  /** Lead time for power projects (quarters, ≥1). */
  powerLeadQuarters: number;
  /** Share of new investment going to power vs compute (0–1). */
  investmentPowerShare: number;
  /** Exogenous quarterly growth of algorithmic efficiency (0–1); persists at zero investment. */
  algoGrowthQ: number;
  /** Algorithmic efficiency ceiling multiplier over start value. */
  algoCeiling: number;
  /** Exogenous quarterly growth of compute density (0–1); persists at zero investment. */
  densityGrowthQ: number;
  /** Deployed Physical AI fleet at start (units). */
  initialFleetUnits: number;
  /** Tasks per unit per quarter supported (assumption, tasks/unit/quarter). */
  tasksPerUnitQ: number;
  /** Edge inference capacity per unit (PFLOPS-equivalent ×1e-3, assumption). */
  edgeComputePerUnit: number;
  /** Physical AI task demand at start (tasks/quarter). */
  initialPhysicalTaskDemand: number;
  /** Physical task demand growth per quarter (0–1). */
  physicalDemandGrowthQ: number;
  /** Revenue per task ($/task, assumption). */
  revenuePerTask: number;
  /** Physical AI operating margin (0–1). */
  physicalOpMargin: number;
  /** Fleet units added per $B invested in physical (units/$B, assumption). */
  unitsPerCapexB: number;
  /** Share of investment to physical fleet (0–1); remainder split power/compute. */
  investmentPhysicalShare: number;
  /** Physical AI activation: minimum algorithmic transfer level (0–1). */
  physicalActivationThreshold: number;
  /** Frontier-to-edge transfer ratio (0–1); capability = algoIndex × transferRatio. */
  transferRatio: number;
  /** Quarterly new-hardware supply limit from memory+packaging (PFLOPS/quarter). */
  hardwareFlowPFLOPS: number;
}

export interface ProjectCommitment {
  id: string;
  commitmentQuarter: string;
  amountB: number;
  target: "compute" | "power" | "physical";
  expectedCommissionQuarter: string;
  commissionedAmountB: number;
  status: "in-flight" | "commissioned" | "cancelled";
}

export interface V2State {
  quarter: string;
  computeStockPFLOPS: number;
  powerOnlineMW: number;
  algoIndex: number;
  densityIndex: number;
  digitalDemandB: number;
  physicalTaskDemand: number;
  fleetUnits: number;
  cashB: number;
  projects: ProjectCommitment[];
}

export interface V2QuarterRow {
  quarter: string;
  availableComputePFLOPS: number;
  allocatedTrainingPFLOPS: number;
  allocatedCloudPFLOPS: number;
  allocatedEdgePFLOPS: number;
  digitalDemandB: number;
  servedDigitalB: number;
  digitalFulfillment: number;
  physicalTaskDemand: number;
  servedPhysicalTasks: number;
  activeFleetUnits: number;
  physicalRevenueB: number;
  digitalRevenueB: number;
  totalRevenueB: number;
  operatingCostsB: number;
  availableCashB: number;
  newInvestmentB: number;
  externalFundingB: number;
  cashEndB: number;
  computeStockPFLOPS: number;
  powerOnlineMW: number;
  commissionedThisQuarterB: number;
  physicalActive: boolean;
  deployedFleetUnits: number;
  constraintReasons: string[];
}

export interface V2Event extends ScenarioEvent {
  type: V2EventType;
}

export type V2EventType =
  | "power-shock"
  | "compute-destruction"
  | "demand-shock"
  | "subsidy"
  | "lead-time-shock"
  | "project-delay";

export interface EventDefinition {
  type: V2EventType;
  /** Input channel the event acts on. */
  channel: "power" | "compute" | "demand" | "funding" | "leadTime" | "projects";
  unit: string;
  /** How multiple events on the same channel combine. */
  combination: "multiplicative-saturate" | "additive-clamped";
  /** Order independence: events on different channels must commute. */
  orderIndependent: boolean;
  min: number;
  max: number;
  description: string;
}
