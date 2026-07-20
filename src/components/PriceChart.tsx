import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { formatPrice } from "@/lib/format"
import type { Currency, PricePoint } from "@/types/stock"

export interface PriceChartProps {
  /** 최근 1년 가격 (포인트 수 가변) */
  priceHistory: PricePoint[]
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  currency: Currency
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

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: ReadonlyArray<{ value?: number | string }>
  currency: Currency
}

function ChartTooltip({ active, label, payload, currency }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const v = payload[0]?.value
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{label}</div>
      <div className="mt-0.5 text-muted-foreground">
        종가{" "}
        <span className="font-semibold text-foreground">
          {typeof v === "number" ? formatPrice(v, currency) : v}
        </span>
      </div>
    </div>
  )
}

/**
 * 1년 가격 라인 차트 (recharts) — 52주 최고/최저 참조선 포함, 반응형.
 */
export function PriceChart({
  priceHistory,
  fiftyTwoWeekHigh,
  fiftyTwoWeekLow,
  currency,
}: PriceChartProps) {
  if (priceHistory.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground">
        가격 데이터가 없어요
      </div>
    )
  }

  // 참조선(52주 최고/최저)이 잘리지 않도록 도메인에 포함
  const closes = priceHistory.map((p) => p.close)
  const domainMin = Math.min(...closes, fiftyTwoWeekLow ?? Number.POSITIVE_INFINITY)
  const domainMax = Math.max(...closes, fiftyTwoWeekHigh ?? Number.NEGATIVE_INFINITY)
  const pad = (domainMax - domainMin) * 0.06 || Math.abs(domainMax) * 0.02 || 1

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={priceHistory}
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
          <Line
            type="monotone"
            dataKey="close"
            stroke="#C2571B"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default PriceChart
