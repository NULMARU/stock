import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Info,
  Sparkles,
  Telescope,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChecklistPanel } from "@/components/ChecklistPanel"
import { GlossaryTermModal } from "@/components/GlossaryTermModal"
import { MetricCard } from "@/components/MetricCard"
import { PriceChart } from "@/components/PriceChart"
import stocksData from "@/data/stocks.json"
import {
  changeArrow,
  changeColorClass,
  formatChangePct,
  formatMarketCap,
  formatPrice,
  MARKET_BADGE_CLASS,
  MARKET_LABEL,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BeginnerFit, StockEntry } from "@/types/stock"

const stocks = stocksData as StockEntry[]

const BEGINNER_FIT_META: Record<BeginnerFit, { label: string; className: string }> = {
  good: {
    label: "초보자 학습 적합",
    className: "border-[#7D9B76]/40 bg-[#7D9B76]/15 text-[#4F6B4B]",
  },
  caution: {
    label: "주의하며 학습",
    className: "border-[#C9A227]/40 bg-[#C9A227]/15 text-[#8A6D14]",
  },
  hard: {
    label: "심화 학습 종목",
    className: "border-[#C2571B]/40 bg-[#C2571B]/10 text-[#C2571B]",
  },
}

/** N/A 사유 표기 — 예: N/A(적자) */
const na = (reason: string) => `N/A(${reason})`

/** 소수 단위(0.45) → "45.0%" */
const ratioPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

/** 배수 → "31.5배" */
const multiple = (v: number, digits = 1) => `${v.toFixed(digits)}배`

interface MetricSpec {
  label: string
  value: string
  isNA: boolean
  interpretation: string
  /** glossary.json 실제 id (하이픈 형식) */
  termId: string
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>()

  const [glossaryTermId, setGlossaryTermId] = useState<string | null>(null)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const openGlossary = (id: string) => {
    setGlossaryTermId(id)
    setGlossaryOpen(true)
  }

  const stock = useMemo(
    () =>
      stocks.find(
        (s) => s.ticker.toLowerCase() === (ticker ?? "").toLowerCase(),
      ),
    [ticker],
  )

