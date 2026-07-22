/**
 * 스페이스AI 스톡랩 — 환율 조회 유틸
 *
 * 무료 + CORS 허용 API 2단 폴백:
 * - 1차: frankfurter.app (ECB 기준 환율, 특정일 조회 가능 → 전일 대비 등락 계산)
 * - 2차: open.er-api.com (등락 정보 없음, 값만 표시)
 *
 * 60초 메모리 캐시로 반복 호출을 막는다.
 */

export interface ExchangeRateQuote {
  /** 통화 코드 (JPY는 100엔 기준으로 'JPY100' 사용) */
  code: 'USD' | 'JPY100' | 'CNY'
  /** 표시 라벨 (예: 'USD/KRW', 'JPY 100/KRW') */
  label: string
  /** 원화 환산 값 */
  krw: number
  /** 전일 대비 증감 (원화 기준). 조회 실패 시 null */
  change: number | null
  /** 전일 대비 등락률 (%). 조회 실패 시 null */
  changePct: number | null
}

export interface ExchangeRatesResult {
  quotes: ExchangeRateQuote[]
  /** 출처 표기 (예: 'ECB 기준') */
  source: string
  /** 조회 시각 (ms epoch) */
  fetchedAt: number
}

const CACHE_TTL_MS = 60_000
let cache: ExchangeRatesResult | null = null

interface FrankfurterResponse {
  rates?: Partial<Record<'KRW' | 'JPY' | 'CNY', number>>
}

interface ErApiResponse {
  rates?: Partial<Record<'KRW' | 'JPY' | 'CNY', number>>
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/** quotes 배열 조립 — rates: USD 기준 각 통화 값 */
function buildQuotes(
  current: Record<'KRW' | 'JPY' | 'CNY', number>,
  previous: Record<'KRW' | 'JPY' | 'CNY', number> | null,
): ExchangeRateQuote[] {
  const usdPrev = previous?.KRW ?? null
  // JPY는 100엔당 원화로 환산: (USD→KRW) / (USD→JPY) * 100
  const jpy100 = (current.KRW / current.JPY) * 100
  const jpy100Prev = previous ? (previous.KRW / previous.JPY) * 100 : null
  const cny = current.KRW / current.CNY
  const cnyPrev = previous ? previous.KRW / previous.CNY : null

  const make = (
    code: ExchangeRateQuote['code'],
    label: string,
    krw: number,
    prev: number | null,
  ): ExchangeRateQuote => {
    const change = prev !== null ? krw - prev : null
    const changePct = prev !== null && prev !== 0 ? ((krw - prev) / prev) * 100 : null
    return { code, label, krw, change, changePct }
  }

  return [
    make('USD', 'USD/KRW', current.KRW, usdPrev),
    make('JPY100', 'JPY 100/KRW', jpy100, jpy100Prev),
    make('CNY', 'CNY/KRW', cny, cnyPrev),
  ]
}

/** 어제 날짜 (로컬 기준) YYYY-MM-DD — frankfurter는 휴일이면 직전 영업일 데이터 반환 */
function yesterdayIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 1차: frankfurter.app — 전일 대비 등락 포함 */
async function fetchFromFrankfurter(): Promise<ExchangeRatesResult> {
  const latest = await fetchJson<FrankfurterResponse>(
    'https://api.frankfurter.app/latest?from=USD&to=KRW,JPY,CNY',
  )
  const r = latest.rates
  if (!r?.KRW || !r?.JPY || !r?.CNY) throw new Error('frankfurter 응답 누락')

  // 전일 대비 등락은 별도 특정일 쿼리 — 실패해도 값 표시는 유지
  let previous: Record<'KRW' | 'JPY' | 'CNY', number> | null = null
  try {
    const hist = await fetchJson<FrankfurterResponse>(
      `https://api.frankfurter.app/${yesterdayIso()}?from=USD&to=KRW,JPY,CNY`,
    )
    const h = hist.rates
    if (h?.KRW && h?.JPY && h?.CNY) {
      previous = { KRW: h.KRW, JPY: h.JPY, CNY: h.CNY }
    }
  } catch {
    previous = null
  }

  return {
    quotes: buildQuotes({ KRW: r.KRW, JPY: r.JPY, CNY: r.CNY }, previous),
    source: 'ECB 기준',
    fetchedAt: Date.now(),
  }
}

/** 2차: open.er-api.com — 등락 정보 없이 현재 값만 */
async function fetchFromErApi(): Promise<ExchangeRatesResult> {
  const data = await fetchJson<ErApiResponse>('https://open.er-api.com/v6/latest/USD')
  const r = data.rates
  if (!r?.KRW || !r?.JPY || !r?.CNY) throw new Error('er-api 응답 누락')
  return {
    quotes: buildQuotes({ KRW: r.KRW, JPY: r.JPY, CNY: r.CNY }, null),
    source: 'ER-API 기준',
    fetchedAt: Date.now(),
  }
}

/**
 * 환율 조회 (60초 메모리 캐시).
 * 두 API 모두 실패하면 null 반환 — UI에서는 영역 숨김 처리.
 */
export async function getExchangeRates(): Promise<ExchangeRatesResult | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache
  try {
    cache = await fetchFromFrankfurter()
    return cache
  } catch {
    try {
      cache = await fetchFromErApi()
      return cache
    } catch {
      return null
    }
  }
}
