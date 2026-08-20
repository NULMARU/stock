/**
 * 스페이스AI 스톡랩 — 종목별 단기 방향 예측 패널 (predictions.json)
 *
 * 데이터: useLiveData('predictions.json') — public/data 런타임 fetch,
 *         실패 시 번들 fallback(src/data/predictions.json) 유지.
 * 표시 조건: entries에 해당 티커가 있고, 데이터(asOf 또는 predictedAt)가
 *           오늘(로컬 기준)일 때만 표시. 아니면 패널 전체 숨김(null).
 * 모든 수치는 통계적 추정 — 투자 조언 아님 (최하단 고지).
 */

import { Activity, CheckCircle2, Info, Target, XCircle } from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import rawPredictions from "@/data/predictions.json"
import { changeColorClass, formatChangePct, formatPrice } from "@/lib/format"
import { useLiveData } from "@/lib/liveData"
import { cn } from "@/lib/utils"
import type { Currency, LongTermConfidence, LongTermForecast } from "@/types/stock"

// ── predictions.json 스키마 (데이터 파이프라인 생성물) ─────────────
export type PredictionDirection = "up" | "down" | "flat"

export interface PredictionComponent {
  /** 요소 이름 (예: "모멘텀") */
  name: string
  /** 요소 신호 ("up" | "down" | "flat") */
  signal: string
  /** 판정 근거 한 줄 설명 */
  detail: string
}

export interface PredictionFeedback {
  /** 피드백 대상 예측일 YYYY-MM-DD */
  date: string
  predicted: string
  actual: string
  hit: boolean
  /** 실제 등락률, 퍼센트 단위 */
  returnPct: number
}

export interface PredictionEntry {
  /** 예측 생성일 YYYY-MM-DD */
  predictedAt: string
  /** 예측 대상일 YYYY-MM-DD */
  forDate: string
  direction: PredictionDirection
  /** 방향 확률 — 0~1 소수 또는 0~100 퍼센트 (asPercent로 정규화) */
  probability: number
  /** 예상 등락률, 퍼센트 단위 */
  expectedReturnPct: number
  /** 예상 밴드, 퍼센트 단위 */
  band: { low: number; high: number }
  /** 예측 기준 종가 */
  close: number
  /** 예측 근거 3요소 */
  components: PredictionComponent[]
  lastFeedback: PredictionFeedback | null
  /** 1년 뒤 전망 — 없으면 생략/null (장기 전망 섹션 숨김) */
  longTerm?: LongTermForecast | null
}

export interface PredictionsModel {
  weights?: Record<string, number>
  /** 최근 20회 방향 적중률 (0~1 또는 0~100), 표본 부족 시 null */
  hitRate20?: number | null
  hitRateAll?: number | null
  evaluated?: number
}

export interface PredictionsData {
  /** 데이터 기준일 YYYY-MM-DD, 수집 전이면 빈 문자열 */
  asOf: string
  methodologyVersion: string
  model: PredictionsModel
  entries: Record<string, PredictionEntry>
}

const bundledPredictions = rawPredictions as PredictionsData

/** 0~1 소수/0~100 퍼센트 혼용 입력을 퍼센트 숫자로 정규화 */
const asPercent = (v: number) => (v <= 1 ? v * 100 : v)

