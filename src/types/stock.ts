/**
 * 스페이스AI 스톡랩 — 공유 타입 (spec.md §3·§6)
 * 데이터 생성: scripts/refresh_data.py (stocks.json), 수동 큐레이션 (glossary.json)
 */

export type Market = "US" | "KR" | "CN";
export type Currency = "USD" | "KRW" | "HKD" | "CNY";
export type BeginnerFit = "good" | "caution" | "hard";

export interface Quote {
  price: number | null;
  /** 등락률, 퍼센트 단위 (예: 1.23 = +1.23%) */
  changePct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketCap: number | null;
  volume: number;
}

/** 적자 기업은 PER/ROE가 null (spec §3) */
export interface Metrics {
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  /** 소수 단위 (예: 0.45 = 45%) */
  roe: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  /** 퍼센트 단위 (예: 50.5 = 50.5%) */
  debtToEquity: number | null;
  /** 소수 단위 (예: 0.25 = 25%) */
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  /** 소수 단위 (예: 0.005 = 0.5%) */
  dividendYield: number | null;
  beta: number | null;
  totalRevenue: number | null;
}

export interface ScoreCheck {
  label: string;
  pass: boolean;
  /** 판정 근거 — 지표값과 임계값 포함 (예: "PER 340배 vs 그룹 중앙값 25.1배") */
  detail: string;
}

/** 축당 0~5점 */
export interface AxisScore {
  score: number;
  checks: ScoreCheck[];
}

export interface Scores {
  valuation: AxisScore;
  growth: AxisScore;
  profitability: AxisScore;
  financialHealth: AxisScore;
  momentum: AxisScore;
  /** 0~25 */
  total: number;
}

export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  close: number;
}

/** market + theme[0] 그룹 내 중앙값 (비교 컨텍스트) */
export interface SectorAvg {
  pe: number | null;
  ps: number | null;
}

export interface StockEntry {
  /** Yahoo Finance 형식: "TSLA", "005930.KS", "9988.HK" */
  ticker: string;
  /** 한국어 표기 */
  name: string;
  nameEn: string;
  market: Market;
  currency: Currency;
  theme: string[];
  /** 한 줄 소개 (큐레이션) */
  description: string;
  beginnerFit: BeginnerFit;
  /** 밸류체인 위치 (예: "위성 부품") */
  valueChain?: string;
  /** 이 종목이 좋은 사례가 되는 용어 id 목록 (큐레이션) */
  exampleTermHints?: string[];
  quote: Quote;
  metrics: Metrics;
  scores: Scores;
  /** 자동 생성 한 줄 해석 3~5개 */
  insights: string[];
  /** 최근 1년, 주 1개 샘플링 (약 52포인트) */
  priceHistory: PricePoint[];
  sectorAvg: SectorAvg;
  /** 예: ["적자 기업", "고변동성", "중국 A주 조회 전용"] */
  riskFlags: string[];
  /** 기준일 YYYY-MM-DD */
  asOf: string;
  methodologyVersion: string;
}

/** 뉴스 항목 1건 (news.json — 하루 2회 자동 수집) */
export interface NewsItem {
  title: string;
  link: string;
  /** 언론사 (예: "Reuters") */
  source: string;
  /** ISO 8601 발행 시각 */
  publishedAt: string;
}

/** news.json 전체 구조 — entries 키는 티커 */
export interface NewsData {
  /** 데이터 기준 시각 (ISO 8601, 수집 전이면 빈 문자열) */
  asOf: string;
  entries: Record<string, NewsItem[]>;
}

/** 유니콘 평가 개별 체크 항목 */
export interface UnicornCheck {
  label: string;
  pass: boolean;
  /** 판정 근거 — 지표값과 임계값 포함 */
  detail: string;
}

/** 유니콘 3축 중 한 축 (밸류에이션 40 / 퀄리티 35 / 성장 25) */
export interface UnicornPillar {
  score: number;
  max: number;
  checks: UnicornCheck[];
}

export type UnicornGrade = "A" | "B" | "C";

/** 유니콘 평가 통과 종목 1건 (unicorns.json — 매주 토요일 갱신) */
export interface UnicornEntry {
  ticker: string;
  name: string;
  nameEn: string;
  market: Market;
  currency: Currency;
  theme: string[];
  description: string;
  /** 100점 만점 총점 */
  totalScore: number;
  grade: UnicornGrade;
  pillars: {
    valuation: UnicornPillar;
    quality: UnicornPillar;
    growth: UnicornPillar;
  };
  /** 주요 지표 (PER/PBR/PEG/ROE/부채비율/성장률 등), 값 없으면 null */
  metrics: Record<string, number | null>;
  quote: {
    price: number;
    changePct: number;
    marketCap: number;
  };
  /** 선정 이유 */
  reasons: string[];
  risks: string[];
  sourceNotes: string[];
}

/** unicorns.json 전체 구조 */
export interface UnicornData {
  /** 기준일 YYYY-MM-DD, 평가 전이면 빈 문자열 */
  asOf: string;
  methodologyVersion: string;
  /** 평가 대상 종목 수 */
  evaluated: number;
  passed: UnicornEntry[];
}

/** 사용자가 앱에서 직접 추가한 간이 종목 (localStorage 저장, 정식 데이터 아님) */
export interface UserAddedStock {
  /** Yahoo Finance 형식 권장: "TSLA", "005930.KS" */
  ticker: string;
  /** 한국어 표기 */
  name: string;
  market: Market;
  theme: string[];
  note?: string;
}

export type GlossaryGroup = "가치평가" | "실적재무" | "주주환원" | "시장수급";

export interface GlossaryTerm {
  id: string;
  /** 한국어 용어명 (예: "PER (주가수익비율)") */
  term: string;
  termEn: string;
  group: GlossaryGroup;
  /** 한 줄 정의 */
  definition: string;
  /** 초보자용 비유/예시 */
  analogy: string;
  /** '이 숫자가 높으면/낮으면' 해석 가이드 */
  interpretation: string;
  /** 흔한 오해 */
  misconception: string;
  /** 해당 지표가 흥미로운 종목 티커 (예: PER → "688256.SS") */
  exampleTicker?: string;
  sourceUrl: string;
}
