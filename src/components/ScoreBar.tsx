import type { Scores } from '@/types/stock'
import { cn } from '@/lib/utils'

const AXES = [
  { key: 'valuation', label: '가치' },
  { key: 'growth', label: '성장' },
  { key: 'profitability', label: '수익' },
  { key: 'financialHealth', label: '건전' },
  { key: 'momentum', label: '모멘' },
] as const

interface ScoreBarProps {
  scores: Scores
  /** 총점 숫자 표시 여부 (기본 true) */
  showTotal?: boolean
  className?: string
}

/**
 * 5축 점수 미니 바 — 축당 0~5점, 총점 0~25.
 * 각 축이 세그먼트 하나로 채워져 한눈에 균형을 볼 수 있음.
 */
export function ScoreBar({ scores, showTotal = true, className }: ScoreBarProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex flex-1 items-end gap-1" aria-label={`5축 총점 ${scores.total}점 (25점 만점)`}>
        {AXES.map(({ key, label }) => {
          const axis = scores[key]
          const pct = Math.max(0, Math.min(100, (axis.score / 5) * 100))
          return (
            <div
              key={key}
              className="flex-1"
              title={`${label} ${axis.score}/5`}
              aria-label={`${label} ${axis.score}점`}
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {showTotal && (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
          {scores.total}
          <span className="text-muted-foreground">/25</span>
        </span>
      )}
    </div>
  )
}
