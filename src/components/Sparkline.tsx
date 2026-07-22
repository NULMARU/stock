import type { PricePoint } from '@/types/stock'

interface SparklineProps {
  /** 최근 1년 주 1개 샘플 가격 이력 */
  points: PricePoint[]
  width?: number
  height?: number
  className?: string
}

/** 한국 관습 — 상승 빨강 / 하락 파랑 */
const UP_COLOR = '#D64545'
const DOWN_COLOR = '#2563EB'

/** 채우기 없는 경량 순수 SVG 스파크라인 (포인트 2개 미만이면 렌더하지 않음) */
export function Sparkline({ points, width = 100, height = 36, className }: SparklineProps) {
  if (!points || points.length < 2) return null

  const closes = points.map((p) => p.close).filter((v) => Number.isFinite(v))
  if (closes.length < 2) return null

  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const pad = 2
  const stepX = (width - pad * 2) / (closes.length - 1)

  const polyline = closes
    .map((close, i) => {
      const x = pad + i * stepX
      const y = pad + (height - pad * 2) * (1 - (close - min) / range)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const periodReturn = closes[closes.length - 1] / closes[0] - 1
  const color = periodReturn >= 0 ? UP_COLOR : DOWN_COLOR
  const returnPct = (periodReturn * 100).toFixed(1)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`최근 1년 주가 추이 (${periodReturn >= 0 ? '+' : ''}${returnPct}%)`}
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default Sparkline
