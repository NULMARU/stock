import { Check, X } from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Scores } from "@/types/stock"

type AxisKey =
  | "valuation"
  | "growth"
  | "profitability"
  | "financialHealth"
  | "momentum"

const AXIS_META: { key: AxisKey; label: string }[] = [
  { key: "valuation", label: "밸류에이션" },
  { key: "growth", label: "성장성" },
  { key: "profitability", label: "수익성" },
  { key: "financialHealth", label: "재무건전성" },
  { key: "momentum", label: "모멘텀" },
]

const MAX_AXIS_SCORE = 5
const MAX_TOTAL_SCORE = 25

/** 점수 구간별 바 색상 — 저채도 웜 톤 (세이지/앰버/테라코타) */
function barColorClass(score: number): string {
  if (score >= 4) return "bg-[#7D9B76]"
  if (score >= 2.5) return "bg-[#C9A227]"
  return "bg-[#C2571B]"
}

function ScoreTrack({ ratio, colorClass }: { ratio: number; colorClass: string }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <div
        className={cn("h-full rounded-full transition-all", colorClass)}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  )
}

export interface ChecklistPanelProps {
  scores: Scores
}

/**
 * 5축 체크리스트 — 가로 바 요약 + 아코디언을 펼치면
 * 각 축의 판정 근거(checks: label/pass/detail)를 ✓/✗로 노출한다.
 * "왜 이 점수인가"를 투명하게 보여주는 것이 핵심.
 */
export function ChecklistPanel({ scores }: ChecklistPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="text-lg">체크리스트 점수</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              5개 축 × 각 0~5점, 모든 판정 근거를 공개해요
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-bold text-foreground">
              {scores.total}
            </span>
            <span className="text-sm text-muted-foreground">
              {" "}
              / {MAX_TOTAL_SCORE}
            </span>
          </div>
        </div>
        <div className="pt-1">
          <ScoreTrack
            ratio={scores.total / MAX_TOTAL_SCORE}
            colorClass={barColorClass((scores.total / MAX_TOTAL_SCORE) * MAX_AXIS_SCORE)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {AXIS_META.map(({ key, label }) => {
            const axis = scores[key]
            const passedCount = axis.checks.filter((c) => c.pass).length
            return (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex-1 pr-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {axis.score}
                        </span>
                        /{MAX_AXIS_SCORE} · {passedCount}/{axis.checks.length}{" "}
                        통과
                      </span>
                    </div>
                    <div className="mt-2">
                      <ScoreTrack
                        ratio={axis.score / MAX_AXIS_SCORE}
                        colorClass={barColorClass(axis.score)}
                      />
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-2.5 pt-1">
                    {axis.checks.map((check, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                            check.pass
                              ? "bg-[#7D9B76]/15 text-[#4F6B4B]"
                              : "bg-[#D64545]/10 text-[#D64545]",
                          )}
                          aria-label={check.pass ? "통과" : "미달"}
                        >
                          {check.pass ? (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          ) : (
                            <X className="h-3 w-3" strokeWidth={3} />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {check.label}
                          </div>
                          <div className="text-xs leading-relaxed text-muted-foreground">
                            {check.detail}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
        <p className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          ✓는 기준 통과, ✗는 기준 미달이에요. 점수는 통과한 항목 수로
          계산돼요. 판정에 쓰인 실제 수치와 임계값을 함께 보여주므로 점수의
          근거를 직접 확인할 수 있어요.
        </p>
      </CardContent>
    </Card>
  )
}

export default ChecklistPanel
