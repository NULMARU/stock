/**
 * 스페이스AI 스톡랩 — 나의 판단 일기 패널 (종목 상세용)
 *
 * "이 종목, 내일 오를까?"를 사용자가 직접 예측·기록하고, 며칠 뒤 실제
 * 등락과 비교해 채점받는 학습 장치. 앱의 예측 모델이 매일 채점받으며
 * 개선되는 것처럼, 사용자에게도 같은 피드백 고리를 제공한다.
 *
 * - 기록: src/lib/judgments.ts (localStorage 전용, 외부 전송 없음)
 * - 채점: useLiveData('stocks.json') 라이브 데이터로 실제 등락을 조회
 * - 표시: 상단 누적 적중률 + 오늘의 예측 입력(수정 가능) + 과거 예측 리스트
 */

import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  ClipboardPen,
  Hourglass,
  Trash2,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import rawStocks from "@/data/stocks.json"
import { changeColorClass, formatChangePct } from "@/lib/format"
import {
  NOTE_MAX_LENGTH,
  calcHitRate,
  deleteJudgment,
  findJudgment,
  gradeJudgments,
  listJudgments,
  localTomorrow,
  saveJudgment,
  useJudgments,
  type JudgmentDirection,
} from "@/lib/judgments"
import { useLiveData } from "@/lib/liveData"
import { cn } from "@/lib/utils"
import type { StockEntry } from "@/types/stock"

const bundledStocks = rawStocks as StockEntry[]

/** 예측 방향 버튼/배지 스타일 — 한국 관습: 상승 빨강 / 하락 파랑 / 보합 회색 */
const DIRECTION_META: Record<
  JudgmentDirection,
  { label: string; arrow: string; badgeClass: string }
