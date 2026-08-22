/**
 * "1년 전에 샀다면?" 체험 계산기
 *
 * 종목 상세 페이지의 주가 차트 카드 다음에 마운트되는 학습용 컴포넌트.
 * 실제 매매 시뮬레이션이 아니라, 가상 투자금으로 장기 보유·변동성 감각을
 * 익히게 하는 것이 목적이다. (환율 변환 없이 종목 통화 기준 단순 계산)
 */

import { useMemo, useState } from "react"
import { PiggyBank } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { changeArrow, changeColorClass, formatPrice } from "@/lib/format"
import type { StockEntry } from "@/types/stock"

/** 퍼센트 부호 문자열 — 예: +52.4% / -18.2% */
function signedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`
}

export function WhatIfCalculator({ stock }: { stock: StockEntry }) {
  // 투자금 입력 — 문자열로 관리하고 계산 시점에 숫자로 변환 (기본 1,000,000)
  const [amountText, setAmountText] = useState("1,000,000")

  const history = stock.priceHistory
  const hasEnoughData = history.length >= 2

  const result = useMemo(() => {
    if (!hasEnoughData) return null
    const first = history[0]
    const last = history[history.length - 1]
    if (first.close <= 0) return null

    const amount = Number(amountText.replace(/[^0-9.]/g, "")) || 0
    const shares = amount > 0 ? amount / first.close : 0
    const evalValue = shares * last.close
    const returnPct = (last.close / first.close - 1) * 100

    // 52주 최고점/최저점에서 샀다면 (현재가 대비)
    const high = stock.quote.fiftyTwoWeekHigh
    const low = stock.quote.fiftyTwoWeekLow
    const highPct = high != null && high > 0 ? (last.close / high - 1) * 100 : null
    const lowPct = low != null && low > 0 ? (last.close / low - 1) * 100 : null

    return { first, last, amount, evalValue, returnPct, highPct, lowPct }
  }, [history, hasEnoughData, amountText, stock.quote.fiftyTwoWeekHigh, stock.quote.fiftyTwoWeekLow])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <PiggyBank className="h-5 w-5 text-[#C2571B]" aria-hidden />
          1년 전에 샀다면?
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          가상의 투자금으로 장기 보유와 변동성을 체험해 보는 학습용 계산기예요
          (실제 매매가 아니며, 환율·수수료·배당은 반영하지 않아요)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasEnoughData || !result ? (
          <p className="text-sm text-muted-foreground">
            이 종목은 주가 이력 데이터가 부족해 계산할 수 없어요.
          </p>
        ) : (
          <>
            {/* 투자금 입력 */}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="whatif-amount" className="text-sm font-medium text-foreground">
                1년 전 투자금
              </label>
              <Input
                id="whatif-amount"
                inputMode="numeric"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="w-40 bg-card"
                aria-label="1년 전 투자금"
              />
              <span className="text-xs text-muted-foreground">
                {stock.currency === "KRW" ? "원" : stock.currency}
              </span>
            </div>

            {result.amount > 0 ? (
              <div className="space-y-3">
                {/* 평가 결과 */}
                <div className="rounded-xl bg-muted/50 px-4 py-3">
                  <p className="text-sm leading-relaxed text-foreground">
                    <span className="font-semibold">{result.first.date}</span> 종가{" "}
                    {formatPrice(result.first.close, stock.currency)}에 샀다면, 지금(
                    {result.last.date} 종가 {formatPrice(result.last.close, stock.currency)}
                    ) 기준 평가액은{" "}
                    <span className="font-bold">
                      {formatPrice(result.evalValue, stock.currency)}
                    </span>
                    이에요.
                  </p>
                  <p
                    className={`mt-1 text-lg font-bold ${changeColorClass(result.returnPct)}`}
                  >
                    {changeArrow(result.returnPct)} {signedPct(result.returnPct)}
                  </p>
                </div>

                {/* 52주 최고점/최저점 대비 */}
                {(result.highPct != null || result.lowPct != null) && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {result.highPct != null && (
                      <>
                        최고점에 샀다면{" "}
                        <span className={`font-semibold ${changeColorClass(result.highPct)}`}>
                          {signedPct(result.highPct)}
                        </span>
                      </>
                    )}
                    {result.highPct != null && result.lowPct != null && ", "}
                    {result.lowPct != null && (
                      <>
                        최저점에 샀다면{" "}
                        <span className={`font-semibold ${changeColorClass(result.lowPct)}`}>
                          {signedPct(result.lowPct)}
                        </span>
                      </>
                    )}
                    {" "}였어요.
                  </p>
                )}

                {/* 초보용 해석 한 줄 */}
                <p className="rounded-lg border border-border/70 bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {result.returnPct > 0
                    ? "💡 1년 전에 사서 지금까지 들고 있었다면 수익이에요. 좋은 기업을 오래 보유하는 힘을 보여주는 사례예요."
                    : result.returnPct < 0
                      ? "💡 1년 전에 샀다면 손실이에요. 변동성이 큰 종목은 사는 시점이 결과를 크게 바꾸니, 한 번에 사기보다 나눠서 사는 연습이 도움돼요."
                      : "💡 1년 전과 거의 같은 가격이에요. 주가가 제자리여도 배당이나 기업 가치 변화는 따로 살펴봐야 해요."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                투자금을 입력하면 결과가 표시돼요.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default WhatIfCalculator
