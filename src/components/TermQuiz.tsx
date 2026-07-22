import { useCallback, useMemo, useState } from "react"
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  AlertTriangle,
  RefreshCcw,
  Sparkles,
  XCircle,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { GlossaryTermModal } from "@/components/GlossaryTermModal"
import type { GlossaryTerm } from "@/types/stock"
import glossaryData from "@/data/glossary.json"

const terms = glossaryData as GlossaryTerm[]

/* ---------------------------------- 유틸 ---------------------------------- */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** misconception 앞부분의 '인용된 오해 주장' 추출 (없으면 null) */
function extractClaim(misconception: string): string | null {
  const m = misconception.match(/^'([^']+)'/)
  return m ? m[1] : null
}

/* -------------------------------- 문제 생성 -------------------------------- */

type QuizType = "definition" | "interpretation" | "ox"

const TYPE_LABEL: Record<QuizType, string> = {
  definition: "정의 맞히기",
  interpretation: "해석 시나리오",
  ox: "흔한 오해 OX",
}

interface QuizQuestion {
  type: QuizType
  term: GlossaryTerm
  prompt: string
  /** 객관식 보기 (definition/interpretation) */
  options: string[]
  correctIndex: number
  /** OX 정답 (ox) — 오해 주장이므로 항상 false(X) */
  oxAnswer: boolean
  statement: string
}

/** 같은 그룹 우선으로 오답 후보 용어 n개 선택 */
function pickDistractors(correct: GlossaryTerm, n: number): GlossaryTerm[] {
  const sameGroup = shuffle(terms.filter((t) => t.group === correct.group && t.id !== correct.id))
  const others = shuffle(terms.filter((t) => t.group !== correct.group))
  return [...sameGroup, ...others].slice(0, n)
}

function buildQuestion(term: GlossaryTerm, type: QuizType): QuizQuestion {
  if (type === "ox") {
    const claim = extractClaim(term.misconception)
    if (claim) {
      return {
        type,
        term,
        prompt: "투자자들이 흔히 하는 주장이에요. 맞으면 O, 틀리면 X!",
        options: [],
        correctIndex: -1,
        oxAnswer: false,
        statement: `'${claim}'`,
      }
    }
    // 인용구가 없는 용어는 정의 문제로 대체
    type = "definition"
  }

  if (type === "interpretation") {
    const distractors = pickDistractors(term, 3)
    const options = shuffle([term, ...distractors].map((t) => t.interpretation))
    return {
      type,
      term,
      prompt: `'${term.term}' 지표, 어떻게 해석하는 게 옳을까요?`,
      options,
      correctIndex: options.indexOf(term.interpretation),
      oxAnswer: false,
      statement: "",
    }
  }

  // definition
  const distractors = pickDistractors(term, 3)
  const options = shuffle([term, ...distractors].map((t) => t.term))
  return {
    type,
    term,
    prompt: "다음 정의에 해당하는 용어는 무엇일까요?",
    options,
    correctIndex: options.indexOf(term.term),
    oxAnswer: false,
    statement: term.definition,
  }
}

function generateQuiz(): QuizQuestion[] {
  const picked = shuffle(terms).slice(0, 3)
  const types = shuffle<QuizType>(["definition", "interpretation", "ox"])
  return picked.map((term, i) => buildQuestion(term, types[i]))
}

/* --------------------------------- 컴포넌트 -------------------------------- */

