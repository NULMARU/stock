/**
 * 스페이스AI 스톡랩 — 가격/등락/시가총액 포맷 유틸
 * 모든 페이지·컴포넌트에서 공유해서 사용 (W2 작성, 공용 소유)
 *
 * 한국 관습: 상승 빨강(#D64545) / 하락 파랑(#2563EB), ▲▼ + 부호 숫자 병기
 */

import type { Currency } from '@/types/stock'

/** 통화 기호/단위: KRW는 뒤에 '원', USD는 앞에 '$' 등 */
export const CURRENCY_PREFIX: Record<Currency, string> = {
  KRW: '',
  USD: '$',
  HKD: 'HK$',
  CNY: 'CN¥',
}

export const CURRENCY_SUFFIX: Record<Currency, string> = {
  KRW: '원',
  USD: '',
  HKD: '',
  CNY: '',
}

/** 통화별 소수점 자릿수 (KRW는 정수 관례) */
const CURRENCY_DIGITS: Record<Currency, number> = {
  KRW: 0,
  USD: 2,
  HKD: 2,
  CNY: 2,
}

/** 주가 포맷 — 예: 85,000원 / $205.82 / HK$112.30 / CN¥56.78 */
export function formatPrice(price: number | null | undefined, currency: Currency): string {
  if (price == null || Number.isNaN(price)) return 'N/A'
  const digits = CURRENCY_DIGITS[currency]
  const num = price.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${CURRENCY_PREFIX[currency]}${num}${CURRENCY_SUFFIX[currency]}`
}

export type ChangeDirection = 'up' | 'down' | 'flat' | 'na'

export function changeDirection(changePct: number | null | undefined): ChangeDirection {
  if (changePct == null || Number.isNaN(changePct)) return 'na'
  if (changePct > 0) return 'up'
  if (changePct < 0) return 'down'
  return 'flat'
}

/** 등락 화살표: ▲ / ▼ / - */
export function changeArrow(changePct: number | null | undefined): string {
  const dir = changeDirection(changePct)
  if (dir === 'up') return '▲'
  if (dir === 'down') return '▼'
  return '-'
}

/**
 * 등락 색상 Tailwind 클래스 (index.css에 유틸 정의)
 * 상승 빨강 / 하락 파랑 (한국 관습)
 */
export function changeColorClass(changePct: number | null | undefined): string {
  const dir = changeDirection(changePct)
  if (dir === 'up') return 'text-stock-up'
  if (dir === 'down') return 'text-stock-down'
  return 'text-muted-foreground'
}

/** 부호 포함 등락률 문자열 — 예: +1.48% / -2.10% / 0.00% */
export function formatChangePct(changePct: number | null | undefined): string {
  if (changePct == null || Number.isNaN(changePct)) return 'N/A'
  const sign = changePct > 0 ? '+' : ''
  return `${sign}${changePct.toFixed(2)}%`
}

/** 화살표 + 부호 숫자 한 덩어리 — 예: ▲ +1.48% */
export function formatChange(changePct: number | null | undefined): string {
  if (changePct == null || Number.isNaN(changePct)) return 'N/A'
  return `${changeArrow(changePct)} ${formatChangePct(changePct)}`
}

/** 시가총액 포맷 — USD: $4.99T/$253B/$123M, 그 외: 369조 원, 1,234억 원 */
export function formatMarketCap(
  value: number | null | undefined,
  currency: Currency,
): string {
  if (value == null || Number.isNaN(value)) return 'N/A'

  if (currency === 'USD') {
    if (value >= 1e12) return `$${trimNumber(value / 1e12)}T`
    if (value >= 1e9) return `$${trimNumber(value / 1e9)}B`
    if (value >= 1e6) return `$${trimNumber(value / 1e6)}M`
    return `$${value.toLocaleString('ko-KR')}`
  }

  // KRW / HKD / CNY → 조·억 단위 (한국어 표기)
  const prefix = CURRENCY_PREFIX[currency]
  const suffix = currency === 'KRW' ? ' 원' : ` ${currency}`
  if (value >= 1e12) return `${prefix}${trimNumber(value / 1e12)}조${suffix}`
  if (value >= 1e8) return `${prefix}${Math.round(value / 1e8).toLocaleString('ko-KR')}억${suffix}`
  if (value >= 1e6) return `${prefix}${Math.round(value / 1e6).toLocaleString('ko-KR')}백만${suffix}`
  return `${prefix}${value.toLocaleString('ko-KR')}${suffix}`
}

/** 소수 둘째자리까지, 끝 0 제거 (4.99 / 1.2 / 253) */
function trimNumber(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '')
}

/** 시장 한국어 라벨 */
export const MARKET_LABEL: Record<string, string> = {
  US: '미국',
  KR: '한국',
  CN: '중국',
}

/** 시장 배지 클래스 (index.css에 유틸 정의) */
export const MARKET_BADGE_CLASS: Record<string, string> = {
  US: 'bg-market-us',
  KR: 'bg-market-kr',
  CN: 'bg-market-cn',
}
