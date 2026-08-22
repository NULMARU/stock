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

/** 시장 소분류 칩 (ALL = 전체) */
const SUB_MARKET_TABS: { value: 'ALL' | Market; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'US', label: MARKET_LABEL.US },
  { value: 'KR', label: MARKET_LABEL.KR },
  { value: 'CN', label: MARKET_LABEL.CN },
]

/** 대량 유니버스(1만+ 종목) 대응 — 결과는 상위 N개까지만 렌더링 */
const RESULT_LIMIT = 30

/**
 * 홈 '검색' 탭 패널 — 실제 상장된 미국/한국/중국 전체 주식(유니버스)을
 * 초성검색으로 찾아 관심 종목에 추가한다. (기존 SearchPage 로직 이관)
 */
export function UniverseSearchPanel() {
  const [query, setQuery] = useState('')
  const [subMarket, setSubMarket] = useState<'ALL' | Market>('ALL')
  const { addedStocks, addStock } = useUserStore()

  // 번들 fallback + public/data/universe.json 라이브 조회 (배포 후 갱신 반영)
  const universeLive = useLiveData<UniverseData>('universe.json', BUNDLED_UNIVERSE)
  const entries = useMemo(() => universeLive.data?.entries ?? [], [universeLive.data])
  const asOf = universeLive.data?.asOf

  // 등록 중복 체크용 — 기본 종목 + 사용자 추가 종목 모두 포함 (대소문자 무시)
  const registeredTickers = useMemo(() => {
    const set = new Set<string>()
    for (const s of bundledStocks) set.add(s.ticker.toUpperCase())
    for (const s of addedStocks) set.add(s.ticker.toUpperCase())
    return set
  }, [addedStocks])

  // 검색어(초성 지원) + 시장 소분류로 실시간 필터
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (subMarket !== 'ALL' && e.market !== subMarket) return false
        return searchMatches(`${e.name} ${e.nameEn ?? ''} ${e.ticker}`, query)
      }),
    [entries, subMarket, query],
  )
  const shown = filtered.slice(0, RESULT_LIMIT)
  const trimmed = query.trim()

  const handleRegister = (entry: UniverseEntry) => {
    addStock({
      ticker: entry.ticker,
      name: entry.name,
      market: entry.market,
      theme: entry.theme ?? [],
    })
    toast.success(`관심 종목에 추가했어요. ${MARKET_LABEL[entry.market]} 탭에서 볼 수 있어요`)
  }

  return (
    <div>
      {/* 검색 입력 */}
      <div className="relative mb-4 max-w-md">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="종목명·티커·초성 검색 (예: 애플, ㅅㅅㅈㅈ, AAPL, 600519)"
          className="bg-card pl-9"
          aria-label="유니버스 종목 검색"
        />
      </div>

      {/* 시장 소분류 칩 */}
      <Tabs
        value={subMarket}
        onValueChange={(v) => setSubMarket(v as 'ALL' | Market)}
        className="mb-6"
      >
        <TabsList className="bg-muted">
          {SUB_MARKET_TABS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 결과 영역 */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/60 py-16 text-center">
          <Satellite className="h-8 w-8 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">
            검색 유니버스 데이터를 불러오지 못했어요.
            <br />
            다음 데이터 갱신 이후에 다시 확인해 주세요.
          </p>
        </div>
      ) : trimmed === '' ? (
        // 검색어가 없으면 안내 문구만 (1만+ 종목 전체 렌더링 방지)
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/60 py-16 text-center">
          <Search className="h-8 w-8 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">
            미국·한국·중국 전체 상장 종목 {entries.length.toLocaleString('ko-KR')}개를
            검색할 수 있어요.
            <br />
            종목명·티커·초성(예: ㅎㅁㅂㄷㅎ → 한미반도체)으로 검색해 보세요.
            {asOf ? ` (데이터 기준일: ${asOf})` : ''}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          '{trimmed}'에 해당하는 종목이 없어요. 다른 단어나 초성으로 검색해 보세요.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {filtered.length > RESULT_LIMIT
              ? `총 ${filtered.length.toLocaleString('ko-KR')}개 중 상위 ${RESULT_LIMIT}개만 표시해요 — 검색어를 더 구체적으로 입력하면 좁혀져요`
              : `${filtered.length}개 종목`}
            {subMarket !== 'ALL' ? ` · ${MARKET_LABEL[subMarket]}` : ''}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((entry) => (
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
  )
}
