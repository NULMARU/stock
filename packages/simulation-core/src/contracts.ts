/**
 * Execution contracts (docs/simulation-lab-development-plan.md §5):
 * Scenario is editable; Run is a frozen record of the input and result at
 * execution time. Versions are split so a UI-only change never bumps the model.
 */

export const SCHEMA_VERSION = 1;

export type VersionedId = string;

export interface ScenarioEvent {
  id: string;
  /** Registered EventDefinition id, e.g. 'power-shock'. Unknown ids are rejected. */
  type: string;
  startQuarter: string;
  durationQuarters: number;
  /** Channel-specific magnitude in the unit declared by the EventDefinition. */
  magnitude: number;
  note?: string;
}

export interface ScenarioDocument {
  schemaVersion: number;
  id: string;
  /** Monotonic per-document revision; bump on every persisted edit. */
  revision: number;
  title: string;
  modelId: string;
  modelVersion: string;
  /** null for a baseline scenario; otherwise the scenario id it varies from. */
  baselineId: string | null;
  timeline: { startQuarter: string; endQuarter: string };
  /** Model-specific input object (unit-normalized at resolve time). */
  inputs: Record<string, unknown>;
  events: ScenarioEvent[];
  /** Presentation-only; excluded from hashes and sharing by default. */
  notes?: string;
}

export interface SamplingSpec {
  sampleCount: number;
  seed: number;
  /** input path (dotted) → distribution. Only listed inputs are sampled. */
  distributions: Record<string, DistributionSpec>;
  /** Optional correlation for listed variables. */
  correlation?: { variables: string[]; matrix: number[][] };
}

export type DistributionSpec =
  | { kind: "uniform"; min: number; max: number }
  | {
      kind: "normal";
      mean: number;
      sd: number;
      clampMin?: number;
      clampMax?: number;
    }
  | { kind: "triangular"; min: number; mode: number; max: number };

export interface ResolvedRunInput {
  modelId: string;
  modelVersion: string;
  engineVersion: string;
  calibrationVersion: string;
  datasetVersion: string;
  adapterVersion: string;
  timeline: { startQuarter: string; endQuarter: string; timeStep: "quarter" };
  /** Unit-normalized, validated model inputs. */
  inputs: Record<string, unknown>;
  /** Versioned assumption set id, e.g. 'base-case-2026.v1'. */
  assumptionSetId: string;
  events: ScenarioEvent[];
  seed: number;
  samplingSpec: SamplingSpec | null;
}

export type DiagnosticLevel = "info" | "warning" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  quarter?: string;
}

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  kind: "stock" | "flow" | "index" | "ratio";
  /** How to aggregate over time: flows sum; stocks pick end or mean. */
  aggregation: "sum" | "end" | "mean" | "none";
  /** Which model versions this metric is comparable across. */
  comparableAcross: string[];
}

export interface DatasetManifest {
  version: string;
  contentHash: string;
  source: string;
  observationDate: string;
  publishedAt: string;
  retrievedAt: string;
  geography: string;
  unit: string;
  coverage: string;
  redistributionStatus: "redistributable" | "derived-only" | "internal";
}

export interface QuarterSeries {
  quarter: string;
  /** metric id → value; units from the model's MetricDefinitions. */
  values: Record<string, number>;
  /** Constraint/bottleneck reasons active this quarter (may be empty). */
  constraintReasons: string[];
}

export interface InvariantViolation {
  invariantId: string;
  quarter: string;
  message: string;
}

export interface ModelRunOutput {
  series: QuarterSeries[];
  diagnostics: Diagnostic[];
  /** Extra structured detail for the evidence view (ledger rows etc.). */
  details?: Record<string, unknown>;
}

export interface RunContext {
  /** Cooperative cancellation: models must check between quarters/samples. */
  isCancelled(): boolean;
  onProgress?(fraction: number): void;
}

export interface SimulationModel {
  modelId: string;
  modelVersion: string;
  engineVersion: string;
  calibrationVersion: string;
  adapterVersion: string;
  supportedSchemaVersions: number[];
  metrics: MetricDefinition[];
  /** Parse/validate raw inputs; returns diagnostics instead of throwing where possible. */
  validateInputs(inputs: Record<string, unknown>): {
    ok: boolean;
    diagnostics: Diagnostic[];
    normalized?: Record<string, unknown>;
  };
  run(input: ResolvedRunInput, ctx: RunContext): ModelRunOutput;
  /** Physical invariants checked over every run; a failure blocks publication. */
  checkInvariants(output: ModelRunOutput): InvariantViolation[];
}

export interface ExecutionMetadata {
  executedAt: string;
  durationMs: number;
  executor: "worker" | "main" | "server";
  cancelled: boolean;
}

export interface RunArtifact {
  schemaVersion: number;
  runId: string;
  scenarioId: string;
  scenarioRevision: number;
  inputHash: string;
  resolvedInput: ResolvedRunInput;
  series: QuarterSeries[];
  diagnostics: Diagnostic[];
  evidenceRefs: string[];
  resultHash: string;
  details?: Record<string, unknown>;
  executionMetadata: ExecutionMetadata;
}

export class ExecutionCancelled extends Error {
  constructor() {
    super("run cancelled");
    this.name = "ExecutionCancelled";
  }
}

export class InvalidRunInput extends Error {
  diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(`invalid run input: ${diagnostics.map((d) => d.message).join("; ")}`);
    this.name = "InvalidRunInput";
    this.diagnostics = diagnostics;
  }
}

export class InvariantFailure extends Error {
  violations: InvariantViolation[];
  constructor(violations: InvariantViolation[]) {
    super(
      `invariant failure: ${violations.map((v) => `[${v.invariantId}] ${v.quarter}: ${v.message}`).join("; ")}`,
    );
    this.name = "InvariantFailure";
    this.violations = violations;
  }
}
