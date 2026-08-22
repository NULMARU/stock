import { Check, Star } from 'lucide-react'
import type { Currency, Market } from '@/types/stock'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  MARKET_BADGE_CLASS,
  MARKET_LABEL,
  changeColorClass,
  formatChange,
  formatMarketCap,
  formatPrice,
} from '@/lib/format'
import { cn } from '@/lib/utils'

/** 검색 유니버스 종목 1건 (universe.json entries 원소 — scripts/build_universe.py 생성) */
export interface UniverseEntry {
  ticker: string
  /** 한국어 표기 (큐레이션) */
  name: string
  nameEn: string
  market: Market
  currency: Currency
  theme: string[]
  quote: {
    price: number | null
    /** 등락률, 퍼센트 단위 (예: 1.23 = +1.23%) */
    changePct: number | null
    marketCap: number | null
  }
}

/** universe.json 전체 구조 */
export interface UniverseData {
  /** 기준일 YYYY-MM-DD */
  asOf: string
  entries: UniverseEntry[]
}

interface UniverseStockCardProps {
  entry: UniverseEntry
  /** 이미 관심 종목(기본 26종목 + 사용자 추가)에 있는지 */
  registered: boolean
  onRegister: (entry: UniverseEntry) => void
}

/**
 * 검색 유니버스 종목 카드 — 관심종목 카드(AddedStockCard)와 유사한 레이아웃에
 * 시세(가격/등락/시총)와 '관심 등록' 버튼을 얹은 형태.
 */
export function UniverseStockCard({ entry, registered, onRegister }: UniverseStockCardProps) {
  const { quote } = entry

  return (
    <Card className="flex h-full flex-col gap-3 rounded-xl p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover">
      {/* 상단: 시장 배지 + 등락률 */}
      <div className="flex items-center justify-between gap-2">
        <Badge
          className={cn(
            'border-0 px-2 py-0.5 text-[11px] font-medium text-white',
            MARKET_BADGE_CLASS[entry.market],
          )}
        >
          {MARKET_LABEL[entry.market]}
        </Badge>
        <span className={cn('text-xs font-semibold', changeColorClass(quote.changePct))}>
          {formatChange(quote.changePct)}
        </span>
      </div>

      {/* 이름 + 티커 */}
      <div>
        <h3 className="text-base font-semibold leading-snug text-foreground">{entry.name}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{entry.ticker}</span>
          <span className="mx-1">·</span>
          {entry.nameEn}
        </p>
      </div>

      {/* 가격 + 시가총액 */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-bold tracking-tight text-foreground">
          {formatPrice(quote.price, entry.currency)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          시총 {formatMarketCap(quote.marketCap, entry.currency)}
        </span>
      </div>

      {/* 테마 칩 */}
      {entry.theme.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.theme.map((t) => (
            <span
              key={t}
              className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* 하단: 관심 등록 버튼 */}
      <div className="mt-auto border-t border-border/60 pt-2.5">
        {registered ? (
          <Button variant="outline" size="sm" disabled className="w-full gap-1.5">
            <Check className="h-3.5 w-3.5" aria-hidden />
            등록됨
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 hover:border-primary/50 hover:text-primary"
            onClick={() => onRegister(entry)}
          >
            <Star className="h-3.5 w-3.5" aria-hidden />
            관심 등록
          </Button>
        )}
      </div>
    </Card>
  )
}
