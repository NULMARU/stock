import { it, expect } from "vitest";
import {
  newScenario,
  resolveScenario,
  infrawheelModel,
} from "@stock/infrawheel-model";
import { executeRun } from "@stock/simulation-core";
import { exportExperiment, importExperiment } from "./storage";
it("JSON roundtrip preserves reproducible inputs and rejects altered results", () => {
  const s = newScenario("export-test");
  const r = executeRun(infrawheelModel, resolveScenario(s), {
    scenarioId: s.id,
    scenarioRevision: s.revision,
  });
  const payload = exportExperiment(s, [r]);
  expect(importExperiment(JSON.stringify(payload)).runs[0].inputHash).toBe(
    r.inputHash,
  );
  const modified = JSON.parse(JSON.stringify(payload));
  modified.runs[0].series[0].values.totalRevenueB += 1;
  expect(() => importExperiment(JSON.stringify(modified))).toThrow();
});
it("unknown model versions are never migrated by silently relabeling", () => {
  const s = newScenario("unsupported");
  s.modelVersion = "99";
  expect(() =>
    importExperiment(JSON.stringify(exportExperiment(s, []))),
  ).toThrow();
});
