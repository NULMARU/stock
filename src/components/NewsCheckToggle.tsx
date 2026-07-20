import { Bell } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useUserStore } from '@/lib/userStore'
import { cn } from '@/lib/utils'

interface NewsCheckToggleProps {
  ticker: string
}

/**
 * '뉴스 받기' 체크 토글 — 종목 카드 안에서 항상 표시.
 * 카드 전체가 Link/onClick 영역이므로, 이 영역의 클릭은
 * preventDefault + stopPropagation으로 카드 이동을 막는다.
 */
export function NewsCheckToggle({ ticker }: NewsCheckToggleProps) {
  const { newsChecked, setNewsChecked } = useUserStore()
  const checked = newsChecked.some((t) => t.toUpperCase() === ticker.toUpperCase())

  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <Checkbox
        id={`news-${ticker}`}
        checked={checked}
        onCheckedChange={(v) => setNewsChecked(ticker, v === true)}
        aria-label={`${ticker} 뉴스 받기`}
      />
      <button
        type="button"
        onClick={() => setNewsChecked(ticker, !checked)}
        className={cn(
          'flex items-center gap-1 text-[11px] font-medium transition-colors',
          checked ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Bell className={cn('h-3 w-3', checked && 'fill-current')} aria-hidden />
        뉴스 받기
      </button>
    </div>
  )
}
