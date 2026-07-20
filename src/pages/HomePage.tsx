import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ExternalLink, Pencil, Plus, RefreshCw, RotateCcw, Satellite } from 'lucide-react'
import { toast } from 'sonner'
import type { Market, NewsData, StockEntry, UnicornData, UserAddedStock } from '@/types/stock'
import stocksData from '@/data/stocks.json'
import newsJsonData from '@/data/news.json'
import unicornsJsonData from '@/data/unicorns.json'
import { StockCard } from '@/components/StockCard'
import { AddedStockCard } from '@/components/AddedStockCard'
import { UnicornPanel } from '@/components/UnicornPanel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLiveData } from '@/lib/liveData'
import { useUserStore } from '@/lib/userStore'
import { cn } from '@/lib/utils'

const bundledStocks = stocksData as StockEntry[]
const bundledNews = newsJsonData as NewsData
const bundledUnicorns = unicornsJsonData as UnicornData

type MarketFilter = 'ALL' | 'US' | 'KR' | 'CN' | 'UNICORN'

const MARKET_TABS: { value: MarketFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'US', label: '미국' },
  { value: 'KR', label: '한국' },
  { value: 'CN', label: '중국' },
  { value: 'UNICORN', label: '유니콘' },
]

const DATA_REQUEST_URL =
  'https://github.com/NULMARU/stock/issues/new?title=%EB%8D%B0%EC%9D%B4%ED%84%B0%20%EA%B0%B1%EC%8B%A0%20%EC%9A%94%EC%B2%AD&body=%EC%A0%84%EC%B2%B4%20%EC%A2%85%EB%AA%A9%20%EB%8D%B0%EC%9D%B4%ED%84%B0%20%EA%B0%B1%EC%8B%A0%EC%9D%84%20%EC%9A%94%EC%B2%AD%ED%95%A9%EB%8B%88%EB%8B%A4.'

type ListItem =
  | { kind: 'base'; stock: StockEntry }
  | { kind: 'added'; stock: UserAddedStock }

