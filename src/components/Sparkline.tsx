import type { PricePoint } from '@/types/stock'

interface SparklineProps {
  /** 최근 1년 주 1개 샘플 가격 이력 */
  points: PricePoint[]
  /** 1년 뒤 전망 중심가 — 있으면 푸른 점선으로 이어 그림 */
  forecastCentral?: number | null
  width?: number
  height?: number
  className?: string
}

/** 한국 관습 — 실적 빨강 / 전망 파랑 */
const HISTORY_COLOR = '#D64545'
const FORECAST_COLOR = '#2563EB'

/**
 * 채우기 없는 경량 순수 SVG 스파크라인 (포인트 2개 미만이면 렌더하지 않음)
 * forecastCentral이 있으면 왼쪽 72%에 실적(빨강), 오른쪽 28%에 1년 전망(파랑 점선)을 이어 그린다.
 */
export function Sparkline({
  points,
  forecastCentral,
  width = 100,
  height = 36,
  className,
}: SparklineProps) {
  if (!points || points.length < 2) return null

  const closes = points.map((p) => p.close).filter((v) => Number.isFinite(v))
  if (closes.length < 2) return null

  const hasForecast =
    typeof forecastCentral === 'number' && Number.isFinite(forecastCentral)
  const pad = 2
  // 전망이 있으면 실적은 왼쪽 72%까지만 사용
  const histEnd = hasForecast ? pad + (width - pad * 2) * 0.72 : width - pad

  const allValues = hasForecast ? [...closes, forecastCentral] : closes
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const range = max - min || 1

  const yOf = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / range)

  const stepX = (histEnd - pad) / (closes.length - 1)
  const historyPts = closes.map((close, i) => ({
    x: pad + i * stepX,
    y: yOf(close),
  }))
  const polyline = historyPts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  // 전망: 마지막 실적 점에서 목표가까지 직선 (중간점 1개로 살짝 곡선 느낌)
  let forecastLine: string | null = null
  if (hasForecast) {
    const last = historyPts[historyPts.length - 1]
    const endX = width - pad
    const midX = (last.x + endX) / 2
    const midY = (last.y + yOf(forecastCentral)) / 2
    forecastLine = `${last.x.toFixed(2)},${last.y.toFixed(2)} ${midX.toFixed(2)},${midY.toFixed(2)} ${endX.toFixed(2)},${yOf(forecastCentral).toFixed(2)}`
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={
        hasForecast
          ? '최근 1년 주가 추이(빨강)와 1년 뒤 전망(파랑)'
          : '최근 1년 주가 추이'
      }
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={HISTORY_COLOR}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {forecastLine && (
        <polyline
          points={forecastLine}
          fill="none"
          stroke={FORECAST_COLOR}
          strokeWidth={1.5}
          strokeDasharray="3 2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {forecastLine && (
        <circle
          cx={width - pad}
          cy={yOf(forecastCentral as number)}
          r={2}
          fill={FORECAST_COLOR}
        />
      )}
    </svg>
  )
}

export default Sparkline