> = {
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

/** 채점 결과 배지 스타일 — 적중 빨강 계열 / 빗나감 파랑 계열 / 대기 회색 */
const GRADE_META = {
  hit: {
    label: "적중 ✓",
    badgeClass: "border-[#D64545]/40 bg-[#D64545]/10 text-[#D64545]",
  },
  miss: {
    label: "빗나감 ✗",
    badgeClass: "border-[#2563EB]/40 bg-[#2563EB]/10 text-[#2563EB]",
  },
  pending: {
    label: "대기중",
    badgeClass: "border-border bg-muted text-muted-foreground",
  },
} as const

const DIRECTION_ORDER: JudgmentDirection[] = ["up", "flat", "down"]

export interface MyJudgmentPanelProps {
  /** Yahoo Finance 형식 티커 (예: "TSLA", "005930.KS") */
  ticker: string
}

export function MyJudgmentPanel({ ticker }: MyJudgmentPanelProps) {
  // 채점용 라이브 주가 데이터 (실패 시 번들 fallback)
  const { data: stocks } = useLiveData<StockEntry[]>("stocks.json", bundledStocks)
  const { judgments } = useJudgments()

  // 새 예측의 대상일은 내일 — 이미 내일 예측을 기록했으면 수정 모드
  const forDate = useMemo(() => localTomorrow(), [])
  const existing = useMemo(() => findJudgment(ticker, forDate), [ticker, forDate, judgments])

  const [direction, setDirection] = useState<JudgmentDirection | null>(null)
  const [note, setNote] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)

  // 기존 기록이 바뀌면 입력란을 그 값으로 동기화 (수정 모드 진입/해제)
  useEffect(() => {
    setDirection(existing?.direction ?? null)
    setNote(existing?.note ?? "")
  }, [existing])

  // 이 종목의 과거 예측 + 채점 (최신순)
  const graded = useMemo(
    () => gradeJudgments(listJudgments(ticker), stocks),
    [judgments, stocks, ticker],
  )
  const hitRate = useMemo(() => calcHitRate(graded), [graded])

  const canSave = direction !== null

  const handleSave = () => {
    if (!direction) return
    saveJudgment({ ticker, direction, note, forDate })
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardPen className="h-5 w-5 text-[#C2571B]" aria-hidden />
              나의 판단 일기
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              예측을 기록하고 채점받으면 판단력이 늘어요
            </p>
          </div>
          {/* 누적 적중률 — 채점 완료된 예측 기준 (대기중 제외) */}
          <Badge
            variant="outline"
            className="border-border bg-secondary px-2.5 py-1 text-sm font-semibold text-secondary-foreground"
          >
            나의 적중률{" "}
            {hitRate.rate != null
              ? `${hitRate.hits}/${hitRate.evaluated} (${hitRate.rate}%)`
              : "아직 없음"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 오늘의 예측 입력 */}
        <div className="space-y-3 rounded-lg border bg-muted/40 px-3 py-3">
          <p className="text-sm font-medium text-foreground">
            {forDate}에 이 종목은 어떻게 될까요?
            {existing && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (기록한 예측이 있어요 — 다시 저장하면 덮어써요)
              </span>
            )}
          </p>

          {/* 방향 3버튼 */}
          <div className="flex gap-2" role="group" aria-label="예측 방향 선택">
            {DIRECTION_ORDER.map((d) => {
              const meta = DIRECTION_META[d]
              const selected = direction === d
              return (
                <Button
                  key={d}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={selected}
                  onClick={() => setDirection(d)}
                  className={cn(
                    "flex-1",
                    selected
                      ? cn(meta.badgeClass, "font-semibold ring-1 ring-current")
                      : "text-muted-foreground",
                  )}
                >
                  {meta.arrow} {meta.label}
                </Button>
              )
            })}
          </div>

          {/* 이유 한 줄 + 기록 버튼 */}
          <div className="flex items-center gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX_LENGTH))}
              placeholder="왜 그렇게 생각해요? (한 줄 이유)"
              maxLength={NOTE_MAX_LENGTH}
              aria-label="예측 이유"
            />
            <Button
              type="button"
              size="sm"
              disabled={!canSave}
              onClick={handleSave}
              className="shrink-0"
            >
              {existing ? "수정하기" : "기록하기"}
            </Button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{savedFlash ? "저장했어요 ✓" : "방향을 고르면 기록할 수 있어요"}</span>
            <span className="tabular-nums">
              {note.length}/{NOTE_MAX_LENGTH}
            </span>
          </div>
        </div>

        {/* 과거 예측 리스트 */}
        {graded.length > 0 ? (
          <ul className="space-y-2">
            {graded.map((g) => {
              const dir = DIRECTION_META[g.direction]
              const grade = GRADE_META[g.grade]
              return (
                <li key={g.id} className="rounded-lg border bg-card px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground tabular-nums">
                      {g.forDate}
                    </span>
                    <Badge variant="outline" className={dir.badgeClass}>
                      {dir.arrow} {dir.label} 예측
                    </Badge>
                    <Badge variant="outline" className={grade.badgeClass}>
                      {g.grade === "hit" && (
                        <CheckCircle2 className="mr-0.5 h-3.5 w-3.5" aria-hidden />
                      )}
                      {g.grade === "miss" && (
                        <XCircle className="mr-0.5 h-3.5 w-3.5" aria-hidden />
                      )}
                      {g.grade === "pending" && (
                        <Hourglass className="mr-0.5 h-3.5 w-3.5" aria-hidden />
                      )}
                      {grade.label}
                    </Badge>
                    {g.actualChangePct != null && (
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          changeColorClass(g.actualChangePct),
                        )}
                      >
                        실제 {formatChangePct(g.actualChangePct)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteJudgment(g.id)}
                      aria-label={`${g.forDate} 예측 삭제`}
                      className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  {g.note && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {g.note}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            아직 기록한 예측이 없어요. 첫 예측을 남겨보세요!
          </p>
        )}
      </CardContent>
    </Card>
  )
}
