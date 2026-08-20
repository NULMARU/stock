import { useMemo, useState } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { formatPrice } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Currency, PricePoint } from "@/types/stock"

/** 1년 장기 전망 (predictions.json entries[ticker].longTerm과 동일 형태) */
export interface ForecastTarget {
  forDate: string
  targetCentral: number
  targetLow: number
  targetHigh: number
}

export interface PriceChartProps {
  /** 최근 1년 가격 (포인트 수 가변) */
  priceHistory: PricePoint[]
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  currency: Currency
  /** 1년 뒤 전망 — 있으면 푸른 선 + 밴드로 이어 그림 */
  forecast?: ForecastTarget | null
}

type RangeKey = "3M" | "6M" | "1Y"

const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "3M", label: "3개월", days: 92 },
  { key: "6M", label: "6개월", days: 183 },
  { key: "1Y", label: "1년", days: 366 },
]

/** 전망 경로 생성 월 간격(점 수) */
const FORECAST_STEPS = 12

interface ChartRow {
  date: string
  close?: number
  forecast?: number
  /** 밴드 범위 [하한, 상한] — recharts Area range */
  band?: [number, number]
}

/** 소수 첫째자리까지, 끝 .0 제거 */
function trimNum(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "")
}

/** Y축 축약 표기 — KRW는 만/억, 그 외 통화는 k */
function compactTick(value: number, currency: Currency): string {
  const abs = Math.abs(value)
  if (currency === "KRW") {
    if (abs >= 1e8) return `${trimNum(value / 1e8)}억`
    if (abs >= 1e4) return `${trimNum(value / 1e4)}만`
    return value.toLocaleString("ko-KR")
  }
  if (abs >= 1e3) return `${trimNum(value / 1e3)}k`
  return `${value}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
      86_400_000,
  )
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: ReadonlyArray<{ value?: number | [number, number] | string; dataKey?: string }>
  currency: Currency
}

function ChartTooltip({ active, label, payload, currency }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const close = payload.find((p) => p.dataKey === "close")?.value
  const forecast = payload.find((p) => p.dataKey === "forecast")?.value
  const band = payload.find((p) => p.dataKey === "band")?.value
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{label}</div>
      {typeof close === "number" && (
        <div className="mt-0.5 text-muted-foreground">
          종가 <span className="font-semibold text-foreground">{formatPrice(close, currency)}</span>
        </div>
      )}
      {typeof forecast === "number" && (
        <div className="mt-0.5 text-muted-foreground">
          전망 <span className="font-semibold text-[#2563EB]">{formatPrice(forecast, currency)}</span>
        </div>
      )}
      {Array.isArray(band) && typeof band[0] === "number" && typeof band[1] === "number" && (
        <div className="mt-0.5 text-muted-foreground">
          밴드 {formatPrice(band[0], currency)} ~ {formatPrice(band[1], currency)}
        </div>
      )}
    </div>
  )
}

/**
 * 가격 차트 (recharts) — 기간 선택(3개월/6개월/1년), 52주 최고/최저 참조선,
 * 1년 뒤 전망(푸른 선 + 신뢰 밴드)을 이어서 표시. 반응형.
 */
export function PriceChart({
  priceHistory,
  fiftyTwoWeekHigh,
  fiftyTwoWeekLow,
  currency,
  forecast,
}: PriceChartProps) {
  const [range, setRange] = useState<RangeKey>("1Y")

  // 기간 필터 + 전망 경로 병합
  const rows = useMemo<ChartRow[]>(() => {
    if (priceHistory.length === 0) return []
    const last = priceHistory[priceHistory.length - 1]
    const days = RANGES.find((r) => r.key === range)?.days ?? 366
    const cutoff = addDays(last.date, -days)
    const hist: ChartRow[] = priceHistory
      .filter((p) => p.date >= cutoff)
      .map((p) => ({ date: p.date, close: p.close }))

    if (!forecast) return hist

    // 전망 경로: 마지막 종가에서 forDate까지 로그선형(중심)·선형(밴드) 보간
    const totalDays = Math.max(30, daysBetween(last.date, forecast.forDate))
    const stepDays = Math.max(7, Math.round(totalDays / FORECAST_STEPS))
    const logStart = Math.log(last.close)
    const logEnd = Math.log(Math.max(forecast.targetCentral, 0.01))

    // 이음점: 마지막 실적가를 전망 첫 점으로 (두 선이 끊기지 않게)
    const merged: ChartRow[] = [...hist]
    merged[merged.length - 1] = {
      ...merged[merged.length - 1],
      forecast: last.close,
      band: [last.close, last.close],
    }
    for (let i = 1; i * stepDays <= totalDays; i++) {
      const t = (i * stepDays) / totalDays
      const central = Math.exp(logStart + (logEnd - logStart) * t)
      const low = last.close + (forecast.targetLow - last.close) * t
      const high = last.close + (forecast.targetHigh - last.close) * t
      merged.push({
        date: addDays(last.date, i * stepDays),
        forecast: Math.round(central * 100) / 100,
        band: [Math.round(low * 100) / 100, Math.round(high * 100) / 100],
      })
    }
    return merged
  }, [priceHistory, forecast, range])

  if (priceHistory.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground">
        가격 데이터가 없어요
      </div>
    )
  }

  // 도메인: 종가·전망·밴드·참조선 모두 포함
  const values: number[] = []
  for (const r of rows) {
    if (typeof r.close === "number") values.push(r.close)
    if (typeof r.forecast === "number") values.push(r.forecast)
    if (r.band) values.push(r.band[0], r.band[1])
  }
  if (fiftyTwoWeekLow != null) values.push(fiftyTwoWeekLow)
  if (fiftyTwoWeekHigh != null) values.push(fiftyTwoWeekHigh)
  const domainMin = Math.min(...values)
  const domainMax = Math.max(...values)
  const pad = (domainMax - domainMin) * 0.06 || Math.abs(domainMax) * 0.02 || 1

  return (
    <div className="w-full">
      {/* 기간 선택 */}
      <div className="mb-2 flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              range === r.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
        {forecast && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="inline-block h-0.5 w-4 bg-[#2563EB]" />
            1년 뒤 전망
          </span>
        )}
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 14, right: 12, bottom: 0, left: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(2, 7).replace("-", "/")}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={[domainMin - pad, domainMax + pad]}
              tickFormatter={(v: number) => compactTick(v, currency)}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip content={<ChartTooltip currency={currency} />} />
            {fiftyTwoWeekHigh != null && (
              <ReferenceLine
                y={fiftyTwoWeekHigh}
                stroke="#D64545"
                strokeDasharray="5 4"
                label={{
                  value: "52주 최고",
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#D64545",
                }}
              />
            )}
            {fiftyTwoWeekLow != null && (
              <ReferenceLine
                y={fiftyTwoWeekLow}
                stroke="#2563EB"
                strokeDasharray="5 4"
                label={{
                  value: "52주 최저",
                  position: "insideBottomRight",
                  fontSize: 10,
                  fill: "#2563EB",
                }}
              />
            )}
            {/* 전망 신뢰 밴드 (푸른 음영) */}
            {forecast && (
              <Area
                type="monotone"
                dataKey="band"
                stroke="none"
                fill="#2563EB"
                fillOpacity={0.08}
                isAnimationActive={false}
              />
            )}
            {/* 실적 가격 (브랜드 오렌지) */}
            <Line
              type="monotone"
              dataKey="close"
              stroke="#C2571B"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
            {/* 1년 뒤 전망 (푸른 선, 이어서) */}
            {forecast && (
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="#2563EB"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                activeDot={{ r: 3 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default PriceChart
