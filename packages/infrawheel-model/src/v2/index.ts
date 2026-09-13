import {
  ExecutionCancelled,
  InvalidRunInput,
  assertReasonablePeriod,
  addQuarters,
  quarterIndex,
  validateNumericFields,
  type FieldRule,
  type SimulationModel,
  type ResolvedRunInput,
  type ScenarioDocument,
  type ModelRunOutput,
  type InvariantViolation,
} from "@stock/simulation-core";
import { DEFAULT_V2_PARAMS as BASE } from "./assumptions";
import {
  validateEvents,
  activeEventsAt,
  combineAdditiveClamped,
  combineMultiplicativeSaturate,
} from "./events";

export const DEFAULT_INPUTS: Record<string, number> = {
  ...BASE,
  transferRatio: 0.6,
  hardwareFlowPFLOPS: 40000,
  edgeComputePerUnit: 0.35,
  revenuePerPFLOPS: 0.0015,
  revenuePerTask: 1.125,
  memoryCapacityGB: 180000000,
  memoryGBPerPFLOPS: 200,
  memoryBandwidthGBs: 900000000,
  bandwidthGBsPerPFLOPS: 1000,
  packagingWafersPerQ: 10000,
  chipsPerWafer: 60,
  packagingYield: 0.8,
  computePerChip: 0.1,
  memorySupplyGBPerQ: 10000000,
  initialCashB: 0,
};
export const INPUT_LABELS: Record<string, string> = {
  initialComputePFLOPS: "설치 연산량",
  initialPowerMW: "가용 전력",
  mwPerPFLOPS: "연산량당 전력",
  utilization: "가동률",
  interconnectFactor: "네트워크 충족률",
  initialDigitalDemandB: "디지털 수요",
  digitalDemandGrowthQ: "분기 수요 성장률",
  revenuePerPFLOPS: "유효 연산량당 매출",
  digitalGrossMargin: "디지털 매출총이익률",
  opexRatio: "디지털 운영비 비율",
  reinvestRatio: "현금 재투자 비율",
  policyFundingBPerQ: "분기 정책 자금",
  computePerCapexB: "연산 투자 효율",
  mwPerCapexB: "전력 투자 효율",
  computeLeadQuarters: "연산 준공 지연",
  powerLeadQuarters: "전력 준공 지연",
  investmentPowerShare: "전력 투자 배분",
  algoGrowthQ: "분기 알고리즘 개선",
  algoCeiling: "알고리즘 개선 상한",
  densityGrowthQ: "분기 전력 효율 개선",
  initialFleetUnits: "설치 기기 수",
  tasksPerUnitQ: "기기당 분기 작업 수",
  edgeComputePerUnit: "기기당 FP16 환산 연산량",
  initialPhysicalTaskDemand: "분기 물리 작업 수요",
  physicalDemandGrowthQ: "분기 물리 수요 성장률",
  revenuePerTask: "작업당 매출",
  physicalOpMargin: "물리 사업 운영마진",
  unitsPerCapexB: "기기 투자 효율",
  investmentPhysicalShare: "기기 투자 배분",
  physicalActivationThreshold: "물리 AI 활성 문턱",
  transferRatio: "엣지 기술 이전 비율",
  hardwareFlowPFLOPS: "신규 연산 설치 상한",
  memoryCapacityGB: "설치 메모리 용량",
  memoryGBPerPFLOPS: "연산량당 메모리 요구",
  memoryBandwidthGBs: "메모리 대역폭",
  bandwidthGBsPerPFLOPS: "연산량당 대역폭 요구",
  packagingWafersPerQ: "분기 패키징 웨이퍼",
  chipsPerWafer: "웨이퍼당 칩 수",
  packagingYield: "패키징 수율",
  computePerChip: "칩당 FP16 연산량",
  memorySupplyGBPerQ: "분기 신규 메모리",
  initialCashB: "기초 모델 현금",
};
const ratios = new Set([
  "utilization",
  "interconnectFactor",
  "digitalGrossMargin",
  "opexRatio",
  "reinvestRatio",
  "investmentPowerShare",
  "investmentPhysicalShare",
  "physicalOpMargin",
  "physicalActivationThreshold",
  "transferRatio",
  "packagingYield",
]);
const growth = new Set([
  "digitalDemandGrowthQ",
  "physicalDemandGrowthQ",
  "algoGrowthQ",
  "densityGrowthQ",
]);
const positive = new Set([
  "mwPerPFLOPS",
  "revenuePerPFLOPS",
  "tasksPerUnitQ",
  "edgeComputePerUnit",
  "memoryGBPerPFLOPS",
  "bandwidthGBsPerPFLOPS",
  "computePerChip",
]);
const INPUT_UNITS: Record<string, string> = {
  initialComputePFLOPS: "PFLOPS",
  initialPowerMW: "MW",
  mwPerPFLOPS: "MW/PFLOPS",
  initialDigitalDemandB: "USD B/분기",
  revenuePerPFLOPS: "USD B/(PFLOPS·분기)",
  policyFundingBPerQ: "USD B/분기",
  computePerCapexB: "PFLOPS/USD B",
  mwPerCapexB: "MW/USD B",
  computeLeadQuarters: "분기",
  powerLeadQuarters: "분기",
  initialFleetUnits: "기기",
  tasksPerUnitQ: "작업/(기기·분기)",
  edgeComputePerUnit: "PFLOPS/기기",
  initialPhysicalTaskDemand: "작업/분기",
  revenuePerTask: "USD/작업",
  unitsPerCapexB: "기기/USD B",
  hardwareFlowPFLOPS: "PFLOPS/분기",
  memoryCapacityGB: "GB",
  memoryGBPerPFLOPS: "GB/PFLOPS",
  memoryBandwidthGBs: "GB/s",
  bandwidthGBsPerPFLOPS: "(GB/s)/PFLOPS",
  packagingWafersPerQ: "웨이퍼/분기",
  chipsPerWafer: "칩/웨이퍼",
  computePerChip: "PFLOPS/칩",
  memorySupplyGBPerQ: "GB/분기",
  initialCashB: "USD B",
};
export const FIELD_RULES: FieldRule[] = Object.entries(DEFAULT_INPUTS).map(
  ([key, value]) => ({
    key,
    label: INPUT_LABELS[key] ?? key,
    default: value,
    min: positive.has(key) ? 1e-9 : 0,
    max: ratios.has(key)
      ? 1
      : growth.has(key)
        ? 0.5
        : key.endsWith("LeadQuarters")
          ? 40
          : 1e12,
    integer: key.endsWith("LeadQuarters"),
    unit:
      ratios.has(key) || growth.has(key) ? "비율" : (INPUT_UNITS[key] ?? "배"),
  }),
);
export const BASIC_KEYS = [
  "initialPowerMW",
  "initialComputePFLOPS",
  "memoryCapacityGB",
  "memoryBandwidthGBs",
  "packagingWafersPerQ",
  "utilization",
  "interconnectFactor",
  "initialDigitalDemandB",
  "digitalDemandGrowthQ",
  "reinvestRatio",
  "policyFundingBPerQ",
  "algoGrowthQ",
  "initialFleetUnits",
  "transferRatio",
];
export const MODEL_ID = "infrawheel-v2";
export const MODEL_VERSION = "2.0.0";
export interface Project {
  id: string;
  target: "compute" | "power" | "physical";
  committed: string;
  due: string;
  amountB: number;
  commissionedB: number;
  cancelledB: number;
  capacity: number;
  installed: number;
}
const metrics = [
  ["totalRevenueB", "총매출", "USD B/분기", "flow"],
  ["digitalRevenueB", "디지털 매출", "USD B/분기", "flow"],
  ["physicalRevenueB", "물리 AI 매출", "USD B/분기", "flow"],
  ["availableComputePFLOPS", "가용 연산량", "PFLOPS", "stock"],
  ["powerOnlineMW", "전력", "MW", "stock"],
  ["cashEndB", "모델 현금", "USD B", "stock"],
  ["newInvestmentB", "신규 투자", "USD B/분기", "flow"],
  ["activeFleetUnits", "활성 기기", "units", "stock"],
] as const;
export const infrawheelModel: SimulationModel = {
  modelId: MODEL_ID,
  modelVersion: MODEL_VERSION,
  engineVersion: "quarter-ledger-1",
  calibrationVersion: "structural-uncalibrated-1",
  adapterVersion: "v2-input-1",
  supportedSchemaVersions: [1],
  metrics: metrics.map(([id, label, unit, kind]) => ({
    id,
    label,
    unit,
    kind,
    aggregation: kind === "flow" ? "sum" : "end",
    comparableAcross: [MODEL_VERSION],
  })),
  validateInputs(raw) {
    const v = validateNumericFields(raw, FIELD_RULES);
    if (v.diagnostics.some((d) => d.code === "UNKNOWN_FIELD"))
      return {
        ok: false,
        diagnostics: [
          {
            level: "error",
            code: "UNKNOWN_FIELD",
            message: "지원하지 않는 입력 필드가 있습니다.",
          },
        ],
      };
    return { ok: v.ok, diagnostics: v.diagnostics, normalized: v.values };
  },
  run(input, ctx) {
    const n = assertReasonablePeriod(
        input.timeline.startQuarter,
        input.timeline.endQuarter,
      ),
      v = this.validateInputs(input.inputs),
      p = v.normalized as Record<string, number>;
    const errors = validateEvents(input.events);
    if (!v.ok || errors.length)
      throw new InvalidRunInput([...v.diagnostics, ...errors]);
    if (
      input.datasetVersion !== "assumptions-only-1" ||
      input.assumptionSetId !== "base-case-2026.v2"
    )
      throw new Error("지원하지 않는 데이터/가정 버전");
    const projects: Project[] = [],
      series: ModelRunOutput["series"] = [],
      ledger: Record<string, number | string>[] = [];
    let compute = p.initialComputePFLOPS!,
      power = p.initialPowerMW!,
      fleet = p.initialFleetUnits!,
      cash = p.initialCashB!,
      memory = p.memoryCapacityGB!;
    for (let t = 0; t < n; t++) {
      if (ctx.isCancelled()) throw new ExecutionCancelled();
      const quarter = addQuarters(input.timeline.startQuarter, t),
        qi = quarterIndex(quarter);
      const channel = (c: Parameters<typeof activeEventsAt>[1]) =>
        activeEventsAt(input.events, c, qi);
      // Delay affects projects already committed at this event start, before commissioning.
      for (const e of input.events
        .filter((e) => e.type === "project-delay" && e.startQuarter === quarter)
        .sort((a, b) => a.id.localeCompare(b.id)))
        for (const project of projects)
          if (project.installed < project.capacity)
            project.due = addQuarters(project.due, e.magnitude);
      let chipBudget =
          p.packagingWafersPerQ! * p.chipsPerWafer! * p.packagingYield!,
        newMemory = p.memorySupplyGBPerQ!,
        hardware = p.hardwareFlowPFLOPS!,
        commissionedB = 0;
      for (const project of projects) {
        if (
          quarterIndex(project.due) > qi ||
          project.installed >= project.capacity
        )
          continue;
        const left = project.capacity - project.installed;
        let installed = left;
        if (project.target === "compute")
          installed = Math.min(
            left,
            chipBudget * p.computePerChip!,
            newMemory / p.memoryGBPerPFLOPS!,
            hardware,
          );
        if (project.target === "physical")
          installed = Math.min(
            left,
            chipBudget,
            newMemory / (p.edgeComputePerUnit! * p.memoryGBPerPFLOPS!),
          );
        if (project.target === "compute") {
          compute += installed;
          memory += installed * p.memoryGBPerPFLOPS!;
          newMemory -= installed * p.memoryGBPerPFLOPS!;
          chipBudget -= installed / p.computePerChip!;
          hardware -= installed;
        }
        if (project.target === "physical") {
          fleet += installed;
          chipBudget -= installed;
          newMemory -= installed * p.edgeComputePerUnit! * p.memoryGBPerPFLOPS!;
        }
        if (project.target === "power") power += installed;
        const amount = project.capacity
          ? (project.amountB * installed) / project.capacity
          : 0;
        project.installed += installed;
        project.commissionedB += amount;
        commissionedB += amount;
      }
      const destroy = input.events
        .filter(
          (e) => e.type === "compute-destruction" && e.startQuarter === quarter,
        )
        .reduce((a, e) => a + e.magnitude, 0);
      compute *= 1 - Math.min(1, destroy);
      const powerKeep =
        1 -
        combineMultiplicativeSaturate(channel("power").map((e) => e.magnitude));
      const algo = Math.min(p.algoCeiling!, Math.pow(1 + p.algoGrowthQ!, t));
      const density = Math.pow(1 + p.densityGrowthQ!, t);
      const caps = {
        silicon: compute,
        power: ((power * powerKeep) / p.mwPerPFLOPS!) * density,
        memory: memory / p.memoryGBPerPFLOPS!,
        bandwidth: p.memoryBandwidthGBs! / p.bandwidthGBsPerPFLOPS!,
      };
      const available = Math.max(
        0,
        Math.min(...Object.values(caps)) *
          p.utilization! *
          p.interconnectFactor!,
      );
      const demand =
        p.initialDigitalDemandB! *
        Math.pow(1 + p.digitalDemandGrowthQ!, t) *
        (1 +
          combineAdditiveClamped(
            channel("demand").map((e) => e.magnitude),
            -0.9,
            2,
          ));
      const taskDemand =
        p.initialPhysicalTaskDemand! *
        Math.pow(1 + p.physicalDemandGrowthQ!, t);
      const active = algo * p.transferRatio! >= p.physicalActivationThreshold!;
      const edge = active
        ? Math.min(
            available * 0.2,
            fleet * p.edgeComputePerUnit!,
            (taskDemand / p.tasksPerUnitQ!) * p.edgeComputePerUnit!,
          )
        : 0;
      const training = available * 0.2,
        cloud = Math.min(
          Math.max(0, available - training - edge),
          demand / (p.revenuePerPFLOPS! * algo),
        );
      const served = cloud * p.revenuePerPFLOPS! * algo,
        activeFleet = Math.min(fleet, edge / p.edgeComputePerUnit!),
        servedTasks = Math.min(taskDemand, activeFleet * p.tasksPerUnitQ!);
      const physicalRevenue = (servedTasks * p.revenuePerTask!) / 1e9,
        revenue = served + physicalRevenue;
      const operating =
        served * (p.digitalGrossMargin! - p.opexRatio!) +
        physicalRevenue * p.physicalOpMargin!;
      const funding =
        p.policyFundingBPerQ! +
        combineAdditiveClamped(
          channel("funding").map((e) => e.magnitude),
          0,
          1000,
        );
      const investment = Math.max(0, operating) * p.reinvestRatio! + funding,
        cashStart = cash;
      cash += operating + funding - investment;
      const lag = combineAdditiveClamped(
        channel("leadTime").map((e) => e.magnitude),
        0,
        100,
      );
      const shares = {
        physical: p.investmentPhysicalShare!,
        power: (1 - p.investmentPhysicalShare!) * p.investmentPowerShare!,
        compute:
          (1 - p.investmentPhysicalShare!) * (1 - p.investmentPowerShare!),
      };
      for (const target of ["power", "compute", "physical"] as const) {
        const amount = investment * shares[target],
          eff =
            target === "power"
              ? p.mwPerCapexB!
              : target === "compute"
                ? p.computePerCapexB!
                : p.unitsPerCapexB!;
        if (amount > 0)
          projects.push({
            id: `${quarter}:${target}`,
            target,
            committed: quarter,
            due: addQuarters(
              quarter,
              Math.max(
                1,
                Math.ceil(
                  (target === "power"
                    ? p.powerLeadQuarters!
                    : p.computeLeadQuarters!) + lag,
                ),
              ),
            ),
            amountB: amount,
            commissionedB: 0,
            cancelledB: eff === 0 ? amount : 0,
            capacity: amount * eff,
            installed: 0,
          });
      }
      const minCap = Math.min(...Object.values(caps));
      const names: Record<string, string> = {
        silicon: "설치 반도체",
        power: "전력",
        memory: "메모리 용량",
        bandwidth: "메모리 대역폭",
      };
      const reasons = Object.entries(caps)
        .filter(([, x]) => x <= minCap * (1 + 1e-9))
        .map(([k]) => names[k]!);
      if (!active) reasons.push("물리 AI 능력 문턱 미달");
      if (served >= demand - 1e-9) reasons.push("디지털 수요 상한");
      series.push({
        quarter,
        values: {
          totalRevenueB: revenue,
          digitalRevenueB: served,
          physicalRevenueB: physicalRevenue,
          availableComputePFLOPS: available,
          allocatedTrainingPFLOPS: training,
          allocatedCloudPFLOPS: cloud,
          allocatedEdgePFLOPS: edge,
          powerOnlineMW: power,
          digitalDemandB: demand,
          physicalTaskDemand: taskDemand,
          servedPhysicalTasks: servedTasks,
          activeFleetUnits: activeFleet,
          deployedFleetUnits: fleet,
          cashEndB: cash,
          newInvestmentB: investment,
          availableCashB: operating,
          externalFundingB: funding,
          commissionedThisQuarterB: commissionedB,
          computeStockPFLOPS: compute,
          algoIndex: algo,
        },
        constraintReasons: reasons,
      });
      ledger.push({
        quarter,
        cashStartB: cashStart,
        operatingCashB: operating,
        fundingB: funding,
        investmentB: investment,
        cashEndB: cash,
      });
      ctx.onProgress?.((t + 1) / n);
    }
    return {
      series,
      diagnostics: [
        {
          level: "warning",
          code: "STRUCTURAL",
          message:
            "가정 기반 구조 실험입니다. 관측자료로 보정하거나 예측 정확도를 검증하지 않았습니다. 전역 연산 자원 공유·FP16 작업량 환산·변동 운영비를 단순화합니다.",
        },
      ],
      details: {
        projects,
        ledger,
        priceBaseYear: 2026,
        computeBasis:
          "FP16-equivalent workload (assumed conversion; TOPS not directly equated)",
        memoryAccounting:
          "기기 메모리는 신규 공급에서 차감, 클라우드 설치 메모리와 구분",
      },
    };
  },
  checkInvariants(output) {
    const errors: InvariantViolation[] = [];
    for (const r of output.series) {
      const v = r.values,
        fail = (id: string) =>
          errors.push({ invariantId: id, quarter: r.quarter, message: id });
      if (!Object.values(v).every(Number.isFinite)) fail("finite");
      if (
        v.allocatedTrainingPFLOPS! +
          v.allocatedCloudPFLOPS! +
          v.allocatedEdgePFLOPS! >
        v.availableComputePFLOPS! + 1e-6
      )
        fail("allocation");
      if (
        v.activeFleetUnits! > v.deployedFleetUnits! + 1e-6 ||
        v.servedPhysicalTasks! > v.physicalTaskDemand! + 1e-3
      )
        fail("fleet-demand");
      if (v.digitalRevenueB! > v.digitalDemandB! + 1e-6) fail("digital-demand");
      for (const [key, x] of Object.entries(v))
        if (!["cashEndB", "availableCashB"].includes(key) && x < -1e-8)
          fail("negative-" + key);
    }
    for (const p of (output.details?.projects ?? []) as Project[])
      if (
        p.installed > p.capacity + 1e-5 ||
        p.commissionedB + p.cancelledB > p.amountB + 1e-6
      )
        errors.push({
          invariantId: "project-budget",
          quarter: p.committed,
          message: p.id,
        });
    for (const row of (output.details?.ledger ?? []) as Record<
      string,
      number
    >[])
      if (
        Math.abs(
          row.cashStartB! +
            row.operatingCashB! +
            row.fundingB! -
            row.investmentB! -
            row.cashEndB!,
        ) > 1e-6
      )
        errors.push({
          invariantId: "cash-ledger",
          quarter: String(row.quarter),
          message: "cash mismatch",
        });
    return errors;
  },
};
export function resolveScenario(s: ScenarioDocument): ResolvedRunInput {
  if (s.modelId !== MODEL_ID || s.modelVersion !== MODEL_VERSION)
    throw new Error("지원하지 않는 모델 버전");
  return {
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    engineVersion: infrawheelModel.engineVersion,
    calibrationVersion: infrawheelModel.calibrationVersion,
    adapterVersion: infrawheelModel.adapterVersion,
    datasetVersion: "assumptions-only-1",
    assumptionSetId: "base-case-2026.v2",
    inputs: s.inputs,
    events: s.events,
    timeline: { ...s.timeline, timeStep: "quarter" },
    seed: 42,
    samplingSpec: null,
  };
}
export function newScenario(id: string): ScenarioDocument {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    title: "기본 시나리오",
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    baselineId: null,
    timeline: { startQuarter: "2026Q1", endQuarter: "2035Q4" },
    inputs: { ...DEFAULT_INPUTS },
    events: [],
  };
}