export default function HomePage() {
  const [market, setMarket] = useState<MarketFilter>('ALL')
  const [theme, setTheme] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editMode, setEditMode] = useState(false)

  // 런타임 라이브 데이터 (실패 시 번들 fallback 유지)
  const stocksLive = useLiveData<StockEntry[]>('stocks.json', bundledStocks)
  const newsLive = useLiveData<NewsData>('news.json', bundledNews)
  const unicornsLive = useLiveData<UnicornData>('unicorns.json', bundledUnicorns)
  const stocks = stocksLive.data

  // '새 데이터 수집 요청' 다이얼로그
  const [requestOpen, setRequestOpen] = useState(false)

  const refreshingAll =
    stocksLive.refreshing || newsLive.refreshing || unicornsLive.refreshing

  // 전체 갱신 — stocks + news + unicorns 모두 캐시버스팅 재조회
  const handleRefreshAll = async () => {
    const [freshStocks] = await Promise.all([
      stocksLive.refresh(),
      newsLive.refresh(),
      unicornsLive.refresh(),
    ])
    const asOfLabel = freshStocks?.[0]?.asOf ?? stocksLive.data[0]?.asOf
    toast.success(
      asOfLabel
        ? `최신 게시 데이터로 갱신했어요 (기준일: ${asOfLabel})`
        : '최신 게시 데이터로 갱신했어요',
    )
  }

  const {
    hiddenTickers,
    addedStocks,
    hideTicker,
    restoreHidden,
    addStock,
    removeAddedStock,
  } = useUserStore()

  // 종목 추가 다이얼로그 상태
  const [addOpen, setAddOpen] = useState(false)
  const [formTicker, setFormTicker] = useState('')
  const [formName, setFormName] = useState('')
  const [formMarket, setFormMarket] = useState<Market>('US')
  const [formThemes, setFormThemes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const resetForm = () => {
    setFormTicker('')
    setFormName('')
    setFormMarket('US')
    setFormThemes('')
    setFormError(null)
  }

  // 테마 칩: 기본 종목 + 사용자 추가 종목의 theme 값에서 동적 생성 (등장 빈도 내림차순)
  const themes = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of stocks) {
      for (const t of s.theme) count.set(t, (count.get(t) ?? 0) + 1)
    }
    for (const s of addedStocks) {
      for (const t of s.theme) count.set(t, (count.get(t) ?? 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  }, [stocks, addedStocks])

  // 숨긴 기본 종목을 제외하고, 추가 종목과 병합해 필터링
  const filtered = useMemo<ListItem[]>(() => {
    const q = query.trim().toLowerCase()
    const matchCommon = (market_: string, themeList: string[], haystack: string) => {
      if (market !== 'ALL' && market_ !== market) return false
      if (theme && !themeList.includes(theme)) return false
      if (q && !haystack.toLowerCase().includes(q)) return false
      return true
    }

    const baseItems: ListItem[] = stocks
      .filter((s) => !hiddenTickers.some((t) => t.toUpperCase() === s.ticker.toUpperCase()))
      .filter((s) => matchCommon(s.market, s.theme, `${s.name} ${s.nameEn} ${s.ticker}`))
      .map((s) => ({ kind: 'base', stock: s }))

    const addedItems: ListItem[] = addedStocks
      .filter((s) => matchCommon(s.market, s.theme, `${s.name} ${s.ticker}`))
      .map((s) => ({ kind: 'added', stock: s }))

    return [...baseItems, ...addedItems]
  }, [market, theme, query, stocks, hiddenTickers, addedStocks])

  const asOf = stocks[0]?.asOf

  const handleAddSubmit = (e: FormEvent) => {
    e.preventDefault()
    const ticker = formTicker.trim().toUpperCase()
    const name = formName.trim()
    const theme = formThemes
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    if (!ticker || !name) {
      setFormError('티커와 한국어 이름은 꼭 입력해 주세요.')
      return
    }
    if (stocks.some((s) => s.ticker.toUpperCase() === ticker)) {
      setFormError('이미 기본 목록에 있는 종목이에요. 검색해서 찾아보세요.')
      return
    }

    addStock({ ticker, name, market: formMarket, theme })
    setAddOpen(false)
    resetForm()
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      {/* 소개 헤더 */}
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              AI·우주 테마 종목 탐색 🚀
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              초보 투자자를 위한 학습 도구예요. 종목을 골라 기업 분석과 기본 개념을 함께 배워보세요.
              {asOf && <span className="ml-1">(데이터 기준일: {asOf})</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
            >
              <RefreshCw
                className={cn('h-4 w-4', refreshingAll && 'animate-spin')}
                aria-hidden
              />
              {refreshingAll ? '갱신 중…' : '전체 갱신'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setRequestOpen(true)}
            >
              <Satellite className="h-4 w-4" aria-hidden />
              새 데이터 수집 요청
            </Button>
          </div>
        </div>
      </header>

      {/* 시장 탭 + 검색 + 편집 토글 */}
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
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목명·영문명·티커 검색 (예: 엔비디아, NVIDIA, 005930)"
            className="w-full bg-card sm:max-w-xs"
            aria-label="종목 검색"
          />
          {editMode && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden />
              종목 추가
            </Button>
          )}
          <Button
            type="button"
            variant={editMode ? 'default' : 'outline'}
            size="sm"
            className="shrink-0"
            onClick={() => setEditMode((v) => !v)}
            aria-pressed={editMode}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            편집
          </Button>
        </div>
      </div>

      {/* 유니콘 탭 — 3축 알고리즘 평가 통과 종목 */}
      {market === 'UNICORN' ? (
        <UnicornPanel data={unicornsLive.data} />
      ) : (
        <>
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
          <p className="mb-3 text-xs text-muted-foreground">
            {filtered.length}개 종목
            {editMode && ' · 편집 모드: 카드의 숨기기/삭제로 목록을 정리할 수 있어요'}
          </p>

          {/* 종목 카드 그리드 */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((item) =>
                item.kind === 'base' ? (
                  <StockCard
                    key={item.stock.ticker}
                    stock={item.stock}
                    editMode={editMode}
                    onHide={() => hideTicker(item.stock.ticker)}
                  />
                ) : (
                  <AddedStockCard
                    key={`added-${item.stock.ticker}`}
                    stock={item.stock}
                    editMode={editMode}
                    onRemove={() => removeAddedStock(item.stock.ticker)}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/60 py-16 text-center text-sm text-muted-foreground">
              조건에 맞는 종목이 없어요. 검색어나 필터를 바꿔보세요.
            </div>
          )}

          {/* 숨긴 종목 복원 */}
          {hiddenTickers.length > 0 && (
            <div className="mt-6 flex items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
              <span>숨긴 종목 {hiddenTickers.length}개</span>
              <Button type="button" variant="outline" size="sm" onClick={restoreHidden}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                모두 복원
              </Button>
            </div>
          )}
        </>
      )}

      {/* 새 데이터 수집 요청 다이얼로그 */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>새 데이터 수집 요청</DialogTitle>
            <DialogDescription>
              자동 수집은 매일 06:47, 뉴스는 08:19/18:19에 실행돼요. 지금 바로 새 데이터를
              수집하려면 GitHub 로그인 상태에서 아래 버튼으로 요청을 남겨주세요. 약 3~5분 뒤
              반영돼요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <a href={DATA_REQUEST_URL} target="_blank" rel="noopener noreferrer">
                GitHub에 수집 요청 남기기
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 종목 추가 다이얼로그 */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>종목 추가</DialogTitle>
            <DialogDescription>
              목록에 없는 종목을 간이 카드로 추가해요. 재무 분석·점수는 다음 자동 갱신부터
              채워져요.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-ticker">티커</Label>
              <Input
                id="add-ticker"
                value={formTicker}
                onChange={(e) => setFormTicker(e.target.value)}
                placeholder="예: TSLA, 005930.KS"
                className="bg-card font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-name">한국어 이름</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="예: 테슬라"
                className="bg-card"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-market">시장</Label>
              <Select value={formMarket} onValueChange={(v) => setFormMarket(v as Market)}>
                <SelectTrigger id="add-market" className="bg-card">
                  <SelectValue placeholder="시장 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">미국 (US)</SelectItem>
                  <SelectItem value="KR">한국 (KR)</SelectItem>
                  <SelectItem value="CN">중국 (CN)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-themes">테마 (콤마로 구분)</Label>
              <Input
                id="add-themes"
                value={formThemes}
                onChange={(e) => setFormThemes(e.target.value)}
                placeholder="예: AI 반도체, 전기차"
                className="bg-card"
              />
            </div>
            {formError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="submit">
                <Plus className="h-4 w-4" aria-hidden />
                추가하기
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        본 서비스는 투자 조언이 아닌 학습 도구입니다. 투자 결정과 책임은 본인에게 있습니다.
      </p>
    </div>
  )
}
