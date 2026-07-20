import { Link } from "react-router-dom"
import {
  BookOpen,
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  ArrowRight,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import type { GlossaryTerm } from "@/types/stock"
import glossaryData from "@/data/glossary.json"

const terms = glossaryData as GlossaryTerm[]

/** 그룹 코드 → 화면 표기 */
const GROUP_LABEL: Record<GlossaryTerm["group"], string> = {
  가치평가: "가치평가",
  실적재무: "실적·재무",
  주주환원: "주주환원",
  시장수급: "시장·수급",
}

interface SectionProps {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}

function Section({ icon, title, children }: SectionProps) {
  return (
    <div className="rounded-xl bg-[#FAF7F2] p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C2571B]/10 text-[#C2571B]">
          {icon}
        </span>
        <h4 className="text-sm font-semibold text-[#1C1917]">{title}</h4>
      </div>
      <p className="text-sm leading-relaxed text-[#1C1917]/80">{children}</p>
    </div>
  )
}

export interface GlossaryTermModalProps {
  termId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 용어 상세 모달 — termId로 glossary.json에서 용어를 찾아
 * 정의/비유/해석/오해 4요소를 보여준다.
 * termId가 null이거나 용어를 찾지 못하면 아무것도 렌더링하지 않는다.
 */
export function GlossaryTermModal({
  termId,
  open,
  onOpenChange,
}: GlossaryTermModalProps) {
  const term = termId ? terms.find((t) => t.id === termId) : undefined

  if (!term) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-white sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-xl font-bold text-[#1C1917]">
              {term.term}
            </DialogTitle>
            <Badge
              variant="secondary"
              className="bg-[#C2571B]/10 text-[#C2571B] hover:bg-[#C2571B]/10"
            >
              {GROUP_LABEL[term.group]}
            </Badge>
          </div>
          <DialogDescription className="text-sm text-[#1C1917]/50">
            {term.termEn}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Section
            icon={<BookOpen className="h-3.5 w-3.5" />}
            title="한 줄 정의"
          >
            {term.definition}
          </Section>

          <Section
            icon={<Lightbulb className="h-3.5 w-3.5" />}
            title="쉬운 비유"
          >
            {term.analogy}
          </Section>

          <Section
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            title="높으면 · 낮으면"
          >
            {term.interpretation}
          </Section>

          <Section
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            title="흔한 오해"
          >
            {term.misconception}
          </Section>
        </div>

        <div className="mt-2 flex flex-col gap-2 border-t border-[#1C1917]/10 pt-4">
          {term.exampleTicker && (
            <Link
              to={`/stock/${term.exampleTicker}`}
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#C2571B] transition-colors hover:text-[#C2571B]/80"
            >
              실제 종목 예시 보기
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <a
            href={term.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[#1C1917]/50 transition-colors hover:text-[#1C1917]/80"
          >
            출처: {term.sourceUrl.replace(/^https?:\/\//, "").split("/")[0]}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default GlossaryTermModal
