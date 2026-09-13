import Decimal from "decimal.js";
import { canonicalHash } from "@stock/simulation-core";
import {
  ACCOUNTS,
  makeTTM,
  validateBalance,
  type FinancialSnapshot,
  type FinancialPeriod,
  type SourceRef,
} from "@stock/financial-analysis";
export type Security = {
  securityId: string;
  issuerId: string | null;
  ticker: string;
  exchange: string;
  name: string;
  support: "supported" | "unsupported" | "identifier-unresolved";
  reason?: string;
};
const CIKS: Record<string, string> = {
  NVDA: "0001045810",
  MSFT: "0000789019",
  GOOGL: "0001652044",
  GOOG: "0001652044",
  AMZN: "0001018724",
  META: "0001326801",
  TSLA: "0001318605",
  PLTR: "0001321655",
  RKLB: "0001819994",
  ASTS: "0001780312",
  AAPL: "0000320193",
  LUNR: "0001844452",
};
const KR: Record<string, string> = { "005930": "00126380" };
let catalog: Record<
  string,
  { cik_str: number; ticker: string; title: string }
> | null = null;
const UA =
  process.env.SEC_USER_AGENT ||
  "StockLab/1.0 (https://github.com/NULMARU/stock)";
let nextRequest = 0;
export async function providerJson(
  url: string,
  provider: "SEC" | "DART",
): Promise<unknown> {
  // Single collector + spacing stays below public EDGAR limits; concurrent server processes need a shared collector.
  const pause = Math.max(0, nextRequest - Date.now());
  nextRequest = Date.now() + pause + 250;
  if (pause) await new Promise((r) => setTimeout(r, pause));
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers:
        provider === "SEC"
          ? { "User-Agent": UA, Accept: "application/json" }
          : { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return response.json();
    if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${provider} HTTP ${response.status}`);
  }
  throw new Error("Provider unavailable");
}
export async function resolveSecurity(
  exchange: string,
  ticker: string,
): Promise<Security> {
  exchange = exchange.toUpperCase();
  ticker = ticker.toUpperCase();
  if (
    !/^[A-Z0-9.^-]{1,20}$/.test(ticker) ||
    !["US", "NASDAQ", "NYSE", "KR", "KRX", "CN", "HK", "SSE", "SZSE"].includes(
      exchange,
    )
  )
    throw new Error("Invalid security");
  const base = {
    securityId: `${exchange}:${ticker}`,
    ticker,
    exchange,
    name: ticker,
  };
  if (
    ["CN", "HK", "SSE", "SZSE"].includes(exchange) ||
    /\.(HK|SS|SZ)$/.test(ticker)
  )
    return {
      ...base,
      issuerId: null,
      support: "unsupported",
      reason: "중국·홍콩 공시 자동 정규화는 아직 지원하지 않습니다.",
    };
  if (["KR", "KRX"].includes(exchange) || /\.(KS|KQ)$/.test(ticker)) {
    const code = ticker.split(".")[0]!,
      corp = KR[code];
    return {
      ...base,
      issuerId: corp ? "dart:" + corp : null,
      support: corp ? "supported" : "identifier-unresolved",
      reason: corp
        ? undefined
        : "DART 회사 코드 등록이 필요합니다. 삼성전자 연결 공시부터 검증합니다.",
    };
  }
  let cik = CIKS[ticker],
    name = ticker;
  if (!cik) {
    try {
      catalog ??= (await providerJson(
        "https://www.sec.gov/files/company_tickers.json",
        "SEC",
      )) as typeof catalog;
      const entry = Object.values(catalog ?? {}).find(
        (x) => x.ticker === ticker,
      );
      if (entry) {
        cik = String(entry.cik_str).padStart(10, "0");
        name = entry.title;
      }
    } catch {
      return {
        ...base,
        issuerId: null,
        support: "identifier-unresolved",
        reason: "SEC 회사 목록 확인 실패. 잠시 후 다시 확인해 주세요.",
      };
    }
  }
  return {
    ...base,
    name,
    issuerId: cik ? "sec:" + cik : null,
    support: cik ? "supported" : "identifier-unresolved",
    reason: cik ? undefined : "확인된 SEC 발행회사 식별자가 없습니다.",
  };
}
export type Fact = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  filed: string;
  form: string;
  fy?: number;
  fp?: string;
  frame?: string;
};
export type CompanyFacts = {
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, Fact[]> }>>;
};
const SEC_TAGS: Record<string, string[]> = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["ProfitLoss"],
  commonNetIncome: ["NetIncomeLossAvailableToCommonStockholdersBasic"],
  interestExpense: ["InterestExpenseNonOperating", "InterestExpense"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  equity: [
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "StockholdersEquity",
  ],
  parentEquity: ["StockholdersEquity"],
  parentNetIncome: ["NetIncomeLoss"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  inventory: ["InventoryNet"],
  receivables: ["AccountsReceivableNetCurrent"],
  payables: ["AccountsPayableCurrent"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities"],
  icf: ["NetCashProvidedByUsedInInvestingActivities"],
  financingCF: ["NetCashProvidedByUsedInFinancingActivities"],
  capexPPE: ["PaymentsToAcquirePropertyPlantAndEquipment"],
  capexIntangibles: ["PaymentsToAcquireIntangibleAssets"],
  dividends: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  debtRepayment: ["RepaymentsOfLongTermDebt"],
};
const day = (date: string) => Date.parse(date) / 86400000;
const source = (issuer: string, tag: string, f: Fact): SourceRef => ({
  url: `https://www.sec.gov/Archives/edgar/data/${Number(issuer.split(":")[1])}/${f.accn.replaceAll("-", "")}/${f.accn}-index.html`,
  filingId: f.accn,
  filedAt: f.filed,
  account: tag,
  reportedValue: String(f.val),
});
export function normalizeSEC(
  issuer: string,
  data: CompanyFacts,
  asOf: string,
): FinancialSnapshot {
  const all: Record<string, { fact: Fact; tag: string; currency: string }[]> =
    {};
  for (const [key, tags] of Object.entries(SEC_TAGS))
    for (const tag of tags) {
      const item = data.facts["us-gaap"]?.[tag];
      for (const [currency, facts] of Object.entries(item?.units ?? {}))
        if (/^[A-Z]{3}$/.test(currency))
          for (const fact of facts)
            if (
              Number.isFinite(fact.val) &&
              ["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "20-F/A"].includes(
                fact.form,
              ) &&
              fact.filed <= asOf.slice(0, 10)
            )
              (all[key] ??= []).push({ fact, tag, currency });
    }
  const intervals = new Map<
    string,
    { start: string; end: string; kind: "annual" | "quarter"; currency: string }
  >();
  for (const { fact: f, currency } of [
    ...(all.revenue ?? []),
    ...(all.ocf ?? []),
  ])
    if (f.start) {
      const length = day(f.end) - day(f.start) + 1;
      const kind =
        length >= 300 && length <= 380
          ? "annual"
          : length >= 60 && length <= 110
            ? "quarter"
            : null;
      if (kind)
        intervals.set(`${kind}:${f.start}:${f.end}:${currency}`, {
          start: f.start,
          end: f.end,
          kind,
          currency,
        });
    }
  // Derive quarterly boundaries from standard flow end dates within each fiscal year.
  for (const { fact: f, currency } of all.ocf ?? [])
    if (f.start) {
      const length = day(f.end) - day(f.start) + 1;
      if (length > 110 && length <= 380) {
        const before = (all.ocf ?? [])
          .filter(
            (x) =>
              x.currency === currency &&
              x.fact.start === f.start &&
              x.fact.end < f.end &&
              day(f.end) - day(x.fact.end) >= 60 &&
              day(f.end) - day(x.fact.end) <= 110,
          )
          .sort((a, b) => b.fact.end.localeCompare(a.fact.end))[0];
        if (before) {
          const start = new Date((day(before.fact.end) + 1) * 86400000)
            .toISOString()
            .slice(0, 10);
          intervals.set(`quarter:${start}:${f.end}:${currency}`, {
            start,
            end: f.end,
            kind: "quarter",
            currency,
          });
        }
      }
    }
  const periods: FinancialPeriod[] = [];
  for (const [id, interval] of intervals) {
    const p: FinancialPeriod = {
      id,
      ...interval,
      scope: "consolidated",
      values: {},
      sources: {},
      warnings: [],
    };
    for (const [key, tags] of Object.entries(SEC_TAGS)) {
      const balance =
        ACCOUNTS[key]?.statement === "balance" || key === "parentEquity";
      const candidates = (all[key] ?? [])
        .filter(
          (x) =>
            x.currency === p.currency &&
            x.fact.end === p.end &&
            (balance ? !x.fact.start : x.fact.start === p.start),
        )
        .sort(
          (a, b) =>
            b.fact.filed.localeCompare(a.fact.filed) ||
            tags.indexOf(a.tag) - tags.indexOf(b.tag),
        );
      let selected = candidates[0];
      if (selected) {
        p.values[key] = selected.fact.val;
        p.sources[key] = [source(issuer, selected.tag, selected.fact)];
        continue;
      }
      if (!balance && p.kind === "quarter") {
        const cumulative = (all[key] ?? [])
          .filter(
            (x) =>
              x.currency === p.currency &&
              x.fact.end === p.end &&
              x.fact.start &&
              x.fact.start < p.start,
          )
          .sort((a, b) => b.fact.filed.localeCompare(a.fact.filed));
        for (const current of cumulative) {
          const prev = (all[key] ?? [])
            .filter(
              (x) =>
                x.currency === p.currency &&
                x.tag === current.tag &&
                x.fact.start === current.fact.start &&
                day(p.start) - day(x.fact.end) === 1,
            )
            .sort((a, b) => b.fact.filed.localeCompare(a.fact.filed))[0];
          if (prev) {
            p.values[key] = new Decimal(current.fact.val)
              .minus(prev.fact.val)
              .toNumber();
            p.sources[key] = [
              source(issuer, current.tag, current.fact),
              source(issuer, prev.tag, prev.fact),
            ];
            p.warnings.push(
              `${key}: 같은 회계연도 누적값 차감, 각 원문 정정 기준 확인 필요`,
            );
            selected = current;
            break;
          }
        }
      }
      if (!selected) p.values[key] = null;
    }
    p.warnings.push(...validateBalance(p));
    periods.push(p);
  }
  const currency = periods.sort((a, b) => b.end.localeCompare(a.end))[0]
    ?.currency;
  const retained = periods
    .filter((p) => p.currency === currency)
    .sort((a, b) => b.end.localeCompare(a.end));
  const annual = retained.filter((p) => p.kind === "annual").slice(0, 6),
    quarter = retained.filter((p) => p.kind === "quarter").slice(0, 9),
    ttm = makeTTM(quarter);
  const selected = [...annual, ...quarter, ...(ttm ? [ttm] : [])].sort((a, b) =>
    b.end.localeCompare(a.end),
  );
  const refs = selected
    .flatMap((p) => Object.values(p.sources).flat())
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  if (!selected.length)
    throw new Error(
      "지원하는 표준 US-GAAP 기간 자료가 없습니다. IFRS/회사 고유 태그는 원문 확인이 필요합니다.",
    );
  const payload = { issuerId: issuer, periods: selected };
  return {
    schemaVersion: 1,
    issuerId: issuer,
    name: data.entityName,
    industry: "general",
    source: "SEC",
    financialVersion: canonicalHash(payload),
    filedAt: refs[0]?.filedAt ?? "",
    latestKnownFilingId: refs[0]?.filingId ?? "",
    fetchedAt: asOf,
    periods: selected,
    warnings: [
      "SEC 표준 회사 전체 태그만 사용합니다. 주석·세그먼트·회사 고유 태그는 자동 추정하지 않습니다.",
      "CAPEX 중 무형자산 취득액 미공시 시 FCF 계산을 보류합니다.",
    ],
  };
}
export async function collectSEC(issuer: string): Promise<FinancialSnapshot> {
  const cik = issuer.slice(4);
  if (!/^\d{10}$/.test(cik)) throw new Error("Invalid CIK");
  const submission = (await providerJson(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    "SEC",
  )) as {
    sicDescription?: string;
    filings: {
      recent: {
        form: string[];
        accessionNumber: string[];
        filingDate: string[];
      };
    };
  };
  const data = (await providerJson(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    "SEC",
  )) as CompanyFacts;
  const snap = normalizeSEC(issuer, data, new Date().toISOString());
  snap.industry = submission.sicDescription ?? "unknown";
  snap.financialVersion = canonicalHash({
    issuerId: issuer,
    periods: snap.periods,
    industry: snap.industry,
  });
  const latest = submission.filings.recent.form.findIndex((f) =>
    ["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "20-F/A"].includes(f),
  );
  if (latest >= 0) {
    const id = submission.filings.recent.accessionNumber[latest]!;
    if (
      !snap.periods.some((p) =>
        Object.values(p.sources)
          .flat()
          .some((r) => r.filingId === id),
      )
    )
      throw new Error(
        "공시 확인 완료, 해당 공시의 XBRL 자료 대기 중. 재시도합니다.",
      );
    snap.latestKnownFilingId = id;
  }
  return snap;
}
const DART_TAGS: Record<string, string[]> = {
  revenue: ["ifrs-full_Revenue"],
  costOfRevenue: ["ifrs-full_CostOfSales"],
  operatingIncome: ["dart_OperatingIncomeLoss"],
  netIncome: ["ifrs-full_ProfitLoss"],
  parentNetIncome: ["ifrs-full_ProfitLossAttributableToOwnersOfParent"],
  parentEquity: ["ifrs-full_EquityAttributableToOwnersOfParent"],
  interestExpense: ["ifrs-full_FinanceCosts"],
  assets: ["ifrs-full_Assets"],
  liabilities: ["ifrs-full_Liabilities"],
  equity: ["ifrs-full_Equity"],
  currentAssets: ["ifrs-full_CurrentAssets"],
  currentLiabilities: ["ifrs-full_CurrentLiabilities"],
  cash: ["ifrs-full_CashAndCashEquivalents"],
  inventory: ["ifrs-full_Inventories"],
  receivables: ["ifrs-full_TradeAndOtherCurrentReceivables"],
  ocf: ["ifrs-full_CashFlowsFromUsedInOperatingActivities"],
  icf: ["ifrs-full_CashFlowsFromUsedInInvestingActivities"],
  financingCF: ["ifrs-full_CashFlowsFromUsedInFinancingActivities"],
  capexPPE: [
    "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
  ],
  capexIntangibles: [
    "ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities",
  ],
};
export type DartRow = {
  account_id: string;
  account_nm: string;
  sj_div: string;
  thstrm_amount: string;
  thstrm_add_amount?: string;
  currency?: string;
  rcept_no: string;
};
export function normalizeDART(
  rows: DartRow[],
  year: number,
  code: string,
  issuer: string,
  filings: Record<string, string>,
): FinancialPeriod {
  const quarter =
    code === "11013" ? 1 : code === "11012" ? 2 : code === "11014" ? 3 : 4;
  const end = `${year}-${["03-31", "06-30", "09-30", "12-31"][quarter - 1]}`,
    p: FinancialPeriod = {
      id: `${year}:${code}`,
      kind: quarter === 4 ? "annual" : "quarter",
      start: `${year}-${["01-01", "04-01", "07-01", "01-01"][quarter - 1]}`,
      end,
      currency: "KRW",
      scope: "consolidated",
      values: {},
      sources: {},
      warnings: [],
    };
  for (const [key, tags] of Object.entries(DART_TAGS)) {
    const r = rows.find((r) => tags.includes(r.account_id));
    const raw = r?.thstrm_amount?.replaceAll(",", "").trim();
    if (!r || !raw || !/^[-+]?\d+(\.\d+)?$/.test(raw)) {
      p.values[key] = null;
      continue;
    }
    const currency = r.currency || "KRW";
    if (currency !== "KRW") throw new Error("DART 보고 통화가 KRW가 아닙니다.");
    // Cash-flow rows are cumulative; retain as cumulative for later differencing.
    p.values[key] = new Decimal(raw).toNumber();
    p.sources[key] = [
      {
        url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`,
        filingId: r.rcept_no,
        filedAt: filings[r.rcept_no] ?? "",
        account: r.account_id,
        reportedValue: raw,
      },
    ];
    if (quarter < 4 && ACCOUNTS[key]?.statement === "income") {
      const cum = r.thstrm_add_amount?.replaceAll(",", "").trim();
      if (cum && /^[-+]?\d+(\.\d+)?$/.test(cum)) {
        p.values["cumulative:" + key] = new Decimal(cum).toNumber();
        p.sources["cumulative:" + key] = [
          { ...p.sources[key]![0]!, reportedValue: cum },
        ];
      }
    }
  }
  if (quarter < 4)
    p.warnings.push("DART 손익은 단일 분기, 현금흐름은 누적값 차감 후 게시");
  // Finance costs and trade+other receivables are broader than requested metrics.
  p.values.interestExpense = null;
  p.values.receivables = null;
  return p;
}
export async function collectDART(issuer: string): Promise<FinancialSnapshot> {
  if (!process.env.DART_API_KEY) throw new Error("DART_API_KEY 미설정");
  const corp = issuer.slice(5);
  if (!/^\d{8}$/.test(corp)) throw new Error("Invalid corp code");
  const base = "https://opendart.fss.or.kr/api/",
    auth = `crtfc_key=${encodeURIComponent(process.env.DART_API_KEY)}&corp_code=${corp}`;
  const periods: FinancialPeriod[] = [],
    filings: Record<string, string> = {};
  let name = corp;
  for (let page = 1; page <= 20; page++) {
    const response = (await providerJson(
      `${base}list.json?${auth}&bgn_de=${new Date().getFullYear() - 6}0101&pblntf_ty=A&page_count=100&page_no=${page}`,
      "DART",
    )) as {
      status: string;
      total_page: number;
      list?: { rcept_no: string; rcept_dt: string; corp_name: string }[];
    };
    if (response.status === "013") break;
    if (response.status !== "000")
      throw new Error("DART 공시검색 상태 " + response.status);
    for (const row of response.list ?? []) {
      filings[row.rcept_no] = row.rcept_dt.replace(
        /(\d{4})(\d{2})(\d{2})/,
        "$1-$2-$3",
      );
      name = row.corp_name;
    }
    if (page >= response.total_page) break;
    if (page === 20) throw new Error("DART 공시 페이지 한도 초과");
  }
  const year = new Date().getFullYear();
  for (let y = year - 5; y <= year; y++) {
    const yearPeriods: FinancialPeriod[] = [];
    for (const code of ["11013", "11012", "11014", "11011"]) {
      const response = (await providerJson(
        `${base}fnlttSinglAcntAll.json?${auth}&bsns_year=${y}&reprt_code=${code}&fs_div=CFS`,
        "DART",
      )) as { status: string; list?: DartRow[] };
      if (response.status === "013") continue;
      if (response.status !== "000")
        throw new Error("DART 재무 상태 " + response.status);
      yearPeriods.push(
        normalizeDART(response.list ?? [], y, code, issuer, filings),
      );
    }
    const cumulative = yearPeriods.map(
      (p) => JSON.parse(JSON.stringify(p)) as FinancialPeriod,
    );
    for (const p of yearPeriods) {
      const index = Number(p.end.slice(5, 7)) / 3 - 1,
        previous = cumulative.find(
          (q) => Number(q.end.slice(5, 7)) / 3 === index,
        );
      if (index > 0 && p.kind === "quarter")
        for (const [key, meta] of Object.entries(ACCOUNTS))
          if (meta.statement === "cash") {
            const old = previous?.values[key];
            p.values[key] =
              p.values[key] != null && old != null
                ? new Decimal(p.values[key]!).minus(old).toNumber()
                : null;
            p.sources[key] = [
              ...(p.sources[key] ?? []),
              ...(previous?.sources[key] ?? []),
            ];
          }
      if (p.kind === "annual" && previous) {
        const q: FinancialPeriod = {
          ...p,
          id: `${y}:Q4`,
          kind: "quarter",
          start: `${y}-10-01`,
          values: { ...p.values },
          sources: { ...p.sources },
          warnings: [
            "연간−9개월 누적값으로 Q4 변환. 동일 계정 누적 근거가 없으면 보류.",
          ],
        };
        for (const [key, meta] of Object.entries(ACCOUNTS)) {
          if (meta.statement === "income") {
            const prev = previous.values["cumulative:" + key];
            q.values[key] =
              p.values[key] != null && prev != null
                ? new Decimal(p.values[key]!).minus(prev).toNumber()
                : null;
            q.sources[key] = [
              ...(p.sources[key] ?? []),
              ...(previous.sources["cumulative:" + key] ?? []),
            ];
          }
          if (meta.statement === "cash") {
            q.values[key] =
              p.values[key] != null && previous.values[key] != null
                ? new Decimal(p.values[key]!)
                    .minus(previous.values[key]!)
                    .toNumber()
                : null;
            q.sources[key] = [
              ...(p.sources[key] ?? []),
              ...(previous.sources[key] ?? []),
            ];
          }
        }
        periods.push(q);
      }
      p.warnings.push(...validateBalance(p));
      periods.push(p);
    }
  }
  if (!periods.length) throw new Error("DART 연결 재무 자료 없음");
  const sorted = periods.sort((a, b) => b.end.localeCompare(a.end));
  const selected = [
      ...sorted.filter((p) => p.kind === "annual").slice(0, 6),
      ...sorted.filter((p) => p.kind === "quarter").slice(0, 9),
    ],
    ttm = makeTTM(selected);
  if (ttm) selected.push(ttm);
  const refs = selected
    .flatMap((p) => Object.values(p.sources).flat())
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  return {
    schemaVersion: 1,
    issuerId: issuer,
    name,
    industry: "general",
    source: "DART",
    financialVersion: canonicalHash(selected),
    filedAt: refs[0]?.filedAt ?? "",
    latestKnownFilingId: refs[0]?.filingId ?? "",
    fetchedAt: new Date().toISOString(),
    periods: selected,
    warnings: [
      "표준 연결 계정만 정규화합니다. 회사 고유 계정·주석은 원문을 확인하세요.",
      "현재 DART 어댑터는 12월 결산 법인만 지원합니다.",
    ],
  };
}
