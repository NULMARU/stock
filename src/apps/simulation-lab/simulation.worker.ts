/// <reference lib="webworker" />
import {
  executeRun,
  sampleInputs,
  quantiles,
  type ScenarioDocument,
  type ResolvedRunInput,
} from "@stock/simulation-core";
import { infrawheelModel, resolveScenario } from "@stock/infrawheel-model";
self.onmessage = (
  event: MessageEvent<{
    requestId: string;
    scenario: ScenarioDocument;
    mode: "run" | "range";
  }>,
) => {
  const { requestId, scenario, mode } = event.data;
  try {
    const input = resolveScenario(scenario);
    if (mode === "range") {
      const key = "digitalDemandGrowthQ",
        base = Number(input.inputs[key]);
      if(base<=0)throw new Error("가정 범위 분석은 양의 수요 성장률을 입력한 뒤 실행하세요.");
      const spec = {
        sampleCount: 250,
        seed: 42,
        distributions: {
          [key]: {
            kind: "uniform" as const,
            min: Math.max(0, base * 0.8),
            max: Math.min(0.5, base * 1.2),
          },
        },
      };
      const samples: number[][] = [];
      for (let i = 0; i < spec.sampleCount; i++) {
        const drawn = sampleInputs(spec, i);
        const sampled: ResolvedRunInput = {
          ...input,
          inputs: { ...input.inputs, ...drawn.draws },
        };
        const r = executeRun(infrawheelModel, sampled, {
          scenarioId: scenario.id,
          scenarioRevision: scenario.revision,
          executor: "worker",
        });
        samples.push(r.series.map((p) => p.values.totalRevenueB!));
        if (i % 10 === 0)
          self.postMessage({
            requestId,
            type: "progress",
            value: i / spec.sampleCount,
          });
      }
      const bands = samples[0]!.map((_, i) =>
        quantiles(samples.map((s) => s[i]!)),
      );
      self.postMessage({ requestId, type: "range", bands, spec });
    } else {
      const run = executeRun(infrawheelModel, input, {
        scenarioId: scenario.id,
        scenarioRevision: scenario.revision,
        executor: "worker",
        ctx: {
          isCancelled: () => false,
          onProgress: (value) =>
            self.postMessage({ requestId, type: "progress", value }),
        },
      });
      self.postMessage({ requestId, type: "result", run });
    }
  } catch (e) {
    self.postMessage({
      requestId,
      type: "error",
      message: e instanceof Error ? e.message : "실행 중 오류",
    });
  }
};