export function TermQuiz() {
  const [expanded, setExpanded] = useState(true)
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => generateQuiz())
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState<number | null>(null) // 객관식 선택 인덱스
  const [oxSelected, setOxSelected] = useState<boolean | null>(null)
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [reviewTermId, setReviewTermId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const question = questions[current]
  const isLast = current === questions.length - 1

  const isCorrect = useMemo(() => {
    if (!answered || !question) return false
    if (question.type === "ox") return oxSelected === question.oxAnswer
    return selected === question.correctIndex
  }, [answered, question, oxSelected, selected])

  const restart = useCallback(() => {
    setQuestions(generateQuiz())
    setCurrent(0)
    setSelected(null)
    setOxSelected(null)
    setAnswered(false)
    setScore(0)
    setFinished(false)
    setExpanded(true)
  }, [])

  const answer = (idx: number) => {
    if (answered) return
    setSelected(idx)
    setAnswered(true)
    if (idx === question.correctIndex) setScore((s) => s + 1)
  }

  const answerOx = (value: boolean) => {
    if (answered) return
    setOxSelected(value)
    setAnswered(true)
    if (value === question.oxAnswer) setScore((s) => s + 1)
  }

  const next = () => {
    if (isLast) {
      setFinished(true)
    } else {
      setCurrent((c) => c + 1)
    }
    setSelected(null)
    setOxSelected(null)
    setAnswered(false)
  }

  const openReview = (id: string) => {
    setReviewTermId(id)
    setModalOpen(true)
  }

  return (
    <Card className="mb-8 border-[#C2571B]/25 bg-white shadow-sm">
      <CardContent className="p-5">
        {/* 헤더 (접기/펼치기) */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C2571B]/10 text-[#C2571B]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-[#1C1917]">오늘의 용어 퀴즈</h2>
              <p className="text-xs text-[#1C1917]/50">
                랜덤 3문제로 용어 감각을 점검해 보세요
              </p>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[#1C1917]/40" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#1C1917]/40" />
          )}
        </button>

        {expanded && !finished && question && (
          <div className="mt-5">
            {/* 진행 표시 */}
            <div className="mb-3 flex items-center justify-between">
              <Badge
                variant="secondary"
                className="bg-[#C2571B]/10 text-[#C2571B] hover:bg-[#C2571B]/10"
              >
                {TYPE_LABEL[question.type]}
              </Badge>
              <span className="text-xs font-medium text-[#1C1917]/50">
                {current + 1} / {questions.length}
              </span>
            </div>

            {/* 문제 */}
            <p className="text-sm font-semibold leading-relaxed text-[#1C1917]">
              {question.prompt}
            </p>

            {question.type === "ox" ? (
              <div className="mt-3 rounded-xl bg-[#FAF7F2] p-4 text-center">
                <p className="text-sm leading-relaxed text-[#1C1917]/85">
                  {question.statement}
                </p>
              </div>
            ) : question.type === "definition" ? (
              <div className="mt-3 rounded-xl bg-[#FAF7F2] p-4">
                <p className="text-sm leading-relaxed text-[#1C1917]/85">
                  {question.statement}
                </p>
              </div>
            ) : null}

            {/* 보기 */}
            {question.type === "ox" ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[true, false].map((value) => {
                  const picked = answered && oxSelected === value
                  const isAnswer = value === question.oxAnswer
                  let cls =
                    "h-14 rounded-xl border text-xl font-bold transition-colors "
                  if (!answered) {
                    cls +=
                      "border-[#1C1917]/15 bg-white text-[#1C1917] hover:border-[#C2571B]/50 hover:bg-[#C2571B]/5"
                  } else if (isAnswer) {
                    cls += "border-green-600 bg-green-50 text-green-700"
                  } else if (picked) {
                    cls += "border-red-500 bg-red-50 text-red-600"
                  } else {
                    cls += "border-[#1C1917]/10 bg-white text-[#1C1917]/35"
                  }
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      disabled={answered}
                      onClick={() => answerOx(value)}
                      className={cls}
                    >
                      {value ? "O" : "X"}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {question.options.map((opt, i) => {
                  const picked = answered && selected === i
                  const isAnswer = answered && i === question.correctIndex
                  let cls =
                    "w-full rounded-xl border p-3 text-left text-sm leading-relaxed transition-colors "
                  if (!answered) {
                    cls +=
                      "border-[#1C1917]/15 bg-white text-[#1C1917] hover:border-[#C2571B]/50 hover:bg-[#C2571B]/5"
                  } else if (isAnswer) {
                    cls += "border-green-600 bg-green-50 text-green-800"
                  } else if (picked) {
                    cls += "border-red-500 bg-red-50 text-red-700"
                  } else {
                    cls += "border-[#1C1917]/10 bg-white text-[#1C1917]/40"
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={answered}
                      onClick={() => answer(i)}
                      className={cls}
                    >
                      <span className="mr-2 font-semibold text-[#C2571B]">
                        {["①", "②", "③", "④"][i]}
                      </span>
                      {opt}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 피드백 */}
            {answered && (
              <div className="mt-4 space-y-3">
                <div
                  className={`flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${
                    isCorrect
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  {isCorrect ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      정답이에요! '{question.term.term}'
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 shrink-0" />
                      아쉬워요. 정답은 '
                      {question.type === "ox"
                        ? "X (틀린 주장)"
                        : question.options[question.correctIndex]}
                      ' — 관련 용어: {question.term.term}
                    </>
                  )}
                </div>

                {/* 비유·오해 설명 */}
                <div className="space-y-2">
                  <div className="rounded-xl bg-[#FAF7F2] p-4">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C2571B]/10 text-[#C2571B]">
                        <Lightbulb className="h-3.5 w-3.5" />
                      </span>
                      <h4 className="text-sm font-semibold text-[#1C1917]">
                        쉬운 비유
                      </h4>
                    </div>
                    <p className="text-sm leading-relaxed text-[#1C1917]/80">
                      {question.term.analogy}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#FAF7F2] p-4">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C2571B]/10 text-[#C2571B]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </span>
                      <h4 className="text-sm font-semibold text-[#1C1917]">
                        흔한 오해
                      </h4>
                    </div>
                    <p className="text-sm leading-relaxed text-[#1C1917]/80">
                      {question.term.misconception}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openReview(question.term.id)}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#C2571B] transition-colors hover:text-[#C2571B]/80"
                  >
                    <BookOpen className="h-4 w-4" />
                    이 용어 카드 보기
                  </button>
                  <Button
                    onClick={next}
                    className="bg-[#C2571B] text-white hover:bg-[#C2571B]/90"
                  >
                    {isLast ? "결과 보기" : "다음 문제"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 결과 화면 */}
        {expanded && finished && (
          <div className="mt-5 text-center">
            <p className="text-3xl font-bold text-[#C2571B]">
              {score} / {questions.length}
            </p>
            <p className="mt-2 text-sm text-[#1C1917]/70">
              {questions.length}문제 중 {score}개를 맞혔어요!
              {score === questions.length
                ? " 완벽해요 🎉"
                : score >= 2
                  ? " 조금만 더 다듬으면 완벽해요."
                  : " 용어 카드로 복습하고 다시 도전해 보세요."}
            </p>

            <div className="mt-4 rounded-xl bg-[#FAF7F2] p-4 text-left">
              <p className="mb-2 text-sm font-semibold text-[#1C1917]">
                오늘 나온 용어 복습하기
              </p>
              <div className="flex flex-wrap gap-2">
                {questions.map((q) => (
                  <button
                    key={q.term.id}
                    type="button"
                    onClick={() => openReview(q.term.id)}
                    className="rounded-full border border-[#C2571B]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#C2571B] transition-colors hover:bg-[#C2571B]/10"
                  >
                    {q.term.term}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={restart}
              className="mt-4 bg-[#C2571B] text-white hover:bg-[#C2571B]/90"
            >
              <RefreshCcw className="mr-1.5 h-4 w-4" />
              다시 풀기
            </Button>
          </div>
        )}
      </CardContent>

      <GlossaryTermModal
        termId={reviewTermId}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </Card>
  )
}

export default TermQuiz
