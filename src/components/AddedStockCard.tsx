import { useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import type { UserAddedStock } from '@/types/stock'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NewsCheckToggle } from '@/components/NewsCheckToggle'
import { MARKET_BADGE_CLASS, MARKET_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AddedStockCardProps {
  stock: UserAddedStock
  /** 편집 모드 — '삭제' 버튼 표시 */
  editMode?: boolean
  onRemove?: () => void
}

/**
 * 사용자 추가 종목 카드 — 정식 데이터(가격/점수)가 아직 없는 간이 종목.
 * 클릭하면 상세 페이지 대신 안내 다이얼로그를 띄운다.
 */
export function AddedStockCard({ stock, editMode = false, onRemove }: AddedStockCardProps) {
  const [infoOpen, setInfoOpen] = useState(false)

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setInfoOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setInfoOpen(true)
          }
        }}
        className="flex h-full cursor-pointer flex-col gap-3 rounded-xl border-dashed border-primary/40 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* 상단: 시장 배지 + '내가 추가함' 배지 */}
        <div className="flex items-center justify-between gap-2">
          <Badge
            className={cn(
              'border-0 px-2 py-0.5 text-[11px] font-medium text-white',
              MARKET_BADGE_CLASS[stock.market],
            )}
          >
            {MARKET_LABEL[stock.market]}
          </Badge>
          <Badge
            variant="outline"
            className="border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
          >
            <Sparkles className="mr-0.5 h-3 w-3" aria-hidden />
            내가 추가함
          </Badge>
        </div>

        {/* 이름 + 티커 */}
        <div>
          <h3 className="text-base font-semibold leading-snug text-foreground">{stock.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{stock.ticker}</span>
          </p>
        </div>

        {/* 테마 칩 */}
        {stock.theme.length > 0 && (
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
        )}

        {/* 가격/점수 데이터 없음 안내 */}
        <div className="mt-auto rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5 text-center text-xs text-muted-foreground">
          데이터 대기 중 · 다음 자동 갱신부터 분석이 채워져요
        </div>

        {/* 하단: 뉴스 받기 (항상) + 삭제 (편집 모드) */}
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
          <NewsCheckToggle ticker={stock.ticker} />
          {editMode && onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemove()
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              삭제
            </button>
          )}
        </div>
      </Card>

      {/* 카드 클릭 시 안내 — 상세 페이지 대신 */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stock.name} <span className="font-mono text-sm font-normal">({stock.ticker})</span>
            </DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed">
              간이 추가 종목이에요. 재무 분석·점수·뉴스는 다음 자동 갱신부터 반영돼요. 이 종목을
              정식 데이터에 영구 반영하려면 Kimi에게 추가를 요청해 주세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setInfoOpen(false)}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
