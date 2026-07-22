/**
 * 스페이스AI 스톡랩 — 티커바 (헤더 바로 아래 정보 바, 2단 구조)
 *
 * 윗줄: 환율 3개 (USD/KRW, JPY 100/KRW, CNY/KRW) + 전일 대비 ▲▼ + 출처/조회 시각 (슬림 유지)
 * 아랫줄: 핫 뉴스 3개를 전체 폭 리스트형 행으로 표시
 *         (언론사 배지 + 제목 최대 2줄 + 상대시각, 외부 링크)
 *
 * 상승은 빨강(#D64545), 하락은 파랑(#2563EB) — 한국 관습.
 */

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Newspaper } from 'lucide-react'
import type { NewsData } from '@/types/stock'
import rawNewsData from '@/data/news.json'
import { useLiveData } from '@/lib/liveData'
import { formatRelativeTime } from '@/lib/news'
import { getExchangeRates, type ExchangeRatesResult } from '@/lib/exchangeRates'

const bundledNews = rawNewsData as NewsData

const UP_COLOR = '#D64545'
const DOWN_COLOR = '#2563EB'

function formatKrw(v: number): string {
  return v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatClock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function TickerBar() {
  const [rates, setRates] = useState<ExchangeRatesResult | null>(null)

  // 마운트 시 + 60초 간격 조회 (exchangeRates 내부 60초 캐시)
  useEffect(() => {
    let alive = true
    const load = () => {
      void getExchangeRates().then((r) => {
        if (alive) setRates(r)
      })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const newsLive = useLiveData<NewsData>('news.json', bundledNews)

  // 전 종목 entries → publishedAt 최신순 → 제목 기준 중복 제거 → 상위 3개
  const hotNews = useMemo(() => {
    const all = Object.values(newsLive.data.entries ?? {}).flat()
    const sorted = [...all].sort((a, b) => {
      const ta = Date.parse(a.publishedAt)
      const tb = Date.parse(b.publishedAt)
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
      if (Number.isNaN(ta)) return 1
      if (Number.isNaN(tb)) return -1
      return tb - ta
    })
    const seen = new Set<string>()
    const picked: typeof sorted = []
    for (const item of sorted) {
      const key = item.title.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      picked.push(item)
      if (picked.length >= 3) break
    }
    return picked
  }, [newsLive.data])

  // 환율과 뉴스 모두 없으면 바 전체 숨김
  if (!rates && hotNews.length === 0) return null

  return (
    <div className="border-b border-border bg-muted">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6">
        {/* 윗줄: 환율 (슬림 유지) */}
        {rates && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 overflow-x-auto whitespace-nowrap py-1.5 text-[11px] leading-5 text-muted-foreground md:py-1">
            {rates.quotes.map((q) => (
              <span key={q.code} className="inline-flex items-center gap-1">
                <span className="font-medium text-foreground/80">{q.label}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatKrw(q.krw)}
                </span>
                {q.change !== null && q.changePct !== null && (
                  <span
                    className="inline-flex items-center gap-0.5 font-medium tabular-nums"
                    style={{
                      color:
                        q.change > 0 ? UP_COLOR : q.change < 0 ? DOWN_COLOR : undefined,
                    }}
                  >
                    {q.change > 0 ? '▲' : q.change < 0 ? '▼' : '—'}
                    {q.change !== 0 &&
                      `${formatKrw(Math.abs(q.change))} (${q.changePct > 0 ? '+' : ''}${q.changePct.toFixed(2)}%)`}
                  </span>
                )}
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground/70">
              {rates.source} · {formatClock(rates.fetchedAt)} 조회
            </span>
          </div>
        )}

        {/* 아랫줄: 핫 뉴스 (전체 폭, 리스트형 3행) */}
        {hotNews.length > 0 && (
          <section
            aria-label="핫 뉴스"
            className={
              rates
                ? 'border-t border-border/60 py-2 md:py-2.5'
                : 'py-2 md:py-2.5'
            }
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Newspaper className="h-3 w-3" aria-hidden />
                핫 뉴스
              </span>
            </div>
            <ul className="flex flex-col gap-1.5 md:gap-2">
              {hotNews.map((item, i) => (
                <li key={`${item.title}-${i}`}>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-primary/5 sm:gap-2.5"
                  >
                    <span className="mt-px inline-flex shrink-0 items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-primary">
                      {item.source}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-5 text-foreground/85 line-clamp-2 group-hover:text-primary group-hover:underline group-hover:underline-offset-2 sm:text-[13px]">
                      {item.title}
                    </span>
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-[10.5px] leading-4 text-muted-foreground/70">
                      {formatRelativeTime(item.publishedAt)}
                      <ExternalLink
                        className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
