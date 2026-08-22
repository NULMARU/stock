import { useMemo, useState } from 'react'
import { Search, Satellite } from 'lucide-react'
import { toast } from 'sonner'

import type { Market, StockEntry } from '@/types/stock'
import stocksData from '@/data/stocks.json'
import universeBundled from '@/data/universe.json'
import { UniverseStockCard } from '@/components/UniverseStockCard'
import type { UniverseData, UniverseEntry } from '@/components/UniverseStockCard'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLiveData } from '@/lib/liveData'
import { useUserStore } from '@/lib/userStore'
import { searchMatches } from '@/lib/hangulSearch'
import { MARKET_LABEL } from '@/lib/format'

const bundledStocks = stocksData as StockEntry[]
const BUNDLED_UNIVERSE = universeBundled as UniverseData

/** 시장 필터 탭 순서 (ALL = 전체) */
const MARKET_TABS: { value: 'ALL' | Market; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'US', label: MARKET_LABEL.US },
  { value: 'KR', label: MARKET_LABEL.KR },
  { value: 'CN', label: MARKET_LABEL.CN },
]

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [market, setMarket] = useState<'ALL' | Market>('ALL')
  const { addedStocks, addStock } = useUserStore()

  // 번들 fallback + public/data/universe.json 라이브 조회 (배포 후 갱신 반영)
  const universeLive = useLiveData<UniverseData>('universe.json', BUNDLED_UNIVERSE)
  const entries = useMemo(() => universeLive.data?.entries ?? [], [universeLive.data])
  const asOf = universeLive.data?.asOf

  // 등록 중복 체크용 — 기본 26종목 + 사용자 추가 종목 모두 포함 (대소문자 무시)
  const registeredTickers = useMemo(() => {
    const set = new Set<string>()
    for (const s of bundledStocks) set.add(s.ticker.toUpperCase())
    for (const s of addedStocks) set.add(s.ticker.toUpperCase())
    return set
  }, [addedStocks])

  // 검색어(초성 지원) + 시장 탭으로 실시간 필터
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (market !== 'ALL' && e.market !== market) return false
        return searchMatches(`${e.name} ${e.nameEn} ${e.ticker}`, query)
      }),
    [entries, market, query],
  )

  const handleRegister = (entry: UniverseEntry) => {
    addStock({
      ticker: entry.ticker,
      name: entry.name,
      market: entry.market,
      theme: entry.theme,
    })
    toast.success(`관심 종목에 추가했어요. ${MARKET_LABEL[entry.market]} 탭에서 볼 수 있어요`)
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1C1917]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* 헤더 */}
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">종목 검색</h1>
          <p className="mt-2 text-sm text-[#1C1917]/60">
            기본 종목 외에 AI·우주·방위·반도체 테마의 미국/한국/중국 주요 종목을
            찾아 관심 종목에 추가해 보세요. 초성 검색(예: ㅎㅁㅂㄷㅎ → 한미반도체)도
            돼요.
            {asOf ? ` 시세 기준일: ${asOf}` : ''}
          </p>
        </header>

        {/* 검색 입력 */}
        <div className="relative mb-4 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1C1917]/40" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목명·티커·초성 검색 (예: 한미, ㅎㅁㅂㄷㅎ, LMT)"
            className="border-[#1C1917]/15 bg-white pl-9 focus-visible:ring-[#C2571B]/40"
          />
        </div>

        {/* 시장 탭 */}
        <Tabs
          value={market}
          onValueChange={(v) => setMarket(v as 'ALL' | Market)}
          className="mb-6"
        >
          <TabsList>
            {MARKET_TABS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* 결과 */}
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#1C1917]/15 bg-white/60 py-16 text-center">
            <Satellite className="h-8 w-8 text-[#1C1917]/30" aria-hidden />
            <p className="text-sm text-[#1C1917]/60">
              검색 유니버스 데이터를 불러오지 못했어요.
              <br />
              다음 데이터 갱신 이후에 다시 확인해 주세요.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-[#1C1917]/50">
            '{query}'에 해당하는 종목이 없어요. 다른 단어나 초성으로 검색해 보세요.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-[#1C1917]/50">
              {filtered.length}개 종목
              {market !== 'ALL' ? ` · ${MARKET_LABEL[market]}` : ''}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <UniverseStockCard
                  key={entry.ticker}
                  entry={entry}
                  registered={registeredTickers.has(entry.ticker.toUpperCase())}
                  onRegister={handleRegister}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
