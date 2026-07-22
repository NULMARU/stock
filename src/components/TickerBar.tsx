/**
 * 스페이스AI 스톡랩 — 티커바 (헤더 바로 아래 얇은 정보 바)
 *
 * 왼쪽: 환율 3개 (USD/KRW, JPY 100/KRW, CNY/KRW) + 전일 대비 ▲▼ + 출처/조회 시각
 * 오른쪽: 핫 뉴스 3개 (전 종목 news.json에서 최신순 중복 제거)
 *
 * 상승은 빨강(#D64545), 하락은 파랑(#2563EB) — 한국 관습.
 */

import { useEffect, useMemo, useState } from 'react'
import { Newspaper } from 'lucide-react'
import type { NewsData } from '@/types/stock'
import rawNewsData from '@/data/news.json'
import { useLiveData } from '@/lib/liveData'
import { formatRelativeTime } from '@/lib/news'
import { getExchangeRates, type ExchangeRatesResult } from '@/lib/exchangeRates'
import { cn } from '@/lib/utils'

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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-x-6 gap-y-1 px-4 py-1.5 sm:px-6 md:h-8 md:flex-row md:items-center md:justify-between md:gap-y-0 md:py-0">
        {/* 왼쪽: 환율 */}
        {rates && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 overflow-x-auto whitespace-nowrap text-[11px] leading-5 text-muted-foreground">
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

        {/* 오른쪽(모바일: 아래 줄): 핫 뉴스 */}
        {hotNews.length > 0 && (
          <div className="flex min-w-0 items-center gap-2 text-[11px] leading-5 md:max-w-[52%]">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px font-semibold text-primary">
              <Newspaper className="h-3 w-3" aria-hidden />
              핫 뉴스
            </span>
            <ul className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {hotNews.map((item, i) => (
                <li
                  key={`${item.title}-${i}`}
                  className={cn('inline-flex min-w-0 items-center gap-1', i > 0 && 'hidden sm:inline-flex')}
                >
                  <span className="shrink-0 text-muted-foreground/70">{item.source}</span>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 max-w-52 truncate font-medium text-foreground/85 underline-offset-2 hover:text-primary hover:underline sm:max-w-64"
                  >
                    {item.title}
                  </a>
                  <span className="shrink-0 text-muted-foreground/60">
                    {formatRelativeTime(item.publishedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
