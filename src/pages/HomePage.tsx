import { useMemo, useState } from 'react'
import type { StockEntry } from '@/types/stock'
import stocksData from '@/data/stocks.json'
import { StockCard } from '@/components/StockCard'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const stocks = stocksData as StockEntry[]

type MarketFilter = 'ALL' | 'US' | 'KR' | 'CN'

const MARKET_TABS: { value: MarketFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'US', label: '미국' },
  { value: 'KR', label: '한국' },
  { value: 'CN', label: '중국' },
]

export default function HomePage() {
  const [market, setMarket] = useState<MarketFilter>('ALL')
  const [theme, setTheme] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // 테마 칩: stocks.json의 theme 값들에서 동적 생성 (등장 빈도 내림차순)
  const themes = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of stocks) {
      for (const t of s.theme) count.set(t, (count.get(t) ?? 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return stocks.filter((s) => {
      if (market !== 'ALL' && s.market !== market) return false
      if (theme && !s.theme.includes(theme)) return false
      if (q) {
        const haystack = `${s.name} ${s.nameEn} ${s.ticker}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [market, theme, query])

  const asOf = stocks[0]?.asOf

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      {/* 소개 헤더 */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          AI·우주 테마 종목 탐색 🚀
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          초보 투자자를 위한 학습 도구예요. 종목을 골라 기업 분석과 기본 개념을 함께 배워보세요.
          {asOf && <span className="ml-1">(데이터 기준일: {asOf})</span>}
        </p>
      </header>

      {/* 시장 탭 + 검색 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={market} onValueChange={(v) => setMarket(v as MarketFilter)}>
          <TabsList className="bg-muted">
            {MARKET_TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="종목명·영문명·티커 검색 (예: 엔비디아, NVIDIA, 005930)"
          className="w-full bg-card sm:max-w-xs"
          aria-label="종목 검색"
        />
      </div>

      {/* 테마 칩 필터 */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTheme(null)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            theme === null
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
          )}
        >
          전체 테마
        </button>
        {themes.map(([t, count]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(theme === t ? null : t)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              theme === t
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {t} <span className="opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {/* 결과 수 */}
      <p className="mb-3 text-xs text-muted-foreground">{filtered.length}개 종목</p>

      {/* 종목 카드 그리드 */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <StockCard key={s.ticker} stock={s} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card/60 py-16 text-center text-sm text-muted-foreground">
          조건에 맞는 종목이 없어요. 검색어나 필터를 바꿔보세요.
        </div>
      )}

      <p className="mt-10 text-center text-xs text-muted-foreground">
        본 서비스는 투자 조언이 아닌 학습 도구입니다. 투자 결정과 책임은 본인에게 있습니다.
      </p>
    </div>
  )
}
