/**
 * 스페이스AI 스톡랩 — 같은 테마 종목 비교 테이블
 *
 * props: { currentTicker }
 * 동작:
 * - useLiveData('stocks.json')으로 전체 종목 로드 (실패 시 번들 fallback)
 * - currentTicker 종목의 theme와 1개 이상 겹치는 종목을 최대 3개 선정
 *   (공유 테마 수 많은 순 → 시가총액 큰 순 → 티커 오름차순: 결정적 tie-break)
 * - 겹치는 종목이 없으면 컴포넌트 전체 숨김 (null)
 * - 익일 예측 방향은 predictions.json에 해당 티커가 있을 때만 표시
 */

import { useMemo } from "react"
import { GitCompareArrows, Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import stocksData from "@/data/stocks.json"
import predictionsData from "@/data/predictions.json"
import {
  changeColorClass,
  formatChange,
  formatPrice,
  MARKET_BADGE_CLASS,
  MARKET_LABEL,
} from "@/lib/format"
import { useLiveData } from "@/lib/liveData"
import { cn } from "@/lib/utils"
import type { StockEntry } from "@/types/stock"

const bundledStocks = stocksData as StockEntry[]

/** 익일 예측 방향만 필요 — predictions.json의 최소 부분집합 (StockDetailPage 패턴 참고) */
interface PredictionSlice {
  direction?: string
  expectedReturnPct?: number
}
interface PredictionsSlice {
  entries: Record<string, PredictionSlice>
}
const bundledPredictions = predictionsData as unknown as PredictionsSlice

/** 방향 배지 스타일 — 한국 관습: 상승 빨강 / 하락 파랑 / 보합 회색 */
const DIRECTION_META: Record<string, { label: string; arrow: string; badgeClass: string }> = {
  up: {
    label: "상승",
    arrow: "▲",
    badgeClass: "border-[#D64545]/40 bg-[#D64545]/10 text-[#D64545]",
  },
  down: {
    label: "하락",
    arrow: "▼",
    badgeClass: "border-[#2563EB]/40 bg-[#2563EB]/10 text-[#2563EB]",
  },
  flat: {
    label: "보합",
    arrow: "—",
    badgeClass: "border-border bg-muted text-muted-foreground",
  },
}

/** PER 포맷 — "31.5배", 적자 등 null이면 "N/A" */
const formatPer = (v: number | null): string => (v == null ? "N/A" : `${v.toFixed(1)}배`)

/** ROE 포맷 — 소수(0.45) → "45.0%", null이면 "N/A" */
const formatRoe = (v: number | null): string => (v == null ? "N/A" : `${(v * 100).toFixed(1)}%`)

/** 현재 종목과 겹치는 테마 수 */
function sharedThemeCount(current: StockEntry, other: StockEntry): number {
  const mine = new Set(current.theme)
  return other.theme.filter((t) => mine.has(t)).length
}

export interface CompareTableProps {
  /** 비교 기준 종목 티커 (예: "NVDA", "005930.KS") */
  currentTicker: string
}

/** 같은 테마 종목 비교 — 현재 종목 포함 최대 4행 */
export function CompareTable({ currentTicker }: CompareTableProps) {
  const stocksLive = useLiveData<StockEntry[]>("stocks.json", bundledStocks)
  const predictionsLive = useLiveData<PredictionsSlice>(
    "predictions.json",
    bundledPredictions,
  )

  // 기준 종목 + 같은 테마 비교 대상 선정 (데이터·티커가 바뀔 때만 재계산)
  const selection = useMemo(() => {
    const stocks = stocksLive.data
    const current = stocks.find(
      (s) => s.ticker.toUpperCase() === currentTicker.toUpperCase(),
    )
    if (!current) return null

    const peers = stocks
      .filter((s) => s.ticker !== current.ticker)
      .map((s) => ({ stock: s, shared: sharedThemeCount(current, s) }))
      .filter((c) => c.shared > 0)
      // 결정적 정렬: 공유 테마 수 ↓ → 시가총액 ↓ (없으면 맨 뒤) → 티커 오름차순
      .sort((a, b) => {
        if (b.shared !== a.shared) return b.shared - a.shared
        const capA = a.stock.quote.marketCap ?? -1
        const capB = b.stock.quote.marketCap ?? -1
        if (capB !== capA) return capB - capA
        return a.stock.ticker.localeCompare(b.stock.ticker)
      })
      .slice(0, 3)
      .map((c) => c.stock)

    if (peers.length === 0) return null
    // 공유 테마 라벨 — 부제목에 표시 (현재 종목 테마 중 비교 대상과 실제로 겹치는 것만)
    const peerThemes = new Set(peers.flatMap((p) => p.theme))
    const sharedLabels = current.theme.filter((t) => peerThemes.has(t))

    return { current, peers, sharedLabels }
  }, [stocksLive.data, currentTicker])

  // 기준 종목이 없거나 같은 테마 종목이 없으면 컴포넌트 전체 숨김
  if (!selection) return null

  const { current, peers, sharedLabels } = selection
  const rows = [current, ...peers]
  const predictions = predictionsLive.data.entries

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <GitCompareArrows className="h-5 w-5 text-[#C2571B]" aria-hidden />
          같은 테마 종목 비교
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          같은 테마({sharedLabels.join("·")}) 안에서 상대 비교가 중요해요 — 숫자가 좋아
          보여도 동료 종목보다 나쁘면 매력이 떨어질 수 있어요.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>종목</TableHead>
              <TableHead className="text-right">현재가</TableHead>
              <TableHead className="text-right">등락률</TableHead>
              <TableHead className="text-right">PER</TableHead>
              <TableHead className="text-right">ROE</TableHead>
              <TableHead className="text-right">종합점수</TableHead>
              <TableHead className="text-center">익일 예측</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const isCurrent = s.ticker === current.ticker
              const pred = predictions[s.ticker]
              const dir = pred?.direction ? DIRECTION_META[pred.direction] : undefined

              return (
                <TableRow
                  key={s.ticker}
                  className={cn(isCurrent && "bg-muted/60 font-medium")}
                >
                  {/* 종목 — 이름/티커/시장 배지, 현재 종목은 '현재' 표시로 강조 */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          "border-0 px-1.5 py-0 text-[10px] font-medium text-white",
                          MARKET_BADGE_CLASS[s.market],
                        )}
                      >
                        {MARKET_LABEL[s.market]}
                      </Badge>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                          {s.name}
                          {isCurrent && (
                            <Badge
                              variant="outline"
                              className="border-[#C2571B]/40 bg-[#C2571B]/10 px-1.5 py-0 text-[10px] font-semibold text-[#C2571B]"
                            >
                              현재
                            </Badge>
                          )}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {s.ticker}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {formatPrice(s.quote.price, s.currency)}
                  </TableCell>

                  <TableCell
                    className={cn(
                      "text-right font-semibold tabular-nums",
                      changeColorClass(s.quote.changePct),
                    )}
                  >
                    {formatChange(s.quote.changePct)}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {formatPer(s.metrics.trailingPE)}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {formatRoe(s.metrics.roe)}
                  </TableCell>

                  {/* 종합점수 — 5축 합계 0~25점 */}
                  <TableCell className="text-right tabular-nums">
                    <span className="font-semibold text-foreground">
                      {s.scores.total}
                    </span>
                    <span className="text-muted-foreground">/25</span>
                  </TableCell>

                  {/* 익일 예측 방향 — predictions.json에 해당 티커가 있을 때만 */}
                  <TableCell className="text-center">
                    {dir ? (
                      <Badge
                        variant="outline"
                        className={cn("px-2 py-0.5 text-xs font-semibold", dir.badgeClass)}
                      >
                        {dir.arrow} {dir.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {/* 고지 */}
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          종합점수는 밸류에이션·성장·수익성·재무건전성·모멘텀 5축 합계(25점 만점)예요.
          익일 예측은 통계적 추정일 뿐 투자 조언이 아니에요.
        </p>
      </CardContent>
    </Card>
  )
}
