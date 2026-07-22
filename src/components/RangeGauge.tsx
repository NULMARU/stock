import type { Currency } from '@/types/stock'
import { formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'

interface RangeGaugeProps {
  /** 52주 최저가 */
  low: number | null
  /** 52주 최고가 */
  high: number | null
  /** 현재가 */
  price: number | null
  currency: Currency
  className?: string
}

/**
 * 52주 범위 게이지 — 얇은 막대(왼쪽 최저 ~ 오른쪽 최고) 위에 현재가 위치 점 마커.
 * 마커 색: 하단 30% 이하 세이지 / 상단 30% 이상 테라코타 / 중간 잉크.
 * 데이터가 없거나 범위가 유효하지 않으면 렌더하지 않는다.
 */
export function RangeGauge({ low, high, price, currency, className }: RangeGaugeProps) {
  if (low == null || high == null || price == null) return null
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(price)) return null
  if (high <= low) return null

  // 현재가가 52주 범위를 살짝 벗어난 경우에도 마커는 양 끝에 클램프
  const ratio = Math.min(1, Math.max(0, (price - low) / (high - low)))
  const pct = Math.round(ratio * 100)

  const markerClass = ratio <= 0.3 ? 'bg-sage' : ratio >= 0.7 ? 'bg-primary' : 'bg-foreground'
  const lowLabel = formatPrice(low, currency)
  const highLabel = formatPrice(high, currency)

  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      role="img"
      aria-label={`52주 범위 내 현재가 위치 ${pct}% (52주 최저 ${lowLabel}, 52주 최고 ${highLabel})`}
    >
      <div className="relative h-1.5 rounded-full bg-muted">
        <span
          className={cn(
            'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card',
            markerClass,
          )}
          style={{ left: `${(ratio * 100).toFixed(2)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] leading-none tabular-nums text-muted-foreground">
        <span>52주 최저 {lowLabel}</span>
        <span>52주 최고 {highLabel}</span>
      </div>
    </div>
  )
}

export default RangeGauge
