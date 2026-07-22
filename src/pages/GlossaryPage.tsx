import { useMemo, useState } from "react"
import { Search, Compass, ChevronRight } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { GlossaryTermModal } from "@/components/GlossaryTermModal"
import { TermQuiz } from "@/components/TermQuiz"
import type { GlossaryGroup, GlossaryTerm } from "@/types/stock"
import glossaryData from "@/data/glossary.json"

const terms = glossaryData as GlossaryTerm[]

/** 섹션 표시 순서와 화면 표기 */
const GROUP_SECTIONS: { key: GlossaryGroup; label: string }[] = [
  { key: "가치평가", label: "가치평가" },
  { key: "실적재무", label: "실적·재무" },
  { key: "주주환원", label: "주주환원" },
  { key: "시장수급", label: "시장·수급" },
]

export default function GlossaryPage() {
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return terms
    return terms.filter(
      (t) =>
        t.term.toLowerCase().includes(q) ||
        t.termEn.toLowerCase().includes(q),
    )
  }, [query])

  const openTerm = (id: string) => {
    setSelectedId(id)
    setModalOpen(true)
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1C1917]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* 헤더 */}
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">용어 사전</h1>
          <p className="mt-2 text-sm text-[#1C1917]/60">
            주식 공부에 꼭 필요한 용어 {terms.length}개를 초보자 눈높이로
            풀어냈어요.
          </p>
        </header>

        {/* 학습 가이드 배너 */}
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[#C2571B]/20 bg-[#C2571B]/5 p-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C2571B]/10 text-[#C2571B]">
            <Compass className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              숫자는 절대값보다 같은 업종 내 상대 비교가 중요해요
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[#1C1917]/70">
              PER 30배가 비싼지 싼지는 업종에 따라 달라져요. 각 용어 카드를
              열어 '높으면 · 낮으면' 해석과 흔한 오해까지 함께 확인해 보세요.
            </p>
          </div>
        </div>

        {/* 오늘의 용어 퀴즈 */}
        <TermQuiz />

        {/* 검색 */}
        <div className="relative mb-8 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1C1917]/40" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="용어 검색 (한글 또는 영문, 예: PER, 배당)"
            className="border-[#1C1917]/15 bg-white pl-9 focus-visible:ring-[#C2571B]/40"
          />
        </div>

        {/* 그룹별 섹션 */}
        {GROUP_SECTIONS.map(({ key, label }) => {
          const groupTerms = filtered.filter((t) => t.group === key)
          if (groupTerms.length === 0) return null
          return (
            <section key={key} className="mb-10">
              <div className="mb-4 flex items-baseline gap-2">
                <h2 className="text-lg font-bold">{label}</h2>
                <span className="text-xs text-[#1C1917]/50">
                  {groupTerms.length}개
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groupTerms.map((t) => (
                  <Card
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTerm(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        openTerm(t.id)
                      }
                    }}
                    className="cursor-pointer border-[#1C1917]/10 bg-white transition-all hover:-translate-y-0.5 hover:border-[#C2571B]/40 hover:shadow-md"
                  >
                    <CardContent className="flex h-full flex-col p-5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold leading-snug">
                          {t.term}
                        </h3>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#C2571B]" />
                      </div>
                      <p className="mt-0.5 text-xs text-[#1C1917]/50">
                        {t.termEn}
                      </p>
                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-[#1C1917]/70">
                        {t.definition}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )
        })}

        {filtered.length === 0 && (
          <p className="py-16 text-center text-sm text-[#1C1917]/50">
            '{query}'에 해당하는 용어가 없어요. 다른 단어로 검색해 보세요.
          </p>
        )}
      </div>

      <GlossaryTermModal
        termId={selectedId}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  )
}
