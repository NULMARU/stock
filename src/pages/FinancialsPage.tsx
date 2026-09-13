import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  SnapshotSchema,
  ACCOUNTS,
  QUESTIONS,
  analyzeFinancials,
  makeTTM,
  type FinancialSnapshot,
  type FinancialPeriod,
  type QuoteContext,
} from "@stock/financial-analysis";
const API = (import.meta.env.VITE_FINANCIAL_API_URL ?? "").replace(/\/$/, "");
const fmt = (n: number | null | undefined) =>
  n == null
    ? "미공시 / 자료 없음"
    : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(n);
const statusLabel = {
  ready: "계산 가능",
  missing: "자료 부족",
  invalid: "해석 보류",
  "not-applicable": "업종 전용 분석 필요",
};
function teachingExample(): FinancialSnapshot {
  const periods: FinancialPeriod[] = [
    ["2024-10-01", "2024-12-31"],
    ["2025-01-01", "2025-03-31"],
    ["2025-04-01", "2025-06-30"],
    ["2025-07-01", "2025-09-30"],
    ["2025-10-01", "2025-12-31"],
  ].map(([start, end], i) => ({
    id: `example-${i}`,
    kind: "quarter",
    start,
    end,
    currency: "KRW",
    scope: "consolidated",
    warnings: ["학습용 가상 숫자입니다. 실제 기업 공시가 아닙니다."],
    sources: {},
    values: {
      revenue: 100e6 + i * 10e6,
      costOfRevenue: 60e6 + i * 6e6,
      operatingIncome: 15e6 + i * 2e6,
      netIncome: 10e6 + i * 1e6,
      interestExpense: 2e6,
      assets: 300e6 + i * 10e6,
      liabilities: 100e6,
      equity: 200e6 + i * 10e6,
      currentAssets: 120e6,
      currentLiabilities: 50e6,
      cash: 40e6,
      inventory: 30e6 + i * 1e6,
      receivables: 25e6 + i * 1e6,
      ocf: 12e6 + i * 1e6,
      icf: -8e6,
      financingCF: -3e6,
      capexPPE: 7e6,
      capexIntangibles: 1e6,
      dividends: 2e6,
      buybacks: 1e6,
    },
  }));
  const ttm = makeTTM(periods);
  return {
    schemaVersion: 1,
    issuerId: "example:fictional",
    name: "학습용 가상기업",
    industry: "manufacturing",
    financialVersion: "educational-example-1",
    filedAt: "해당 없음",
    latestKnownFilingId: "해당 없음",
    fetchedAt: "해당 없음",
    source: "DART",
    periods: ttm ? [ttm, ...periods.reverse()] : periods,
    warnings: [
      "이 화면의 모든 숫자는 설명을 위해 만든 예시입니다. 종목 분석에 사용하지 마세요.",
    ],
  };
}
function cached(key: string) {
  try {
    return SnapshotSchema.parse(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
  } catch {
    return null;
  }
}
export default function FinancialsPage() {
  const { ticker = "" } = useParams();
  const [search] = useSearchParams();
  const market =
    search.get("market") ??
    (/\.(KS|KQ)$/.test(ticker)
      ? "KR"
      : /\.(HK|SS|SZ)$/.test(ticker)
        ? "CN"
        : "US");
  const cacheKey = `stock-financial-v1:${market}:${ticker}`;
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(() =>
      cached(cacheKey),
    ),
    [status, setStatus] = useState(
      API ? "공시 연결 확인 중" : "재무 서버 연결 전",
    ),
    [error, setError] = useState(""),
    [stale, setStale] = useState(true),
    [checked, setChecked] = useState<string | null>(null),
    [periodId, setPeriodId] = useState(""),
    [kind, setKind] = useState("ttm"),
    [refresh, setRefresh] = useState(0),
    [demo, setDemo] = useState(false),
    [quote, setQuote] = useState<QuoteContext | null>(null),
    [quoteMessage, setQuoteMessage] = useState("시세 공급자 연결 전"),
    [watch, setWatch] = useState(false);
  useEffect(() => {
    try {
      setWatch(
        (
          JSON.parse(
            localStorage.getItem("financialWatchlist") ?? "[]",
          ) as string[]
        ).includes(`${market}:${ticker}`),
      );
    } catch {
      setWatch(false);
    }
  }, [market, ticker]);
  useEffect(() => {
    if (demo) return;
    setSnapshot(cached(cacheKey));
    setQuote(null);
    setError("");
    setStale(true);
    if (!API) {
      setStatus("재무 서버 연결 전");
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    async function request(path: string, method = "GET") {
      const r = await fetch(API + path, { method, signal: controller.signal });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error ?? data.reason ?? `서버 응답 ${r.status}`);
      return data;
    }
    async function start() {
      try {
        setStatus("종목과 공시 발행인을 확인하고 있습니다.");
        const security = await request(
          `/v1/securities/resolve?exchange=${encodeURIComponent(market)}&ticker=${encodeURIComponent(ticker)}`,
        );
        if (!security.issuerId) {
          setStatus("이 시장·종목의 공시 연결은 아직 지원하지 않습니다.");
          return;
        }
        void request(
          `/v1/securities/${encodeURIComponent(security.securityId)}/quote`,
        )
          .then((q) => {
            if (
              typeof q.marketCap === "number" &&
              Number.isFinite(q.marketCap) &&
              q.marketCap > 0 &&
              typeof q.currency === "string" &&
              Number.isFinite(Date.parse(q.quoteAt)) &&
              ["realtime", "delayed", "close"].includes(q.delayClass)
            ) {
              setQuote({
                marketCap: q.marketCap,
                currency: q.currency,
                quoteAt: q.quoteAt,
                delayClass: q.delayClass,
                source: String(q.source),
              });
              setQuoteMessage(
                `${q.source} · ${q.quoteAt} · ${q.delayClass === "realtime" ? "실시간" : q.delayClass === "delayed" ? "지연 시세" : "종가"}`,
              );
            } else
              setQuoteMessage(
                "시가총액 또는 기준시각이 없어 가치평가 계산을 보류합니다.",
              );
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setQuoteMessage(
                "시세 공급자 미설정 또는 응답 없음 · PER/PBR 보류",
              );
          });
        const issuer = encodeURIComponent(security.issuerId);
        if (refresh > 0) await request(`/v1/issuers/${issuer}/refresh`, "POST");
        async function load() {
          try {
            const result = await request(`/v1/issuers/${issuer}/financials`);
            if (controller.signal.aborted) return;
            if (result.snapshot) {
              const parsed = SnapshotSchema.parse(result.snapshot);
              if (parsed.issuerId !== security.issuerId)
                throw new Error("공시 발행회사 식별자가 일치하지 않습니다.");
              setSnapshot(parsed);
              try {
                localStorage.setItem(cacheKey, JSON.stringify(parsed));
              } catch {
                setError(
                  "기기 저장 공간이 부족해 다음 방문의 오프라인 보관을 할 수 없습니다.",
                );
              }
            }
            setStale(result.isStale !== false);
            setChecked(result.sourceCheckedAt ?? null);
            setStatus(
              result.updateStatus === "ready"
                ? "공시 조회 완료"
                : result.updateStatus === "failed"
                  ? "공시 수집 실패"
                  : result.snapshot
                    ? "저장된 공시 표시 · 최신 공시 확인 중"
                    : "공시 수집 중",
            );
            if (result.error) setError(String(result.error));
            if (
              ["queued", "fetching"].includes(result.updateStatus) &&
              ++attempts < 24
            )
              timer = setTimeout(() => void load(), 5000);
          } catch (e) {
            if (!controller.signal.aborted) {
              setStatus("서버 연결 실패 · 보관본이 있으면 표시합니다.");
              setError(e instanceof Error ? e.message : "연결 실패");
            }
          }
        }
        await load();
      } catch (e) {
        if (!controller.signal.aborted) {
          setStatus("공시 연결 실패");
          setError(e instanceof Error ? e.message : "연결 실패");
        }
      }
    }
    void start();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [cacheKey, ticker, market, refresh, demo]);
  const data = demo ? teachingExample() : snapshot;
  const periods = data?.periods.filter((p) => p.kind === kind) ?? [];
  const period = periods.find((p) => p.id === periodId) ?? periods[0];
  const metrics =
    data && period
      ? analyzeFinancials(data, period, demo ? undefined : (quote ?? undefined))
      : null;
  function toggleWatch() {
    try {
      const ids = JSON.parse(
        localStorage.getItem("financialWatchlist") ?? "[]",
      ) as string[];
      const key = `${market}:${ticker}`;
      localStorage.setItem(
        "financialWatchlist",
        JSON.stringify(
          watch ? ids.filter((x) => x !== key) : [...new Set([...ids, key])],
        ),
      );
      setWatch(!watch);
    } catch {
      setError("관심 종목 저장 실패");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-sm underline">
          ← 종목 목록
        </Link>
        <Link
          className="rounded-lg border px-4 py-2"
          to={`/lab?stock=${encodeURIComponent(ticker)}`}
        >
          시뮬레이션 실험실 →
        </Link>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          FINANCIALS / 공시를 이해하는 12가지 질문
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          {demo ? "학습용 가상기업" : (data?.name ?? ticker)} 재무제표
        </h1>
        <p className="mt-2 text-muted-foreground">
          재무제표는 공시 시점에 갱신됩니다. 주가의 실시간 갱신과 구분해서
          읽으세요.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg border px-4 py-2" onClick={toggleWatch}>
          {watch ? "★ 재무 관심 해제" : "☆ 재무 관심 등록"}
        </button>
        <button
          className="rounded-lg border px-4 py-2"
          disabled={!API || demo}
          onClick={() => setRefresh((x) => x + 1)}
        >
          최신 공시 확인
        </button>
        <button
          className="rounded-lg border px-4 py-2"
          aria-pressed={demo}
          onClick={() => setDemo(!demo)}
        >
          {demo ? "실제 종목으로 돌아가기" : "가상기업으로 읽는 법 체험"}
        </button>
      </div>
      {demo ? (
        <div
          role="status"
          className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950"
        >
          <strong>학습용 가상 데이터입니다.</strong> 실제 {ticker}의
          재무제표·시세가 아닙니다. 공시 원문 근거가 없으며 투자 판단에 사용할
          수 없습니다.
        </div>
      ) : (
        <div className="rounded-xl border bg-muted/40 p-4">
          <strong>{status}</strong>
          {stale && snapshot && (
            <p>보관본입니다. 최신 공시와 다를 수 있습니다.</p>
          )}
          <p className="mt-2 text-sm">
            공시 확인 시각: {checked ?? "아직 확인하지 못함"}
            <br />
            시세: {quoteMessage}
          </p>
          {!API && (
            <p className="mt-3 text-sm">
              공시 서버가 아직 배포되지 않아 실제 재무제표를 가져올 수 없습니다.
              DART 인증키는 서버에만 보관하며, 연결이 준비되면 이 화면에서
              조회합니다. 기존 종목 요약 수치를 재무제표로 대신 표시하지
              않습니다.
            </p>
          )}
        </div>
      )}
      {error && !demo && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      {data && (
        <p className="break-all text-xs text-muted-foreground">
          {demo ? "예시 버전" : `${data.source} · 공시일 ${data.filedAt}`} ·
          재무 버전 {data.financialVersion}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label>
          기간 유형{" "}
          <select
            className="rounded border bg-background p-2"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPeriodId("");
            }}
          >
            <option value="ttm">최근 12개월 (TTM)</option>
            <option value="annual">연간</option>
            <option value="quarter">분기</option>
          </select>
        </label>
        <label>
          보고 기간{" "}
          <select
            className="rounded border bg-background p-2"
            value={period?.id ?? ""}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="" disabled>
              보고 기간 없음
            </option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.start} ~ {p.end}
              </option>
            ))}
          </select>
        </label>
      </div>
      {period && (
        <p className="text-sm">
          {period.scope === "consolidated" ? "연결" : "별도"} · 통화{" "}
          {period.currency} · 원 단위 / 달러 단위 (백만 단위 아님).{" "}
          {period.kind === "ttm"
            ? "손익·현금흐름은 4개 분기 합계, 재무상태는 마지막 분기말입니다."
            : ""}
        </p>
      )}
      {[...(data?.warnings ?? []), ...(period?.warnings ?? [])].map((w, i) => (
        <p key={i} className="text-sm text-amber-700">
          {w}
        </p>
      ))}
      <section>
        <h2 className="mb-3 text-xl font-semibold">핵심 질문</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {QUESTIONS.map(([id, area, question, formula]) => {
            const m = metrics?.find((x) => x.id === id);
            return (
              <article key={id} className="rounded-xl border p-5">
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>{area}</span>
                  <span>{m ? statusLabel[m.status] : "자료 연결 대기"}</span>
                </div>
                <h3 className="my-3 font-semibold">{question}</h3>
                <p className="mb-3 text-2xl font-bold">
                  {m?.value != null
                    ? `${fmt(m.unit === "%" ? m.value * 100 : m.value)} ${m.unit}`
                    : "—"}
                </p>
                <p className="text-sm leading-6">
                  {m?.explanation ??
                    "해당 기간 공시를 확보한 후 계산합니다. 자료가 없는 항목을 0으로 추정하지 않습니다."}
                </p>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer">
                    계산식 · 다음 확인 · 근거
                  </summary>
                  <p className="mt-2">{formula}</p>
                  {m && (
                    <>
                      <p className="mt-2">추가 확인: {m.nextCheck}</p>
                      {Object.entries(m.details).map(([k, v]) => (
                        <p key={k}>
                          {k}: {fmt(v)}
                        </p>
                      ))}
                      {m.sourceRefs.length ? (
                        m.sourceRefs.map((r, i) => (
                          <a
                            key={i}
                            className="mt-2 block break-all underline"
                            href={/^https:\/\//.test(r.url) ? r.url : undefined}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.filedAt} · {r.account} · {r.filingId}
                          </a>
                        ))
                      ) : (
                        <p className="mt-2">연결된 공시 원문 없음</p>
                      )}
                    </>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">3대 재무제표</h2>
        {(["income", "balance", "cash"] as const).map((statement, i) => (
          <details
            key={statement}
            className="mb-3 rounded-xl border p-4"
            open={i === 0}
          >
            <summary className="cursor-pointer font-semibold">
              {["손익계산서", "재무상태표", "현금흐름표"][i]}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">계정</th>
                    <th className="p-2 text-right">
                      {period?.currency ?? "금액"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ACCOUNTS)
                    .filter(([, m]) => m.statement === statement)
                    .map(([key, m]) => (
                      <tr key={key} className="border-b">
                        <th className="p-2 font-normal">{m.label}</th>
                        <td className="p-2 text-right tabular-nums">
                          {fmt(period?.values[key])}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </section>
      <p className="pb-8 text-sm text-muted-foreground">
        현재 해석은 공개된 계산 규칙입니다. 부도 확률·TAM·주석 기반 일회성
        조정·AI 추론은 근거 자료와 검증이 준비될 때 확장합니다.
      </p>
    </div>
  );
}
