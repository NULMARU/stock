/**
 * Execution pipeline: input validation → version pinning → quarterly compute →
 * invariant checks → summary → hash. An invalid input or invariant failure is
 * never published as a normal run result.
 */

import { canonicalHash, canonicalJson } from "./canonical";
import {
  ExecutionCancelled,
  InvariantFailure,
  InvalidRunInput,
  SCHEMA_VERSION,
  type ExecutionMetadata,
  type ModelRunOutput,
  type ResolvedRunInput,
  type RunArtifact,
  type RunContext,
  type SimulationModel,
} from "./contracts";
import { assertReasonablePeriod, parseQuarter } from "./time";
import { validateSamplingSpec } from "./sampling";

export interface ExecuteOptions {
  scenarioId: string;
  scenarioRevision: number;
  evidenceRefs?: string[];
  /** Injected for deterministic replay tests; production passes real clock. */
  now?: () => Date;
  executor?: ExecutionMetadata["executor"];
  ctx?: RunContext;
}

/** Fields that affect run semantics — everything except presentation. */
export function hashRunInput(input: ResolvedRunInput): string {
  return canonicalHash({
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    engineVersion: input.engineVersion,
    calibrationVersion: input.calibrationVersion,
    datasetVersion: input.datasetVersion,
    adapterVersion: input.adapterVersion,
    timeline: input.timeline,
    inputs: input.inputs,
    assumptionSetId: input.assumptionSetId,
    events: input.events
      .map((event) => ({
        id: event.id,
        type: event.type,
        startQuarter: event.startQuarter,
        durationQuarters: event.durationQuarters,
        magnitude: event.magnitude,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    seed: input.seed,
    samplingSpec: input.samplingSpec,
  });
}

/** Hash of the semantic result: series + diagnostics, not timestamps. */
export function hashRunResult(output: ModelRunOutput): string {
  return canonicalHash({
    series: output.series,
    diagnostics: output.diagnostics,
    details: output.details ?? {},
  });
}

export function validateResolvedInput(input: ResolvedRunInput): void {
  const problems: string[] = [];
  if (!input.modelId) problems.push("modelId is required");
  for (const v of [
    input.modelVersion,
    input.engineVersion,
    input.calibrationVersion,
    input.datasetVersion,
    input.adapterVersion,
    input.assumptionSetId,
  ]) {
    if (!v) problems.push("all version fields are required");
  }
  try {
    assertReasonablePeriod(
      input.timeline.startQuarter,
      input.timeline.endQuarter,
    );
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  if (input.timeline.timeStep !== "quarter")
    problems.push(
      "only quarterly timeStep is supported in this engine version",
    );
  if (!Number.isInteger(input.seed)) problems.push("seed must be an integer");
  if (
    !input.inputs ||
    typeof input.inputs !== "object" ||
    Array.isArray(input.inputs)
  )
    problems.push("inputs must be an object");
  if (!Array.isArray(input.events) || input.events.length > 100)
    throw new InvalidRunInput([
      {
        level: "error",
        code: "EVENTS",
        message: "events must be an array of at most 100 events",
      },
    ]);
  if (input.samplingSpec)
    problems.push(
      ...validateSamplingSpec(input.samplingSpec)
        .diagnostics.filter((d) => d.level === "error")
        .map((d) => d.message),
    );
  const eventIds = new Set<string>();
  for (const ev of input.events) {
    if (!ev || !ev.id || !ev.type || !Number.isFinite(ev.magnitude))
      throw new InvalidRunInput([
        { level: "error", code: "EVENT", message: "invalid event" },
      ]);
    try {
      parseQuarter(ev.startQuarter);
    } catch {
      problems.push("invalid event quarter");
    }
    if (eventIds.has(ev.id)) problems.push(`duplicate event id: ${ev.id}`);
    eventIds.add(ev.id);
    if (!Number.isInteger(ev.durationQuarters) || ev.durationQuarters < 1) {
      problems.push(
        `event ${ev.id}: durationQuarters must be a positive integer`,
      );
    }
  }
  if (problems.length > 0) {
    throw new InvalidRunInput(
      problems.map((message) => ({
        level: "error" as const,
        code: "INVALID_RESOLVED_INPUT",
        message,
      })),
    );
  }
}

export function executeRun(
  model: SimulationModel,
  input: ResolvedRunInput,
  options: ExecuteOptions,
): RunArtifact {
  const started = (options.now ?? (() => new Date()))();
  const ctx: RunContext = options.ctx ?? { isCancelled: () => false };

  try {
    validateResolvedInput(input);
  } catch (error) {
    if (error instanceof InvalidRunInput) throw error;
    throw new InvalidRunInput([
      {
        level: "error",
        code: "SHAPE",
        message: "실행 입력 형식이 잘못되었습니다.",
      },
    ]);
  }
  for (const key of [
    "modelId",
    "modelVersion",
    "engineVersion",
    "calibrationVersion",
    "adapterVersion",
  ] as const) {
    if (input[key] !== model[key])
      throw new InvalidRunInput([
        {
          level: "error",
          code: "VERSION",
          message: `지원하지 않는 ${key}: ${input[key]}`,
        },
      ]);
  }
  if (ctx.isCancelled()) throw new ExecutionCancelled();
  if (!model.supportedSchemaVersions.includes(SCHEMA_VERSION)) {
    throw new InvalidRunInput([
      {
        level: "error",
        code: "UNSUPPORTED_SCHEMA",
        message: `model ${model.modelId} does not support schema ${SCHEMA_VERSION}`,
      },
    ]);
  }
  const validation = model.validateInputs(input.inputs);
  if (!validation.ok) throw new InvalidRunInput(validation.diagnostics);

  input = deepFreeze(
    JSON.parse(
      canonicalJson({
        ...input,
        inputs: validation.normalized ?? input.inputs,
        events: [...input.events].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    ),
  ) as ResolvedRunInput;
  const inputHash = hashRunInput(input);
  let output: ModelRunOutput;
  try {
    output = model.run(input, ctx);
  } catch (e) {
    if (e instanceof ExecutionCancelled) throw e;
    throw e;
  }
  if (ctx.isCancelled()) throw new ExecutionCancelled();

  const violations = model.checkInvariants(output);
  if (violations.length > 0) throw new InvariantFailure(violations);

  output = { ...output, diagnostics: output.diagnostics };
  canonicalJson(output);
  const finished = (options.now ?? (() => new Date()))();
  return deepFreeze(
    JSON.parse(
      canonicalJson({
        schemaVersion: SCHEMA_VERSION,
        runId: `run_${canonicalHash({scenarioId:options.scenarioId,inputHash}).slice(0, 24)}`,
        scenarioId: options.scenarioId,
        scenarioRevision: options.scenarioRevision,
        inputHash,
        resolvedInput: input,
        series: output.series,
        diagnostics: output.diagnostics,
        details: output.details ?? {},
        evidenceRefs: options.evidenceRefs ?? [],
        resultHash: hashRunResult(output),
        executionMetadata: {
          executedAt: finished.toISOString(),
          durationMs: Math.max(0, finished.getTime() - started.getTime()),
          executor: options.executor ?? "main",
          cancelled: false,
        },
      }),
    ),
  ) as RunArtifact;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Deterministic replay check: re-executing the same resolved input must
 * produce the identical result hash in the same build/runtime.
 */
export function verifyDeterministicReplay(
  model: SimulationModel,
  input: ResolvedRunInput,
): boolean {
  const a = executeRun(model, input, {
    scenarioId: "replay",
    scenarioRevision: 1,
  });
  const b = executeRun(model, input, {
    scenarioId: "replay",
    scenarioRevision: 1,
  });
  return a.resultHash === b.resultHash;
}
