import { z } from "zod";
import {
  canonicalHash,
  hashRunInput,
  hashRunResult,
  type ScenarioDocument,
  type RunArtifact,
} from "@stock/simulation-core";
import {
  infrawheelModel,
  MODEL_ID,
  MODEL_VERSION,
} from "@stock/infrawheel-model";
const schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(),
  title: z.string().min(1).max(100),
  modelId: z.literal(MODEL_ID),
  modelVersion: z.literal(MODEL_VERSION),
  baselineId: z.string().nullable(),
  timeline: z.object({ startQuarter: z.string(), endQuarter: z.string() }),
  inputs: z.record(z.string(), z.unknown()),
  events: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        startQuarter: z.string(),
        durationQuarters: z.number().int(),
        magnitude: z.number(),
        note: z.string().optional(),
      }),
    )
    .max(100),
  notes: z.string().max(10000).optional(),
});
export function parseScenario(value: unknown): ScenarioDocument {
  const doc = schema.parse(value);
  const valid = infrawheelModel.validateInputs(doc.inputs);
  if (!valid.ok)
    throw new Error(valid.diagnostics.map((d) => d.message).join("\n"));
  return doc;
}
let connection: Promise<IDBDatabase> | null = null;
function db() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("stock-simulation-lab", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("scenarios", { keyPath: "id" });
      request.result.createObjectStore("runs", { keyPath: "runId" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error);
    };
    request.onblocked = () =>
      reject(new Error("다른 탭을 닫고 저장을 다시 시도해 주세요."));
  });
  return connection;
}
export async function allScenarios(): Promise<ScenarioDocument[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction("scenarios").objectStore("scenarios").getAll();
    r.onsuccess = () => {
      try {
        resolve(r.result.map(parseScenario));
      } catch {
        reject(
          new Error(
            "저장된 시나리오 버전을 읽을 수 없습니다. 원본을 보존했습니다.",
          ),
        );
      }
    };
    r.onerror = () => reject(r.error);
  });
}
export async function saveScenario(
  doc: ScenarioDocument,
  expectedRevision: number,
): Promise<ScenarioDocument> {
  parseScenario(doc);
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("scenarios", "readwrite"),
      store = tx.objectStore("scenarios"),
      r = store.get(doc.id);
    let result: ScenarioDocument;
    let error =
      "저장 실패. 입력은 화면에 남아 있습니다. JSON 내보내기로 보관하세요.";
    r.onsuccess = () => {
      const current = r.result as ScenarioDocument | undefined;
      if ((current?.revision ?? 0) !== expectedRevision) {
        error =
          "다른 탭에서 수정됐습니다. 새 사본으로 저장하거나 JSON으로 보관하세요.";
        tx.abort();
        return;
      }
      result = { ...doc, revision: expectedRevision + 1 };
      store.put(parseScenario(result));
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(new Error(error));
  });
}
export async function saveRun(run: RunArtifact) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("runs", "readwrite");
    tx.objectStore("runs").put(run);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error("실행 기록 저장 실패. JSON으로 보관하세요."));
  });
}
export async function allRuns(): Promise<RunArtifact[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction("runs").objectStore("runs").getAll();
    r.onsuccess = () => resolve(r.result as RunArtifact[]);
    r.onerror = () => reject(r.error);
  });
}
export function exportExperiment(
  scenario: ScenarioDocument,
  runs: RunArtifact[],
) {
  return {
    format: "stock-experiment",
    version: 1,
    scenario,
    runs,
    checksum: canonicalHash({ scenario, runs }),
  };
}
export function importExperiment(raw: string) {
  if (raw.length > 10_000_000)
    throw new Error("파일이 너무 큽니다 (최대 10MB).");
  const value = JSON.parse(raw) as ReturnType<typeof exportExperiment>;
  if (
    value.format !== "stock-experiment" ||
    value.version !== 1 ||
    canonicalHash({ scenario: value.scenario, runs: value.runs }) !==
      value.checksum
  )
    throw new Error("파일 형식·버전·체크섬이 맞지 않습니다.");
  const scenario = parseScenario(value.scenario);
  if (!Array.isArray(value.runs) || value.runs.length > 100)
    throw new Error("실행 기록 형식 오류");
  for (const run of value.runs)
    if (
      run.schemaVersion !== 1 ||
      hashRunInput(run.resolvedInput) !== run.inputHash ||
      hashRunResult({
        series: run.series,
        diagnostics: run.diagnostics,
        details: run.details,
      }) !== run.resultHash
    )
      throw new Error("실행 결과가 변경되었거나 버전이 맞지 않습니다.");
  return { scenario, runs: value.runs };
}
