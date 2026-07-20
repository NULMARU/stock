import { useMemo } from 'react'
import { Link } from 'react-router'
import { Bell, Clock, ExternalLink, Newspaper } from 'lucide-react'
import type { NewsData, StockEntry } from '@/types/stock'
import stocksData from '@/data/stocks.json'
import rawNewsData from '@/data/news.json'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatAsOf, formatRelativeTime, getNewsForTickers } from '@/lib/news'
import { useLiveData } from '@/lib/liveData'
import { MARKET_BADGE_CLASS, MARKET_LABEL } from '@/lib/format'
import { useUserStore } from '@/lib/userStore'
import { cn } from '@/lib/utils'

const bundledStocks = stocksData as StockEntry[]
const bundledNews = rawNewsData as NewsData

/** 티커 → 표기용 정보 (기본 종목 + 사용자 추가 종목) */
function useTickerDirectory(stocks: StockEntry[]) {
  const { addedStocks } = useUserStore()
  return useMemo(() => {
    const map = new Map<string, { name: string; market: string }>()
    for (const s of stocks) map.set(s.ticker.toUpperCase(), { name: s.name, market: s.market })
    for (const s of addedStocks) map.set(s.ticker.toUpperCase(), { name: s.name, market: s.market })
    return map
  }, [stocks, addedStocks])
}

export default function NewsPage() {
  const { newsChecked } = useUserStore()
  const stocksLive = useLiveData<StockEntry[]>('stocks.json', bundledStocks)
  const newsLive = useLiveData<NewsData>('news.json', bundledNews)
  const directory = useTickerDirectory(stocksLive.data)

  // 체크된 종목들의 뉴스만 모아 시간 역순
  const feed = useMemo(
    () => getNewsForTickers(newsLive.data, newsChecked),
    [newsLive.data, newsChecked],
  )

  const asOfLabel = formatAsOf(newsLive.data.asOf)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      {/* 헤더 */}
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <Newspaper className="h-6 w-6 text-primary" aria-hidden />
          내 종목 뉴스
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          종목 카드에서 '뉴스 받기'를 체크한 종목의 뉴스만 모아 보여줘요. 하루 2회(08:19, 18:19
          KST) 자동 수집돼요.
          <span className="ml-1">
            (데이터 기준: {asOfLabel ?? '아직 수집 전'})
          </span>
        </p>
      </header>

      {newsChecked.length === 0 ? (
        /* 체크된 종목 없음 */
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card/60 px-4 py-16 text-center">
          <Bell className="h-10 w-10 text-muted-foreground/50" aria-hidden />
          <p className="mt-4 text-sm text-muted-foreground">
            아직 뉴스 받기를 체크한 종목이 없어요.
            <br />
            목록에서 뉴스 받기를 체크해 보세요.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-5">
            <Link to="/">종목 목록으로 가기</Link>
          </Button>
        </div>
      ) : feed.length === 0 ? (
        /* 체크는 했지만 아직 수집된 뉴스 없음 */
        <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-16 text-center text-sm text-muted-foreground">
          체크한 종목의 수집된 뉴스가 아직 없어요. 다음 자동 수집(08:19, 18:19 KST)을 기다려
          주세요.
        </div>
      ) : (
        /* 뉴스 피드 */
        <ol className="space-y-3">
          {feed.map((item, i) => {
            const meta = directory.get(item.ticker.toUpperCase())
            return (
              <li key={`${item.ticker}-${i}`}>
                <Card className="gap-2 rounded-xl border-border/70 p-4 shadow-card transition-shadow hover:shadow-card-hover">
                  {/* 종목 배지 + 시장 배지 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-semibold">
                      {meta?.name ?? item.ticker}
                    </Badge>
                    {meta && (
                      <Badge
                        className={cn(
                          'border-0 px-2 py-0.5 text-[11px] font-medium text-white',
                          MARKET_BADGE_CLASS[meta.market],
                        )}
                      >
                        {MARKET_LABEL[meta.market] ?? meta.market}
                      </Badge>
                    )}
                  </div>

                  {/* 제목 — 외부 링크 */}
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground hover:text-primary"
                  >
                    <span className="group-hover:underline">{item.title}</span>
                    <ExternalLink
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </a>

                  {/* 언론사 + 상대 시각 */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.source}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden />
                      {formatRelativeTime(item.publishedAt)}
                    </span>
                  </div>
                </Card>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-10 text-center text-xs text-muted-foreground">
        뉴스는 학습용 정보이며 투자 조언이 아니에요. 원문은 각 언론사 사이트에서 확인해 주세요.
      </p>
    </div>
  )
}