/** 로컬 기준 오늘 YYYY-MM-DD */
function localToday(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

interface DirectionMeta {
  label: string
  arrow: string
  badgeClass: string
}

/** 방향 배지 스타일 — 한국 관습: 상승 빨강 / 하락 파랑 / 보합 회색 */
const DIRECTION_META: Record<PredictionDirection, DirectionMeta> = {
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

/** 방향 문자열(영/한 혼용 가능) → 한국어 라벨 */
function directionLabel(v: string): string {
  if (v === "up" || v === "상승") return "상승"
  if (v === "down" || v === "하락") return "하락"
  if (v === "flat" || v === "보합") return "보합"
  return v
}

/** 요소 signal 값에 맞는 배지 클래스 (알 수 없는 값은 중립 세이지 톤) */
function signalBadgeClass(signal: string): string {
  if (signal === "up" || signal === "상승") return DIRECTION_META.up.badgeClass
  if (signal === "down" || signal === "하락") return DIRECTION_META.down.badgeClass
  if (signal === "flat" || signal === "보합") return DIRECTION_META.flat.badgeClass
  return "border-border bg-secondary text-secondary-foreground"
}

/** 신뢰도 배지 스타일 — high 세이지 / medium 앰버 / low 회색 */
const CONFIDENCE_META: Record<
  LongTermConfidence,
  { label: string; badgeClass: string }
> = {
  high: {
    label: "신뢰도 높음",
    badgeClass: "border-[#6B7F5E]/40 bg-[#6B7F5E]/10 text-[#4F6B4B]",
  },
  medium: {
    label: "보통",
    badgeClass: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  },
  low: {
    label: "낮음",
    badgeClass: "border-border bg-muted text-muted-foreground",
  },
}

/** 가중치(0~1 또는 0~100 혼용 방어) → 퍼센트 정수 */
const weightPct = (w: number) => Math.round(asPercent(w))

interface LongTermSectionProps {
  forecast: LongTermForecast
  /** 현재가(기준 종가) — 밴드 바 위치 마커용 */
  currentPrice: number
  currency: Currency
}

/**
 * 1년 뒤 전망 섹션 — predictions.json entries[ticker].longTerm 렌더.
 * 중앙 목표가·기대수익률, 밴드 가로 바(현재가 마커), 신뢰도 배지,
 * 3기둥 아코디언, 불확실성 고지.
 */
function LongTermSection({ forecast, currentPrice, currency }: LongTermSectionProps) {
  const conf = CONFIDENCE_META[forecast.confidence] ?? CONFIDENCE_META.low
  const { targetLow, targetHigh, targetCentral } = forecast

  // 밴드 바 스케일: 밴드와 현재가를 모두 포함하는 범위, 양 끝에 4% 여백
  const rawMin = Math.min(targetLow, currentPrice)
  const rawMax = Math.max(targetHigh, currentPrice)
  const span = rawMax - rawMin > 0 ? rawMax - rawMin : Math.max(rawMax, 1)
  const pad = span * 0.04
  const min = rawMin - pad
  const max = rawMax + pad
  const toPct = (v: number) =>
    Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))

  const bandLeft = toPct(targetLow)
  const bandRight = toPct(targetHigh)
  const centralPos = toPct(targetCentral)
  const currentPos = toPct(currentPrice)

  const bandAria = `1년 뒤 목표가 밴드 ${formatPrice(targetLow, currency)}에서 ${formatPrice(targetHigh, currency)}, 중앙 목표가 ${formatPrice(targetCentral, currency)}, 현재가 ${formatPrice(currentPrice, currency)}`

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-5 w-5 text-[#C2571B]" aria-hidden />
              1년 뒤 전망
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {forecast.forDate}의 주가 범위를 세 가지 관점으로 추정했어요
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn("px-2.5 py-1 text-sm font-semibold", conf.badgeClass)}
          >
            {conf.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 중앙 목표가 + 기대수익률 */}
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">중앙 목표가</dt>
            <dd className="mt-0.5 text-base font-bold text-foreground">
              {formatPrice(targetCentral, currency)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">기대 수익률</dt>
            <dd
              className={cn(
                "mt-0.5 text-base font-bold",
                changeColorClass(forecast.expectedReturnPct),
              )}
            >
              {formatChangePct(forecast.expectedReturnPct)}
            </dd>
          </div>
        </dl>

        {/* 목표가 밴드 가로 바 — 현재가 위치 마커 포함 (RangeGauge 스타일 참고, 직접 구현) */}
        <div className="space-y-1" role="img" aria-label={bandAria}>
          <div className="relative h-2 rounded-full bg-muted">
            {/* 밴드 구간 (저~고) */}
            <div
              className="absolute top-0 h-full rounded-full bg-[#C2571B]/20"
              style={{
                left: `${bandLeft.toFixed(2)}%`,
                width: `${Math.max(bandRight - bandLeft, 1).toFixed(2)}%`,
              }}
            />
            {/* 중앙 목표가 틱 */}
            <span
              className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C2571B]"
              style={{ left: `${centralPos.toFixed(2)}%` }}
            />
            {/* 현재가 마커 */}
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
              style={{ left: `${currentPos.toFixed(2)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] leading-none tabular-nums text-muted-foreground">
            <span>
              낮음 {formatPrice(targetLow, currency)} ({formatChangePct(forecast.bandLowPct)})
            </span>
            <span>
              높음 {formatPrice(targetHigh, currency)} ({formatChangePct(forecast.bandHighPct)})
            </span>
          </div>
          <div className="flex items-center gap-3 pt-1 text-[10px] leading-none text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-foreground" aria-hidden />
              현재가
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-0.5 rounded-full bg-[#C2571B]" aria-hidden />
              중앙 목표가
            </span>
          </div>
        </div>

        {/* 3기둥 아코디언 — 이름·목표가·가중치·근거 */}
        {forecast.pillars.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              전망 근거 {forecast.pillars.length}기둥
            </h3>
            <Accordion type="single" collapsible className="w-full">
              {forecast.pillars.map((p, i) => (
                <AccordionItem key={i} value={`pillar-${i}`}>
                  <AccordionTrigger className="px-3 text-sm">
                    <span className="flex flex-wrap items-center gap-2 text-left">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <Badge
                        variant="outline"
                        className="border-border bg-secondary text-secondary-foreground"
                      >
                        가중치 {weightPct(p.weight)}%
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-3">
                    <p className="text-sm text-foreground">
                      목표가{" "}
                      <span className="font-semibold">
                        {p.target != null
                          ? formatPrice(p.target, currency)
                          : "산출 불가"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {p.detail}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}

        {/* 고지 */}
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          1년 전망은 불확실성이 매우 커요. 참고용으로만 보세요.
        </p>
      </CardContent>
    </Card>
  )
}

export interface PredictionPanelProps {
  ticker: string
  currency: Currency
}

export function PredictionPanel({ ticker, currency }: PredictionPanelProps) {
  const { data } = useLiveData<PredictionsData>(
    "predictions.json",
    bundledPredictions,
  )

  const entry = data.entries[ticker]
  // 이 종목의 예측이 없으면 패널 전체 숨김
  if (!entry) return null

  // 오늘 데이터가 아니면 숨김 — 파일 기준일(asOf)이나 종목 예측 생성일(predictedAt) 중
  // 하나라도 오늘이면 표시 (파이프라인 필드 채움 방식 차이 흡수)
  const today = localToday()
  if (data.asOf.slice(0, 10) !== today && entry.predictedAt.slice(0, 10) !== today) {
    return null
  }

  const dir = DIRECTION_META[entry.direction] ?? DIRECTION_META.flat
  const probPct = Math.round(asPercent(entry.probability))
  const hitRate20 = data.model.hitRate20
  const fb = entry.lastFeedback
  const longTerm = entry.longTerm ?? null

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-[#C2571B]" aria-hidden />
              단기 방향 예측
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.forDate}의 방향을 통계 모델로 추정했어요
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn("px-2.5 py-1 text-sm font-semibold", dir.badgeClass)}
            >
              {dir.arrow} {dir.label} 예상
            </Badge>
            <span className="text-sm text-muted-foreground">
              확률{" "}
              <span className="font-semibold text-foreground">{probPct}%</span>
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 핵심 수치 요약 */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">예상 등락률</dt>
            <dd
              className={cn(
                "mt-0.5 text-base font-bold",
                changeColorClass(entry.expectedReturnPct),
              )}
            >
              {formatChangePct(entry.expectedReturnPct)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">예상 밴드</dt>
            <dd className="mt-0.5 text-base font-bold text-foreground">
              {formatChangePct(entry.band.low)} ~ {formatChangePct(entry.band.high)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">기준 종가</dt>
            <dd className="mt-0.5 text-base font-bold text-foreground">
              {formatPrice(entry.close, currency)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">예측 대상일</dt>
            <dd className="mt-0.5 text-base font-bold text-foreground">
              {entry.forDate}
            </dd>
          </div>
        </dl>

        {/* 예측 근거 요소 — name/signal/detail 투명 공개 */}
        {entry.components.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              예측 근거 {entry.components.length}가지
            </h3>
            <ul className="space-y-2">
              {entry.components.map((c, i) => (
                <li key={i} className="rounded-lg border bg-card px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={signalBadgeClass(c.signal)}>
                      {directionLabel(c.signal)}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">
                      {c.name}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {c.detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 직전 예측 피드백 — 있을 때만 */}
        {fb && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <span>
              어제 예측:{" "}
              <span className="font-medium text-foreground">
                {directionLabel(fb.predicted)}
              </span>
              {" → "}
              실제:{" "}
              <span className="font-medium text-foreground">
                {directionLabel(fb.actual)}
              </span>
              <span className={cn("ml-1", changeColorClass(fb.returnPct))}>
                ({formatChangePct(fb.returnPct)})
              </span>
            </span>
            {fb.hit ? (
              <span className="inline-flex items-center gap-1 font-medium text-[#4F6B4B]">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                적중 ✓
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                <XCircle className="h-4 w-4" aria-hidden />
                빗나감
              </span>
            )}
          </div>
        )}

        {/* 모델 성적표 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
          <span>
            최근 20회 방향 적중률{" "}
            {hitRate20 != null ? (
              <span className="font-semibold text-foreground">
                {Math.round(asPercent(hitRate20))}%
              </span>
            ) : (
              <span className="font-medium">피드백 데이터 수집 중</span>
            )}
          </span>
          {data.methodologyVersion && (
            <span className="text-xs">예측 방법론 {data.methodologyVersion}</span>
          )}
        </div>

        {/* 고지 */}
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          통계적 추정일 뿐 투자 조언이 아니에요. 단기 주가 예측은 정확도가 낮아요.
        </p>
      </CardContent>
    </Card>

    {/* 1년 뒤 전망 — longTerm 데이터가 있을 때만, 단기 예측 카드 아래 */}
    {longTerm && (
      <div className="mt-4">
        <LongTermSection
          forecast={longTerm}
          currentPrice={entry.close}
          currency={currency}
        />
      </div>
    )}
    </>
  )
}
