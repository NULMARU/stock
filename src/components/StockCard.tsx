import { Link } from 'react-router'
import { EyeOff } from 'lucide-react'
import type { BeginnerFit, StockEntry } from '@/types/stock'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScoreBar } from '@/components/ScoreBar'
import { NewsCheckToggle } from '@/components/NewsCheckToggle'
import { cn } from '@/lib/utils'
import {
  changeColorClass,
  formatChange,
  formatPrice,
  MARKET_BADGE_CLASS,
  MARKET_LABEL,
} from '@/lib/format'

const BEGINNER_FIT: Record<BeginnerFit, { label: string; className: string }> = {
  good: {
    label: '초보 적합',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  caution: {
    label: '주의',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  hard: {
    label: '고난도',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
}

interface StockCardProps {
  stock: StockEntry
  /** 편집 모드 — '숨기기' 버튼 표시 */
  editMode?: boolean
  onHide?: () => void
}

/** 홈 종목 카드 — 이름/티커/가격·등락/5축 미니 바/초보 적합도/리스크 플래그/뉴스 받기 */
export function StockCard({ stock, editMode = false, onHide }: StockCardProps) {
  const fit = BEGINNER_FIT[stock.beginnerFit]

  return (
    <Link to={`/stock/${stock.ticker}`} className="block focus:outline-none">
      <Card className="flex h-full flex-col gap-3 rounded-xl border-border/70 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-ring">
        {/* 상단: 시장 배지 + 초보 적합도 */}
        <div className="flex items-center justify-between gap-2">
          <Badge
            className={cn(
              'border-0 px-2 py-0.5 text-[11px] font-medium text-white',
              MARKET_BADGE_CLASS[stock.market],
            )}
          >
            {MARKET_LABEL[stock.market]}
          </Badge>
          <Badge variant="outline" className={cn('px-2 py-0.5 text-[11px] font-medium', fit.className)}>
            {fit.label}
          </Badge>
        </div>

        {/* 이름 + 티커 */}
        <div>
          <h3 className="text-base font-semibold leading-snug text-foreground">{stock.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {stock.nameEn} · <span className="font-mono">{stock.ticker}</span>
          </p>
        </div>

        {/* 테마 칩 */}
        <div className="flex flex-wrap gap-1">
          {stock.theme.map((t) => (
            <span
              key={t}
              className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
            >
              {t}
            </span>
          ))}
        </div>

        {/* 가격 + 등락 */}
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
          <span className="text-lg font-bold tabular-nums text-foreground">
            {formatPrice(stock.quote.price, stock.currency)}
          </span>
          <span className={cn('text-sm font-semibold tabular-nums', changeColorClass(stock.quote.changePct))}>
            {formatChange(stock.quote.changePct)}
          </span>
        </div>

        {/* 5축 미니 점수 바 */}
        <ScoreBar scores={stock.scores} />

        {/* 리스크 플래그 (최대 2개) */}
        {stock.riskFlags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stock.riskFlags.slice(0, 2).map((flag) => (
              <span
                key={flag}
                className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
              >
                ⚠ {flag}
              </span>
            ))}
            {stock.riskFlags.length > 2 && (
              <span className="text-[11px] text-muted-foreground">+{stock.riskFlags.length - 2}</span>
            )}
          </div>
        )}

        {/* 하단: 뉴스 받기 (항상) + 숨기기 (편집 모드) */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
          <NewsCheckToggle ticker={stock.ticker} />
          {editMode && onHide && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onHide()
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive"
            >
              <EyeOff className="h-3 w-3" aria-hidden />
              숨기기
            </button>
          )}
        </div>
      </Card>
    </Link>
  )
}
