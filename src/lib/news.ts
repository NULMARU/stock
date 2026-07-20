/**
 * 스페이스AI 스톡랩 — 뉴스 데이터 접근 유틸
 * news.json은 자동 수집 워커가 갱신 (하루 2회 08:19/18:19 KST)
 */

import type { NewsData, NewsItem } from '@/types/stock'
import rawNewsData from '@/data/news.json'

export const newsData = rawNewsData as NewsData

/** 피드용 — 어떤 종목의 뉴스인지 티커를 붙인 형태 */
export interface NewsFeedItem extends NewsItem {
  ticker: string
}

/** 최신순 정렬 (발행 시각 파싱 실패 건은 뒤로) */
function byPublishedDesc(a: NewsItem, b: NewsItem): number {
  const ta = Date.parse(a.publishedAt)
  const tb = Date.parse(b.publishedAt)
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if (Number.isNaN(ta)) return 1
  if (Number.isNaN(tb)) return -1
  return tb - ta
}

/** 여러 티커의 뉴스를 모아 시간 역순 피드로 반환 */
export function getNewsForTickers(tickers: string[]): NewsFeedItem[] {
  const wanted = new Set(tickers.map((t) => t.toUpperCase()))
  const items: NewsFeedItem[] = []
  for (const [ticker, list] of Object.entries(newsData.entries ?? {})) {
    if (!wanted.has(ticker.toUpperCase())) continue
    for (const item of list) items.push({ ...item, ticker })
  }
  return items.sort(byPublishedDesc)
}

/** 한 종목의 뉴스 (최신순, 최대 limit개) */
export function getNewsForTicker(ticker: string, limit = 5): NewsItem[] {
  const entries = newsData.entries ?? {}
  const key =
    Object.keys(entries).find((k) => k.toUpperCase() === ticker.toUpperCase()) ??
    ticker
  return [...(entries[key] ?? [])].sort(byPublishedDesc).slice(0, limit)
}

/** ISO 시각 → '방금 전' / 'n분 전' / 'n시간 전' / 'n일 전' (30일↑는 날짜) */
export function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '시각 정보 없음'
  const diffMin = Math.floor((Date.now() - t) / 60_000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}일 전`
  const d = new Date(t)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** asOf 표기용 — 'YYYY.MM.DD. HH:mm', 비어 있으면 null */
export function formatAsOf(iso: string): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}`
}