  // 존재하지 않는 티커 — 친절한 안내 + 홈 링크
  if (!stock) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
        <Telescope className="h-12 w-12 text-[#C2571B]" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold text-foreground">
          종목을 찾을 수 없어요
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold text-foreground">
            {ticker}
          </span>{" "}
          티커는 스페이스AI 스톡랩의 26개 학습 종목에 없어요.
          <br />
          주소가 정확한지 확인해 주세요.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            홈에서 종목 찾아보기
          </Link>
        </Button>
      </div>
    )
  }

  const { quote, metrics, sectorAvg } = stock

  // 비교 그룹 = 같은 시장 + 같은 대표 테마(theme[0]) — 1개뿐이면 '비교 그룹 부족'
  const groupSize = stocks.filter(
    (s) => s.market === stock.market && s.theme[0] === stock.theme[0],
  ).length

  // 적자 여부 — N/A 사유와 해석 분기에 사용
  const isLoss =
    (metrics.profitMargin ?? 0) < 0 || stock.riskFlags.includes("적자 기업")

  /** 업종(그룹) 중간값과 비교한 문구 (배수 지표 전용) */
  const comparePhrase = (value: number, median: number | null) => {
    if (groupSize < 2) return "비교 그룹 부족(그룹 내 종목 1개뿐)"
    if (median == null) return "그룹 중간값 데이터 없음"
    if (value < median * 0.9)
      return `업종 중간값 ${multiple(median)}보다 낮은 편`
    if (value <= median * 1.1)
      return `업종 중간값 ${multiple(median)}과 비슷한 수준`
    return `업종 중간값 ${multiple(median)}보다 높은 편`
  }

  // ── 핵심 지표 12종: 값 + 한 줄 해석 ─────────────────────────────
  const metricSpecs: MetricSpec[] = []

  // PER
  {
    const v = metrics.trailingPE
    let interpretation: string
    if (v == null) {
      interpretation = isLoss
        ? "적자 기업은 이익이 음수라 PER을 계산할 수 없어요. PSR·매출성장률로 가치를 가늠해요."
        : "데이터가 없어 해석할 수 없어요."
    } else {
      const level =
        v > 100 ? "매우 높은 편(과열 주의)" : v > 30 ? "높은 편" : v >= 15 ? "보통 수준" : "낮은 편"
      interpretation = `1년 이익의 ${v.toFixed(0)}배 가격 — 절대 기준 ${level}. ${comparePhrase(v, sectorAvg.pe)}.`
    }
    metricSpecs.push({
      label: "PER",
      value: v == null ? na(isLoss ? "적자" : "데이터 없음") : multiple(v),
      isNA: v == null,
      interpretation,
      termId: "per",
    })
  }

  // PBR
  {
    const v = metrics.priceToBook
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const level = v < 1 ? "낮은 편(장부가치 이하)" : v <= 3 ? "보통 수준" : "높은 편"
      interpretation = `순자산 대비 ${v.toFixed(1)}배 — ${level}이에요. 무형자산 중심 기업은 PBR이 높게 나오는 게 일반적이에요.`
    }
    metricSpecs.push({
      label: "PBR",
      value: v == null ? na("데이터 없음") : multiple(v),
      isNA: v == null,
      interpretation,
      termId: "pbr",
    })
  }

  // PSR
  {
    const v = metrics.priceToSales
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const level = v < 3 ? "낮은 편" : v <= 10 ? "보통 수준" : "높은 편"
      interpretation = `매출 1원당 ${v.toFixed(1)}배 가격 — 절대 기준 ${level}. ${comparePhrase(v, sectorAvg.ps)}.`
    }
    metricSpecs.push({
      label: "PSR",
      value: v == null ? na("데이터 없음") : multiple(v),
      isNA: v == null,
      interpretation,
      termId: "psr",
    })
  }

  // ROE
  {
    const v = metrics.roe
    let interpretation: string
    if (v == null) {
      interpretation = isLoss
        ? "적자 기업은 ROE를 계산할 수 없어요."
        : "데이터가 없어 해석할 수 없어요."
    } else {
      const pct = v * 100
      const level = pct < 0 ? "적자" : pct < 8 ? "낮은 편" : pct < 15 ? "보통 수준" : "높은 편"
      interpretation = `주주가 맡긴 100원으로 1년에 ${pct.toFixed(1)}원을 벌었어요 — ${level}${pct < 0 ? "예요" : "이에요"}.`
    }
    metricSpecs.push({
      label: "ROE",
      value: v == null ? na(isLoss ? "적자" : "데이터 없음") : ratioPct(v),
      isNA: v == null,
      interpretation,
      termId: "roe",
    })
  }

  // 영업이익률
  {
    const v = metrics.operatingMargin
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const pct = v * 100
      const level = pct < 0 ? "적자(본업 손실)" : pct < 10 ? "낮은 편" : pct < 20 ? "보통 수준" : "높은 편"
      interpretation = `매출 100원 중 ${pct.toFixed(1)}원이 본업 이익 — ${level}이에요.`
    }
    metricSpecs.push({
      label: "영업이익률",
      value: v == null ? na("데이터 없음") : ratioPct(v),
      isNA: v == null,
      interpretation,
      termId: "operating-margin",
    })
  }

  // 순이익률
  {
    const v = metrics.profitMargin
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const pct = v * 100
      const level = pct < 0 ? "적자" : pct < 5 ? "낮은 편" : pct < 15 ? "보통 수준" : "높은 편"
      interpretation = `매출 100원 중 최종 ${pct.toFixed(1)}원이 남아요 — ${level}${pct < 0 ? "예요" : "이에요"}.`
    }
    metricSpecs.push({
      label: "순이익률",
      value: v == null ? na("데이터 없음") : ratioPct(v),
      isNA: v == null,
      interpretation,
      // glossary.json에 순이익률 전용 id가 없어 가장 가까운 'net-income'으로 매핑
      termId: "net-income",
    })
  }

  // 부채비율 (데이터는 이미 % 단위)
  {
    const v = metrics.debtToEquity
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const level = v <= 100 ? "안정적인 편" : v <= 200 ? "보통 수준(눈여겨보기)" : "높은 편(주의)"
      interpretation = `자기자본 100원당 빚이 ${v.toFixed(0)}원 — ${level}이에요.`
    }
    metricSpecs.push({
      label: "부채비율",
      value: v == null ? na("데이터 없음") : `${v.toFixed(0)}%`,
      isNA: v == null,
      interpretation,
      termId: "debt-ratio",
    })
  }

  // 배당수익률
  {
    const v = metrics.dividendYield
    let interpretation: string
    if (v == null) {
      interpretation = "배당을 주지 않는 기업이에요. 성장을 위해 이익을 재투자하는 단계일 수 있어요."
    } else {
      const pct = v * 100
      const level = pct < 1 ? "낮은 편" : pct <= 3 ? "보통 수준" : "높은 편"
      interpretation = `주가 대비 연 ${pct.toFixed(2)}%를 배당으로 받아요 — ${level}이에요.`
    }
    metricSpecs.push({
      label: "배당수익률",
      value: v == null ? na("배당 없음") : ratioPct(v, 2),
      isNA: v == null,
      interpretation,
      termId: "dividend-yield",
    })
  }

  // 베타
  {
    const v = metrics.beta
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const level =
        v < 0.8 ? "낮은 편(시장보다 차분)" : v < 1.2 ? "보통(시장과 비슷)" : v < 2 ? "높은 편(시장보다 변동성 큼)" : "매우 높은 편"
      interpretation = `시장이 1% 움직일 때 약 ${v.toFixed(2)}%씩 움직였어요 — ${level}이에요.`
    }
    metricSpecs.push({
      label: "베타",
      value: v == null ? na("데이터 없음") : v.toFixed(2),
      isNA: v == null,
      interpretation,
      termId: "beta",
    })
  }

  // 52주 최고/최저
  {
    const high = quote.fiftyTwoWeekHigh
    const low = quote.fiftyTwoWeekLow
    const hasData = high != null && low != null && quote.price != null && high > low
    let interpretation = "데이터가 없어 해석할 수 없어요."
    if (hasData) {
      const pos = ((quote.price as number) - (low as number)) / ((high as number) - (low as number)) * 100
      const where =
        pos >= 90 ? "52주 최고가 근처에 있어요" : pos <= 10 ? "52주 최저가 근처에 있어요" : "중간 지점이에요"
      interpretation = `현재가는 52주 범위의 ${pos.toFixed(0)}% 지점 — ${where}.`
    }
    metricSpecs.push({
      label: "52주 최고/최저",
      value:
        high == null || low == null
          ? na("데이터 없음")
          : `${formatPrice(low, stock.currency)} ~ ${formatPrice(high, stock.currency)}`,
      isNA: high == null || low == null,
      interpretation,
      termId: "week52",
    })
  }

  // 시가총액 — 유니버스 내 순위로 해석 (외부 환율 가정 없이 데이터 기반)
  {
    const v = quote.marketCap
    let interpretation = "데이터가 없어 해석할 수 없어요."
    if (v != null) {
      const rank =
        stocks.filter((s) => (s.quote.marketCap ?? 0) > v).length + 1
      interpretation = `학습 유니버스 ${stocks.length}종목 중 ${rank}위 규모예요. 시총이 클수록 상대적으로 변동성이 낮은 편이에요.`
    }
    metricSpecs.push({
      label: "시가총액",
      value: v == null ? na("데이터 없음") : formatMarketCap(v, stock.currency),
      isNA: v == null,
      interpretation,
      termId: "market-cap",
    })
  }

  // 매출성장률
  {
    const v = metrics.revenueGrowth
    let interpretation: string
    if (v == null) {
      interpretation = "데이터가 없어 해석할 수 없어요."
    } else {
      const pct = v * 100
      const level = pct < 0 ? "역성장" : pct < 10 ? "낮은 편" : pct < 25 ? "보통 수준" : "빠른 성장"
      interpretation = `매출이 1년 전보다 ${Math.abs(pct).toFixed(0)}% ${pct < 0 ? "줄었어요" : "늘었어요"} — ${level}이에요.`
    }
    metricSpecs.push({
      label: "매출성장률",
      value: v == null ? na("데이터 없음") : `${v >= 0 ? "+" : ""}${ratioPct(v, 0)}`,
      isNA: v == null,
      interpretation,
      // glossary.json에 매출성장률 전용 id가 없어 가장 가까운 'revenue'로 매핑
      termId: "revenue",
    })
  }

  const fit = BEGINNER_FIT_META[stock.beginnerFit]

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
      {/* 상단 네비게이션 */}
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            종목 목록으로
          </Link>
        </Button>
      </div>

      {/* ── 헤더 ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-5 px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn("border-transparent text-white", MARKET_BADGE_CLASS[stock.market])}>
                  {MARKET_LABEL[stock.market] ?? stock.market}
                </Badge>
                {stock.theme.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
                <Badge variant="outline" className={fit.className}>
                  {fit.label}
                </Badge>
              </div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
                {stock.name}
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  {stock.nameEn}
                </span>
              </h1>
              <p className="font-mono text-sm text-muted-foreground">
                {stock.ticker}
              </p>
            </div>

            <div className="text-right">
              <div className="text-2xl font-bold text-foreground sm:text-3xl">
                {formatPrice(quote.price, stock.currency)}
              </div>
              <div
                className={cn(
                  "mt-1 text-base font-semibold",
                  changeColorClass(quote.changePct),
                )}
              >
                {quote.changePct == null
                  ? "등락률 N/A"
                  : `${changeArrow(quote.changePct)} ${formatChangePct(quote.changePct)}`}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
            <span>
              시가총액{" "}
              <span className="font-semibold text-foreground">
                {formatMarketCap(quote.marketCap, stock.currency)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              데이터 기준일 {stock.asOf}
            </span>
          </div>

          {stock.riskFlags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#C2571B]" aria-hidden />
              {stock.riskFlags.map((flag) => (
                <Badge
                  key={flag}
                  variant="outline"
                  className="border-[#C2571B]/40 bg-[#C2571B]/5 text-[#C2571B]"
                >
                  {flag}
                </Badge>
              ))}
            </div>
          )}

          <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            이 페이지의 모든 정보는 학습용이며 투자 조언이 아니에요. 실제 투자
            결정은 본인의 판단과 책임 하에 해주세요.
          </p>
        </CardContent>
      </Card>

      {/* ── 오늘의 한 줄 해석 ─────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Sparkles className="h-5 w-5 text-[#C2571B]" aria-hidden />
          오늘의 한 줄 해석
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {stock.insights.map((insight, i) => (
            <Card key={i} className="py-4">
              <CardContent className="px-4 text-sm leading-relaxed text-foreground">
                {insight}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── 5축 체크리스트 ────────────────────────────────── */}
      <section>
        <ChecklistPanel scores={stock.scores} />
      </section>

      {/* ── 핵심 지표 카드 그리드 ─────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">핵심 지표</h2>
          <p className="text-sm text-muted-foreground">
            모르는 용어는 '이게 뭐예요?'를 눌러 바로 배워보세요
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {metricSpecs.map((m) => (
            <MetricCard
              key={m.label}
              label={m.label}
              value={m.value}
              isNA={m.isNA}
              interpretation={m.interpretation}
              termId={m.termId}
              onOpenGlossary={openGlossary}
            />
          ))}
        </div>
      </section>

      {/* ── 1년 주가 차트 ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1년 주가 차트</CardTitle>
          <p className="text-sm text-muted-foreground">
            점선은 52주 최고(빨강)·최저(파랑) 가격이에요
          </p>
        </CardHeader>
        <CardContent>
          <PriceChart
            priceHistory={stock.priceHistory}
            fiftyTwoWeekHigh={quote.fiftyTwoWeekHigh}
            fiftyTwoWeekLow={quote.fiftyTwoWeekLow}
            currency={stock.currency}
          />
        </CardContent>
      </Card>

      {/* ── 기업 소개 ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">기업 소개</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed text-foreground">
          <p>{stock.description}</p>
          {stock.valueChain && (
            <p className="text-muted-foreground">
              밸류체인 위치:{" "}
              <span className="font-medium text-foreground">{stock.valueChain}</span>
            </p>
          )}
          {stock.riskFlags.includes("중국 A주 조회 전용") && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              중국 A주(상하이·선전) 종목은 데이터 조회 방식이 달라 일부 지표가
              제한될 수 있어요.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 용어 설명 모달 (W4 컴포넌트) */}
      <GlossaryTermModal
        termId={glossaryTermId}
        open={glossaryOpen}
        onOpenChange={setGlossaryOpen}
      />
    </div>
  )
}
