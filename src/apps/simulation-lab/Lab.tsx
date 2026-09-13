import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  canonicalHash,
  type RunArtifact,
  type ScenarioDocument,
  type Quantiles,
} from "@stock/simulation-core";
import {
  BASIC_KEYS,
  FIELD_RULES,
  INPUT_LABELS,
  infrawheelModel,
  newScenario,
} from "@stock/infrawheel-model";
import {
  allScenarios,
  allRuns,
  saveScenario,
  saveRun,
  exportExperiment,
  importExperiment,
  parseScenario,
} from "./storage";
import { addUpdateGuard } from "@/lib/appUpdates";
import styles from "./Lab.module.css";
const number = (v: number | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: 2,
        notation: Math.abs(v) >= 1e6 ? "compact" : "standard",
      }).format(v);
export default function Lab() {
  const [search] = useSearchParams();
  const [scenario, setScenario] = useState<ScenarioDocument>(() =>
    newScenario(crypto.randomUUID()),
  );
  const [saved, setSaved] = useState<ScenarioDocument[]>([]),
    [runs, setRuns] = useState<RunArtifact[]>([]),
    [run, setRun] = useState<RunArtifact | null>(null),
    [advanced, setAdvanced] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("기기에 저장되는 실험실"),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [bands, setBands] = useState<Quantiles[] | null>(null),
    [compare, setCompare] = useState<string[]>([]),
    [storageReady, setStorageReady] = useState(false),
    [bandsHash, setBandsHash] = useState("");
  const worker = useRef<Worker | null>(null),
    active = useRef(""),
    revision = useRef(0),
    savePending = useRef(false),
    current = useRef(scenario);
  current.current = scenario;
  const editHash = canonicalHash({
    id: scenario.id,
    title: scenario.title,
    inputs: scenario.inputs,
    timeline: scenario.timeline,
    events: scenario.events,
  });
  const lastSaved = useRef("");
  useEffect(() => {
    let alive = true;
    Promise.all([allScenarios(), allRuns()])
      .then(([docs, records]) => {
        if (!alive) return;
        setSaved(docs);
        setRuns(records);
        const shared = search.get("scenario");
        if (!shared) {
          let id: string | null = null;
          try {
            id = localStorage.getItem("stock-lab-active");
          } catch {
            /* IndexedDB remains usable. */
          }
          const previous = docs.find((d) => d.id === id);
          if (previous) {
            revision.current = previous.revision;
            setScenario(previous);
            setRun(
              records
                .filter((r) => r.scenarioId === previous.id)
                .sort((a, b) =>
                  b.executionMetadata.executedAt.localeCompare(
                    a.executionMetadata.executedAt,
                  ),
                )[0] ?? null,
            );
          }
        }
        if (shared) {
          try {
            const parsed = parseScenario(
              JSON.parse(decodeURIComponent(atob(shared))),
            );
            setScenario({
              ...parsed,
              id: crypto.randomUUID(),
              revision: 1,
              title: parsed.title + " (공유 사본)",
            });
          } catch {
            setError(
              "공유 시나리오를 읽을 수 없습니다. 원본 JSON 파일을 사용하세요.",
            );
          }
        }
        setStorageReady(true);
      })
      .catch((e) => {
        setError(String(e));
        setStorageReady(true);
      });
    return () => {
      alive = false;
      worker.current?.terminate();
    };
  }, [search]);
  async function persist() {
    if (savePending.current) return;
    savePending.current = true;
    const doc = current.current;
    try {
      const stored = await saveScenario(doc, revision.current);
      if (current.current.id === doc.id) revision.current = stored.revision;
      setScenario((previous) =>
        previous.id === doc.id
          ? { ...previous, revision: stored.revision }
          : previous,
      );
      lastSaved.current = canonicalHash({
        id: doc.id,
        title: doc.title,
        inputs: doc.inputs,
        timeline: doc.timeline,
        events: doc.events,
      });
      setSaved(await allScenarios());
      try {
        localStorage.setItem("stock-lab-active", doc.id);
      } catch {
        /* Scenario is saved in IndexedDB. */
      }
      setMessage("자동 저장 완료 · 기기 로컬");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      savePending.current = false;
    }
  }
  useEffect(() => {
    if (!storageReady || editHash === lastSaved.current) return;
    const timer = setTimeout(() => void persist(), 800);
    return () => clearTimeout(timer);
  }, [editHash, storageReady]);
  useEffect(
    () =>
      addUpdateGuard(async () => {
        if (busy || savePending.current) return false;
        await persist();
        const doc = current.current;
        return (
          lastSaved.current ===
          canonicalHash({
            id: doc.id,
            title: doc.title,
            inputs: doc.inputs,
            timeline: doc.timeline,
            events: doc.events,
          })
        );
      }),
    [busy, editHash],
  );
  const cancel = () => {
    active.current = "";
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setMessage("실행을 취소했습니다. 이전 결과는 유지됩니다.");
  };
  function execute(mode: "run" | "range") {
    cancel();
    setError("");
    setProgress(0);
    setBusy(true);
    const requestId = crypto.randomUUID();
    active.current = requestId;
    const w = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onerror = () => {
      if (active.current !== requestId) return;
      setError("계산 Worker 오류. 다시 실행할 수 있습니다.");
      setBusy(false);
      w.terminate();
    };
    w.onmessage = ({
      data,
    }: MessageEvent<{
      requestId: string;
      type: string;
      value?: number;
      run?: RunArtifact;
      bands?: Quantiles[];
      message?: string;
    }>) => {
      if (data.requestId !== active.current) return;
      if (data.type === "progress") {
        setProgress(data.value ?? 0);
        return;
      }
      setBusy(false);
      w.terminate();
      worker.current = null;
      if (data.type === "error") {
        setError(data.message ?? "실행 실패");
        return;
      }
      if (data.type === "range") {
        setBands(data.bands ?? null);
        setBandsHash(
          canonicalHash({
            inputs: scenario.inputs,
            events: scenario.events,
            timeline: scenario.timeline,
          }),
        );
        setMessage("250개 가정 표본 계산 완료 · seed 42");
        return;
      }
      if (data.run) {
        const result = data.run;
        setRun(result);
        setBands(null);
        setMessage("실행 완료");
        saveRun(result)
          .then(() => allRuns())
          .then(setRuns)
          .catch((e) => setError(String(e)));
      }
    };
    w.postMessage({ requestId, scenario, mode });
  }
  const changed =
    (run &&
      canonicalHash(run.resolvedInput.inputs) !==
        canonicalHash(scenario.inputs)) ||
    (run &&
      canonicalHash(run.resolvedInput.events) !==
        canonicalHash(scenario.events)) ||
    (run &&
      run.resolvedInput.timeline.endQuarter !== scenario.timeline.endQuarter) ||
    (run &&
      run.resolvedInput.timeline.startQuarter !==
        scenario.timeline.startQuarter);
  function open(doc: ScenarioDocument) {
    if (savePending.current) {
      setMessage("저장 중입니다. 잠시 후 다시 선택하세요.");
      return;
    }
    cancel();
    revision.current = doc.revision;
    try {
      localStorage.setItem("stock-lab-active", doc.id);
    } catch {
      /* Optional navigation preference. */
    }
    setScenario(doc);
    lastSaved.current = canonicalHash({
      id: doc.id,
      title: doc.title,
      inputs: doc.inputs,
      timeline: doc.timeline,
      events: doc.events,
    });
    setRun(null);
    setBands(null);
    setError("");
  }
  function create(copy = false) {
    if (savePending.current) {
      setMessage("저장 중입니다. 잠시 후 다시 선택하세요.");
      return;
    }
    cancel();
    revision.current = 0;
    setScenario(
      copy
        ? {
            ...scenario,
            id: crypto.randomUUID(),
            revision: 1,
            title: scenario.title + " 사본",
            baselineId: scenario.id,
          }
        : newScenario(crypto.randomUUID()),
    );
    setRun(null);
    setBands(null);
    setError("");
  }
  function download() {
    const payload = exportExperiment(
      scenario,
      runs.filter((r) => r.scenarioId === scenario.id),
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "stock-experiment.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function upload(file: File | undefined) {
    if (!file || savePending.current) return;
    try {
      const imported = importExperiment(await file.text());
      cancel();
      revision.current = 0;
      setScenario({
        ...imported.scenario,
        id: crypto.randomUUID(),
        revision: 1,
        title: imported.scenario.title + " 가져온 사본",
      });
      for (const r of imported.runs) await saveRun(r);
      setRuns(await allRuns());
      setRun(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "가져오기 실패");
    }
  }
  async function share() {
    try {
      const url = new URL(location.href);
      url.hash =
        "/lab?scenario=" +
        encodeURIComponent(btoa(encodeURIComponent(JSON.stringify(scenario))));
      if (url.toString().length > 7500)
        throw new Error("공유 주소가 너무 깁니다. JSON 내보내기를 사용하세요.");
      await navigator.clipboard.writeText(url.toString());
      setMessage(
        "공유 주소 복사 완료 · 저장된 실행 결과는 JSON 파일에 포함됩니다.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "주소 복사 실패");
    }
  }
  const end = run?.series.at(-1);
  const selected = runs.filter(
    (r) =>
      compare.includes(r.runId) &&
      r.resolvedInput.modelVersion === infrawheelModel.modelVersion,
  );
  const compatible = selected.every(
    (r) =>
      JSON.stringify(r.resolvedInput.timeline) ===
      JSON.stringify(selected[0]?.resolvedInput.timeline),
  );
  const values = run?.series.map((r) => r.values.totalRevenueB!) ?? [];
  const max = Math.max(1, ...values);
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <strong>◉ STOCK LAB / 시뮬레이션</strong>
        <Link
          to={
            search.get("stock")
              ? `/stock/${encodeURIComponent(search.get("stock")!)}`
              : "/"
          }
        >
          스톡으로 돌아가기 ↗
        </Link>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <div>
            <span className={styles.badge}>STRUCTURAL · 가정 기반</span>
            <h1>조건을 바꾸면, 미래의 경로도 달라집니다.</h1>
            <p className={styles.muted}>
              AI 인프라의 공급·수요·현금·투자 지연을 분기 단위로 비교하는 나의
              실험실
            </p>
          </div>
          <div className={styles.muted}>
            2026 기준 가정 / 모델 2.0.0
            <br />
            목표가·부도 확률을 예측하지 않습니다.
          </div>
        </div>
        {search.get("stock") && (
          <p className={styles.notice}>
            {search.get("stock")}에서 열었습니다. 이 모델은 글로벌 산업 가정이며
            해당 회사 재무 수치를 자동 대입하지 않습니다.
          </p>
        )}
        <div className={styles.toolbar}>
          <button onClick={() => create()}>새 시나리오</button>
          <button onClick={() => create(true)}>복제</button>
          <button onClick={download}>JSON 내보내기</button>
          <label>
            <span>가져오기 </span>
            <input
              aria-label="시나리오 JSON 가져오기"
              type="file"
              accept=".json"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          <button onClick={() => void share()}>공유 주소</button>
        </div>
        {saved.length > 0 && (
          <div className={styles.saved}>
            {saved.map((s) => (
              <button key={s.id} onClick={() => open(s)}>
                {s.title}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div role="alert" className={`${styles.notice} ${styles.error}`}>
            {error}
          </div>
        )}
        <div className={styles.grid}>
          <section className={styles.panel}>
            <h2>1. 가정 설정</h2>
            <input
              aria-label="시나리오 이름"
              className={styles.titleInput}
              value={scenario.title}
              maxLength={100}
              onChange={(e) =>
                setScenario({ ...scenario, title: e.target.value })
              }
            />
            <div className={styles.field}>
              <label htmlFor="start-q">시작 분기</label>
              <input
                id="start-q"
                value={scenario.timeline.startQuarter}
                onChange={(e) =>
                  setScenario({
                    ...scenario,
                    timeline: {
                      ...scenario.timeline,
                      startQuarter: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="end-q">종료 분기</label>
              <input
                id="end-q"
                value={scenario.timeline.endQuarter}
                onChange={(e) =>
                  setScenario({
                    ...scenario,
                    timeline: {
                      ...scenario.timeline,
                      endQuarter: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className={styles.tabs}>
              <button
                aria-pressed={!advanced}
                onClick={() => setAdvanced(false)}
              >
                기본 14개
              </button>
              <button aria-pressed={advanced} onClick={() => setAdvanced(true)}>
                고급 전체
              </button>
            </div>
            <p className={styles.muted}>
              표시 모드를 바꿔도 고급 입력은 유지됩니다. 모든 기본값은 관측치가
              아닌 가정입니다.
            </p>
            {FIELD_RULES.filter(
              (f) => advanced || BASIC_KEYS.includes(f.key),
            ).map((f) => (
              <div className={styles.field} key={f.key}>
                <label htmlFor={"input-" + f.key}>
                  {f.label}
                  <small>
                    {f.unit} · {f.min}~{f.max}
                  </small>
                </label>
                <input
                  id={"input-" + f.key}
                  type="number"
                  step="any"
                  min={f.min}
                  max={f.max}
                  value={Number(scenario.inputs[f.key])}
                  onChange={(e) => {
                    const v = e.target.valueAsNumber;
                    if (Number.isFinite(v))
                      setScenario({
                        ...scenario,
                        inputs: { ...scenario.inputs, [f.key]: v },
                      });
                  }}
                />
              </div>
            ))}
            <details>
              <summary>사건 가정</summary>
              <p className={styles.muted}>
                사건은 발생을 전제로 한 조건입니다. 발생 확률을 뜻하지 않습니다.
              </p>
              <button
                onClick={() =>
                  setScenario({
                    ...scenario,
                    events: [
                      ...scenario.events,
                      {
                        id: crypto.randomUUID(),
                        type: "power-shock",
                        startQuarter: scenario.timeline.startQuarter,
                        durationQuarters: 4,
                        magnitude: 0.2,
                      },
                    ],
                  })
                }
              >
                전력 공급 충격 추가
              </button>
              {scenario.events.map((e, i) => (
                <div key={e.id} className={styles.notice}>
                  <label>
                    사건 종류
                    <select
                      value={e.type}
                      onChange={(v) =>
                        setScenario({
                          ...scenario,
                          events: scenario.events.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  type: v.target.value,
                                  magnitude:
                                    v.target.value.includes("delay") ||
                                    v.target.value.includes("time")
                                      ? 2
                                      : 0.2,
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      {[
                        ["power-shock", "전력 중단"],
                        ["demand-shock", "수요 변화"],
                        ["compute-destruction", "설비 파괴"],
                        ["subsidy", "정책 자금"],
                        ["lead-time-shock", "신규 준공 지연"],
                        ["project-delay", "진행 투자 지연"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(
                    ["startQuarter", "durationQuarters", "magnitude"] as const
                  ).map((k) => (
                    <label className={styles.field} key={k}>
                      {k === "startQuarter"
                        ? "시작 분기"
                        : k === "durationQuarters"
                          ? "기간 (분기)"
                          : "크기 (비율/분기/$B)"}
                      <input
                        aria-label={`${i + 1}번 사건 ${k}`}
                        value={e[k]}
                        onChange={(v) =>
                          setScenario({
                            ...scenario,
                            events: scenario.events.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    [k]:
                                      k === "startQuarter"
                                        ? v.target.value
                                        : Number(v.target.value),
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    onClick={() =>
                      setScenario({
                        ...scenario,
                        events: scenario.events.filter((x) => x.id !== e.id),
                      })
                    }
                  >
                    사건 삭제
                  </button>
                </div>
              ))}
            </details>
          </section>
          <section>
            <div className={styles.panel}>
              <h2>2. 실행하고 비교하기</h2>
              <div className={styles.toolbar}>
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => execute("run")}
                >
                  시뮬레이션 실행
                </button>
                <button disabled={!busy} onClick={cancel}>
                  실행 취소
                </button>
                <button disabled={busy} onClick={() => execute("range")}>
                  수요 성장 ±20% 가정 범위
                </button>
                <button onClick={() => void persist()}>저장</button>
              </div>
              <p aria-live="polite" className={styles.muted}>
                {message}
              </p>
              {busy && (
                <progress aria-label="계산 진행률" value={progress} max={1} />
              )}
              <div className={styles.notice}>
                이 결과는 가정 간 관계를 살펴보는 구조 실험입니다.
                가격·성장·환산계수는 관측자료로 보정되지 않았습니다. 메모리·칩
                생산·전력 제약, 모델상 현금 수지의 일관성을 검증합니다.
              </div>
              {changed && (
                <p role="status" className={styles.notice}>
                  입력이 바뀌었습니다. 아래는 이전 실행 결과입니다. 다시 실행해
                  반영하세요.
                </p>
              )}
              {!run && !bands && (
                <div className={styles.muted} style={{ padding: "45px 0" }}>
                  왼쪽에서 가정을 설정하고 실행하세요.
                  <br />
                  계산 결과·병목 원인·현금 원장·비교 기록이 이곳에 표시됩니다.
                </div>
              )}
              {run && end && (
                <>
                  <div className={styles.cards}>
                    {[
                      ["totalRevenueB", "마지막 분기 매출", "USD B"],
                      ["availableComputePFLOPS", "가용 연산량", "PFLOPS"],
                      ["cashEndB", "모델 현금", "USD B"],
                    ].map(([key, label, unit]) => (
                      <div key={key} className={styles.stat}>
                        {label}
                        <strong>{number(end.values[key!])}</strong>
                        {unit}
                      </div>
                    ))}
                  </div>
                  <h2 style={{ marginTop: 25 }}>
                    매출 경로 <small>(USD B / 분기)</small>
                  </h2>
                  <svg
                    className={styles.chart}
                    viewBox="0 0 600 210"
                    role="img"
                    aria-label="분기별 총매출 추이. 아래 표에서 정확한 값을 확인할 수 있습니다."
                  >
                    <line x1="25" y1="180" x2="590" y2="180" stroke="#cbd7df" />
                    <polyline
                      fill="none"
                      stroke="#087982"
                      strokeWidth="3"
                      points={values
                        .map(
                          (v, i) =>
                            `${25 + (i / Math.max(1, values.length - 1)) * 550},${180 - (v / max) * 155}`,
                        )
                        .join(" ")}
                    />
                    <text x="25" y="204" fontSize="12">
                      {run.series[0]?.quarter}
                    </text>
                    <text x="535" y="204" fontSize="12">
                      {end.quarter}
                    </text>
                    <text x="25" y="15" fontSize="12">
                      {number(max)} USD B
                    </text>
                  </svg>
                  <div className={styles.wheel}>
                    {[
                      ["반도체", "computeStockPFLOPS", "PFLOPS"],
                      ["전력", "powerOnlineMW", "MW"],
                      ["수요", "digitalDemandB", "USD B"],
                      ["디지털", "digitalRevenueB", "USD B"],
                      ["물리 AI", "activeFleetUnits", "기기"],
                      ["재투자", "newInvestmentB", "USD B"],
                    ].map(([label, key, unit]) => (
                      <div className={styles.node} key={key}>
                        {label}
                        <strong>
                          {number(end.values[key!])} {unit}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <p className={styles.muted}>
                    마지막 분기 제약: {end.constraintReasons.join(" · ")}
                  </p>
                  <details open>
                    <summary>분기별 결과 표</summary>
                    <div className={styles.scroll}>
                      <table>
                        <thead>
                          <tr>
                            <th>분기</th>
                            {infrawheelModel.metrics.map((m) => (
                              <th key={m.id}>
                                {m.label}
                                <br />
                                {m.unit}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {run.series.map((r) => (
                            <tr key={r.quarter}>
                              <th>{r.quarter}</th>
                              {infrawheelModel.metrics.map((m) => (
                                <td key={m.id}>{number(r.values[m.id])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <details>
                    <summary>현금·투자 원장과 재현 정보</summary>
                    <p className={styles.muted}>
                      입력 해시 {run.inputHash}
                      <br />
                      데이터 {run.resolvedInput.datasetVersion} · 엔진{" "}
                      {run.resolvedInput.engineVersion}
                    </p>
                    <div className={styles.scroll}>
                      <table>
                        <thead>
                          <tr>
                            <th>분기</th>
                            <th>기초 현금</th>
                            <th>영업 현금</th>
                            <th>외부 자금</th>
                            <th>투자</th>
                            <th>기말 현금</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            (run.details?.ledger as Record<
                              string,
                              number | string
                            >[]) ?? []
                          ).map((r) => (
                            <tr key={r.quarter}>
                              <th>{r.quarter}</th>
                              {[
                                "cashStartB",
                                "operatingCashB",
                                "fundingB",
                                "investmentB",
                                "cashEndB",
                              ].map((k) => (
                                <td key={k}>{number(Number(r[k]))}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className={styles.muted}>
                      투자는 약정 때 현금에서 차감됩니다. 준공은 설치량을 늘리며
                      현금을 다시 차감하지 않습니다.
                    </p>
                  </details>
                </>
              )}
              {bands &&
                bandsHash ===
                  canonicalHash({
                    inputs: scenario.inputs,
                    events: scenario.events,
                    timeline: scenario.timeline,
                  }) && (
                  <>
                    <h2>조건부 범위 · 총매출 (USD B)</h2>
                    <p className={styles.notice}>
                      분기 수요 성장률을 현재 입력의 80~120% (성장률 상한 0.5)
                      균등분포로 가정한 250개 표본입니다 (seed 42).
                      P10/P50/P90은 실제 미래의 보장 확률 구간이 아닙니다.
                    </p>
                    <div className={styles.scroll}>
                      <table>
                        <thead>
                          <tr>
                            <th>순서</th>
                            <th>P10</th>
                            <th>P50</th>
                            <th>P90</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bands.map((b, i) => (
                            <tr key={i}>
                              <th>{i + 1}분기</th>
                              <td>{number(b.p10)}</td>
                              <td>{number(b.p50)}</td>
                              <td>{number(b.p90)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
            </div>
            <div className={styles.panel}>
              <h2>3. 저장된 실행 비교</h2>
              <p className={styles.muted}>
                같은 모델 버전의 실행을 최대 4개 선택합니다. 같은 종료 분기만
                수치 비교하세요.
              </p>
              {runs
                .slice()
                .reverse()
                .slice(0, 30)
                .map((r) => (
                  <label
                    key={r.runId}
                    style={{ display: "block", margin: "10px 0" }}
                  >
                    <input
                      type="checkbox"
                      checked={compare.includes(r.runId)}
                      disabled={
                        !compare.includes(r.runId) && compare.length >= 4
                      }
                      onChange={(e) =>
                        setCompare(
                          e.target.checked
                            ? [...compare, r.runId]
                            : compare.filter((x) => x !== r.runId),
                        )
                      }
                    />{" "}
                    {saved.find((s) => s.id === r.scenarioId)?.title ??
                      "실행 기록"}{" "}
                    · {r.resolvedInput.timeline.endQuarter} ·{" "}
                    {r.inputHash.slice(0, 8)}{" "}
                    <button
                      onClick={() => {
                        setRun(r);
                        setBands(null);
                      }}
                    >
                      결과 열기
                    </button>
                  </label>
                ))}
              {!compatible && (
                <p role="alert" className={styles.notice}>
                  기간이 다른 실행은 직접 비교할 수 없습니다. 시작·종료 분기를
                  맞추세요.
                </p>
              )}
              {selected.length > 0 && compatible && (
                <div className={styles.scroll}>
                  <table>
                    <thead>
                      <tr>
                        <th>실행</th>
                        <th>종료 분기</th>
                        <th>총매출 (USD B)</th>
                        <th>모델 현금 (USD B)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.map((r) => (
                        <tr key={r.runId}>
                          <th>{r.inputHash.slice(0, 8)}</th>
                          <td>{r.resolvedInput.timeline.endQuarter}</td>
                          <td>
                            {number(r.series.at(-1)?.values.totalRevenueB)}
                          </td>
                          <td>{number(r.series.at(-1)?.values.cashEndB)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
        <footer className={styles.footer}>
          원본: NULMARU/infrawheel-lite (09c710e),
          JihoonJeong/infrawheel-model에서 파생. 원본 재현 엔진은 보존하고,
          화면은 별도 Structural v2를 사용합니다.
          <br />
          모든 가정: {Object.keys(INPUT_LABELS).length}개 · 기기 로컬 저장 ·
          JSON 원본과 실행 버전을 함께 보관하세요.
        </footer>
      </main>
    </div>
  );
}
