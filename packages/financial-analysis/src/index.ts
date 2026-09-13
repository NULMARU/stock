import { z } from "zod";
import Decimal from "decimal.js";
export const SourceSchema = z.object({
  url: z.string().url(),
  filingId: z.string(),
  filedAt: z.string(),
  account: z.string(),
  reportedValue: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceSchema>;
export const PeriodSchema = z.object({
  id: z.string(),
  kind: z.enum(["annual", "quarter", "ttm"]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string(),
  scope: z.enum(["consolidated", "separate"]),
  values: z.record(z.string(), z.number().finite().nullable()),
  sources: z.record(z.string(), z.array(SourceSchema)),
  warnings: z.array(z.string()).default([]),
});
export type FinancialPeriod = z.infer<typeof PeriodSchema>;
export const SnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  issuerId: z.string(),
  name: z.string(),
  industry: z.string(),
  financialVersion: z.string(),
  filedAt: z.string(),
  latestKnownFilingId: z.string(),
  fetchedAt: z.string(),
  periods: z.array(PeriodSchema),
  source: z.enum(["SEC", "DART"]),
  warnings: z.array(z.string()),
});
export type FinancialSnapshot = z.infer<typeof SnapshotSchema>;
export const ACCOUNTS: Record<
  string,
  { label: string; statement: "income" | "balance" | "cash" }
> = {
  parentNetIncome: { label: "지배기업 귀속 순이익", statement: "income" },
  parentEquity: { label: "지배기업 귀속 자본", statement: "balance" },
  commonNetIncome: { label: "보통주 귀속 순이익", statement: "income" },
  commonEquity: { label: "보통주 귀속 자본", statement: "balance" },
  revenue: { label: "매출", statement: "income" },
  costOfRevenue: { label: "매출원가", statement: "income" },
  operatingIncome: { label: "영업이익", statement: "income" },
  netIncome: { label: "순이익 (연결 전체)", statement: "income" },
  interestExpense: { label: "이자비용", statement: "income" },
  assets: { label: "자산총계", statement: "balance" },
  liabilities: { label: "부채총계", statement: "balance" },
  equity: { label: "자본총계 (연결 전체)", statement: "balance" },
  currentAssets: { label: "유동자산", statement: "balance" },
  currentLiabilities: { label: "유동부채", statement: "balance" },
  cash: { label: "현금 및 현금성자산", statement: "balance" },
  inventory: { label: "재고자산", statement: "balance" },
  receivables: { label: "매출채권", statement: "balance" },
  payables: { label: "매입채무", statement: "balance" },
  debt: { label: "이자부 차입금", statement: "balance" },
  ocf: { label: "영업현금흐름", statement: "cash" },
  icf: { label: "투자현금흐름", statement: "cash" },
  financingCF: { label: "재무현금흐름", statement: "cash" },
  capexPPE: { label: "현금 유형자산 취득", statement: "cash" },
  capexIntangibles: { label: "현금 무형자산 취득", statement: "cash" },
  dividends: { label: "배당 지급", statement: "cash" },
  buybacks: { label: "자사주 취득", statement: "cash" },
  debtRepayment: { label: "차입금 상환", statement: "cash" },
};
export const QUESTIONS = [
  ["FS01", "안정성", "빚과 이자를 감당할 수 있나요?", "부채총계 ÷ 자본총계"],
  ["FS02", "안정성", "단기 지급능력은 어떤가요?", "유동자산 ÷ 유동부채"],
  ["FS03", "수익성", "이익을 꾸준히 벌고 있나요?", "영업이익 ÷ 매출"],
  ["FS04", "수익성", "자본을 효율적으로 쓰고 있나요?", "순이익 ÷ 평균자본"],
  [
    "FS05",
    "성장성",
    "매출 성장이 이어지고 있나요?",
    "매출 ÷ 전년 같은 기간 매출 − 1",
  ],
  [
    "FS06",
    "성장성",
    "투자가 성과로 돌아오나요?",
    "자산 ÷ 전년 같은 시점 자산 − 1",
  ],
  [
    "FS07",
    "현금흐름",
    "장부상 이익이 현금으로 들어오나요?",
    "영업현금흐름 ÷ 순이익",
  ],
  [
    "FS08",
    "현금흐름",
    "주주환원 여력은 어떤가요?",
    "영업현금흐름 − 현금 유형·무형 CAPEX",
  ],
  [
    "FS09",
    "가치평가",
    "지금 가격에 어떤 기대가 담겼나요?",
    "시가총액 ÷ 최근 12개월 보통주 귀속 순이익",
  ],
  [
    "FS10",
    "가치평가",
    "장부가와 시장가격의 차이는요?",
    "시가총액 ÷ 보통주 자본",
  ],
  ["FS11", "리스크", "재고에 돈이 오래 묶이나요?", "매출원가 ÷ 평균재고"],
  [
    "FS12",
    "리스크",
    "판매한 돈을 잘 회수하나요?",
    "신용매출 (없으면 총매출 근사) ÷ 평균매출채권",
  ],
] as const;
export type Metric = {
  id: string;
  area: string;
  question: string;
  formula: string;
  status: "ready" | "missing" | "not-applicable" | "invalid";
  value: number | null;
  unit: string;
  explanation: string;
  nextCheck: string;
  sourceRefs: SourceRef[];
  details: Record<string, number>;
};
export type QuoteContext = {
  marketCap: number;
  currency: string;
  quoteAt: string;
  delayClass: "realtime" | "delayed" | "close";
  source: string;
};
export function exactSum(values: number[]): number {
  return new Decimal(
    values.reduce((a, v) => new Decimal(a).plus(v).toString(), "0"),
  ).toNumber();
}
const ratio = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && b > 0 ? a / b : null;
const days = (p: FinancialPeriod) =>
  Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1;
const compatible = (a: FinancialPeriod, b: FinancialPeriod) =>
  a.scope === b.scope && a.currency === b.currency;
export function analyzeFinancials(
  snapshot: FinancialSnapshot,
  p: FinancialPeriod,
  quote?: QuoteContext,
): Metric[] {
  const v = p.values,
    begin = snapshot.periods.find(
      (q) =>
        compatible(p, q) &&
        Math.abs(Date.parse(p.start) - Date.parse(q.end) - 86400000) < 1,
    ),
    prior = snapshot.periods.find(
      (q) =>
        q.kind === p.kind &&
        compatible(p, q) &&
        Math.abs(days(p) - days(q)) <= 8 &&
        Math.abs(Date.parse(p.end) - Date.parse(q.end) - 365 * 86400000) <
          8 * 86400000,
    );
  const average = (key: string) =>
    begin?.values[key] != null && v[key] != null
      ? exactSum([begin.values[key]!, v[key]!]) / 2
      : null;
  const get = (key: string) => v[key] ?? null;
  const parent = v.parentNetIncome != null && v.parentEquity != null;
  const roeIncome = parent ? v.parentNetIncome : get("netIncome");
  const equityKey = parent ? "parentEquity" : "equity";
  const avgEquity = average(equityKey),
    avgAssets = average("assets"),
    avgInv = average("inventory"),
    avgAR = average("receivables");
  const capex =
    v.capexPPE != null && v.capexIntangibles != null
      ? exactSum([v.capexPPE, v.capexIntangibles])
      : null;
  const values = [
    ratio(get("liabilities"), get("equity")),
    ratio(get("currentAssets"), get("currentLiabilities")),
    ratio(get("operatingIncome"), get("revenue")),
    ratio(roeIncome, avgEquity),
    prior?.values.revenue != null &&
    prior.values.revenue > 0 &&
    v.revenue != null
      ? v.revenue / prior.values.revenue - 1
      : null,
    prior?.values.assets != null && prior.values.assets > 0 && v.assets != null
      ? v.assets / prior.values.assets - 1
      : null,
    v.netIncome != null && v.netIncome > 0
      ? ratio(get("ocf"), get("netIncome"))
      : null,
    v.ocf != null && capex != null ? exactSum([v.ocf, -capex]) : null,
    quote &&
    quote.currency === p.currency &&
    (p.kind === "annual" || p.kind === "ttm")
      ? ratio(quote.marketCap, get("commonNetIncome"))
      : null,
    quote && quote.currency === p.currency
      ? ratio(quote.marketCap, get("commonEquity"))
      : null,
    ratio(get("costOfRevenue"), avgInv),
    ratio(get("creditRevenue") ?? get("revenue"), avgAR),
  ];
  const notes = [
    "부채비율만으로 부도 가능성을 판정할 수 없습니다. 만기와 이자 부담을 함께 봅니다.",
    "유동자산에는 재고와 미회수 채권이 포함됩니다. 현금과 같은 의미는 아닙니다.",
    "보고 영업이익률입니다. 일회성 손익을 제거한 이익은 주석 근거가 필요합니다.",
    "지배기업 귀속 이익·자본이 모두 있으면 그 기준의 평균자본을 사용하고, 없으면 연결 전체 기준을 사용합니다. 자사주 매입과 차입 증가의 영향도 확인하세요.",
    "전년 같은 길이의 기간과 비교합니다. 인수·환율 효과를 분리한 유기적 성장률은 아닙니다.",
    "자산 증가 자체가 가치 창출을 뜻하지 않습니다. ROIC·WACC는 세율·투하자본 정책과 자본비용 자료가 필요합니다.",
    "양의 순이익에 대해서만 계산합니다. 재고·채권 증가와 비현금 손익을 함께 확인하세요.",
    "유형·무형자산 현금 취득액을 차감합니다. M&A 지출과 투자현금흐름 전체를 CAPEX로 취급하지 않습니다.",
    "주가 기준시각과 재무 기간이 다릅니다. 적자·통화 불일치·분기 단독 이익은 PER 계산을 보류합니다.",
    "보통주 장부자본과 시가총액의 통화·귀속이 일치해야 합니다. 낮은 PBR이 곧 저평가를 뜻하지 않습니다.",
    "매출원가와 평균재고를 사용합니다. 재고 구성·평가손실·계절성을 확인하세요.",
    "신용매출 미공시 시 총매출 기준 근사입니다. 회수일수 증가만으로 회계부정을 판단하지 않습니다.",
  ];
  const checks = [
    "차입 만기·담보·약정·이자비용 주석",
    "제한 현금·미사용 신용한도·12개월 상환액",
    "구조조정·손상·일회성 손익",
    "자본변동표·자사주 거래·듀폰 분해",
    "고객 집중·사업부 성장·수주·TAM 근거",
    "가동 시점·유지/성장 CAPEX·ROIC/WACC 가정",
    "현금흐름 조정표·매출채권 및 재고 변동",
    "배당·자사주 매입·필수 상환·유지 CAPEX",
    "유사 사업모델의 동종기업·성장 가정",
    "무형자산·영업권·손상·ROE 추세",
    "재고 연령·진부화·제품 수명",
    "연령별 채권·대손충당금·고객 집중",
  ];
  const keys = [
    ["liabilities", "equity", "operatingIncome", "interestExpense"],
    ["currentAssets", "currentLiabilities"],
    ["operatingIncome", "revenue"],
    [
      "netIncome",
      "equity",
      "parentNetIncome",
      "parentEquity",
      "assets",
      "revenue",
    ],
    ["revenue"],
    ["assets"],
    ["ocf", "netIncome"],
    ["ocf", "capexPPE", "capexIntangibles"],
    ["commonNetIncome"],
    ["commonEquity"],
    ["costOfRevenue", "inventory"],
    ["creditRevenue", "revenue", "receivables"],
  ];
  return QUESTIONS.map(([id, area, question, formula], i) => {
    let value = values[i] ?? null,
      status: Metric["status"] = value == null ? "missing" : "ready";
    if (
      (i === 0 && v.equity != null && v.equity <= 0) ||
      (i === 3 &&
        ((v[equityKey] != null && v[equityKey]! <= 0) ||
          (avgEquity != null && avgEquity <= 0))) ||
      (i === 6 && v.netIncome != null && v.netIncome <= 0)
    ) {
      status = "invalid";
      value = null;
    }
    if (
      /bank|insurance|reit|financial/i.test(snapshot.industry) &&
      [0, 1, 5, 7, 10, 11].includes(i)
    ) {
      status = "not-applicable";
      value = null;
    }
    if (validateBalance(p).length && [0, 1, 3, 5, 9, 10, 11].includes(i)) {
      status = "invalid";
      value = null;
    }
    const details: Record<string, number> = {};
    if (i === 0) {
      const x = ratio(v.operatingIncome, v.interestExpense);
      if (x != null) details["이자보상배율 (영업이익 근사)"] = x;
    }
    if (
      i === 3 &&
      avgAssets != null &&
      avgEquity != null &&
      avgEquity > 0 &&
      avgAssets > 0 &&
      v.revenue != null &&
      v.revenue > 0 &&
      roeIncome != null
    ) {
      details["순이익률"] = roeIncome / v.revenue;
      details["자산회전율"] = v.revenue / avgAssets;
      details["재무레버리지"] = avgAssets / avgEquity;
    }
    if (i === 10 && value != null && value > 0)
      details["재고 보유일수"] = days(p) / value;
    if (i === 11 && value != null && value > 0)
      details["매출 회수일수 (총매출 대용 가능)"] = days(p) / value;
    const refs = keys[i]!.flatMap((k) => [
      ...(p.sources[k] ?? []),
      ...(begin?.sources[k] ?? []),
      ...(prior?.sources[k] ?? []),
    ]);
    return {
      id,
      area,
      question,
      formula,
      status,
      value,
      unit: [0, 2, 3, 4, 5].includes(i) ? "%" : i === 7 ? p.currency : "배",
      explanation:
        (status === "missing"
          ? "계산에 필요한 자료가 부족합니다. "
          : status === "invalid"
            ? "분모 또는 재무상태 대사에 문제가 있어 일반 비율 해석을 보류합니다. "
            : status === "not-applicable"
              ? "해당 업종은 전용 분석이 필요합니다. "
              : "") + notes[i],
      nextCheck: checks[i]!,
      sourceRefs: refs.filter(
        (r, j, a) =>
          a.findIndex((x) => x.url === r.url && x.account === r.account) === j,
      ),
      details,
    };
  });
}
export function makeTTM(periods: FinancialPeriod[]): FinancialPeriod | null {
  const q = periods
    .filter((p) => p.kind === "quarter")
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-4);
  if (q.length !== 4) return null;
  for (let i = 1; i < 4; i++)
    if (
      !compatible(q[0]!, q[i]!) ||
      Date.parse(q[i]!.start) - Date.parse(q[i - 1]!.end) !== 86400000
    )
      return null;
  if (
    days({ ...q[0]!, end: q[3]!.end }) < 350 ||
    days({ ...q[0]!, end: q[3]!.end }) > 380
  )
    return null;
  const last = q[3]!,
    values: FinancialPeriod["values"] = {},
    sources: FinancialPeriod["sources"] = {};
  for (const [key, meta] of Object.entries(ACCOUNTS)) {
    values[key] =
      meta.statement === "balance"
        ? (last.values[key] ?? null)
        : q.every((p) => p.values[key] != null)
          ? exactSum(q.map((p) => p.values[key]!))
          : null;
    sources[key] =
      meta.statement === "balance"
        ? (last.sources[key] ?? [])
        : q.flatMap((p) => p.sources[key] ?? []);
  }
  return {
    ...last,
    id: "ttm-" + last.end,
    kind: "ttm",
    start: q[0]!.start,
    values,
    sources,
    warnings: ["최근 4개 연속 분기 합계; 잔액은 마지막 분기말"],
  };
}
export function validateBalance(p: FinancialPeriod): string[] {
  const { assets: a, liabilities: l, equity: e } = p.values;
  return a != null &&
    l != null &&
    e != null &&
    Math.abs(a - l - e) > Math.max(1, Math.abs(a) * 0.001)
    ? ["자산 = 부채 + 자본 대사 불일치"]
    : [];
}
