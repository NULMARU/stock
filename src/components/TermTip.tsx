import { useState } from "react"
import type { ReactNode } from "react"

import { GlossaryTermModal } from "@/components/GlossaryTermModal"
import type { GlossaryTerm } from "@/types/stock"
import glossaryData from "@/data/glossary.json"

const terms = glossaryData as GlossaryTerm[]

export interface TermTipProps {
  termId: string
  /** 표시 텍스트 — 생략 시 용어의 한글명(term)이 표시됨 */
  children?: ReactNode
}

/**
 * 인라인 용어 칩 — 밑줄 점선 스타일 버튼.
 * 클릭하면 GlossaryTermModal이 열린다. 모든 페이지에서 재사용 가능.
 *
 * 예: <TermTip termId="per" /> 또는 <TermTip termId="per">PER</TermTip>
 */
export function TermTip({ termId, children }: TermTipProps) {
  const [open, setOpen] = useState(false)
  const term = terms.find((t) => t.id === termId)

  if (!term) return <>{children ?? termId}</>

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit underline decoration-[#C2571B] decoration-dotted decoration-2 underline-offset-4 transition-colors hover:text-[#C2571B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C2571B]/40 rounded-sm"
      >
        {children ?? term.term}
      </button>
      <GlossaryTermModal
        termId={termId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

export default TermTip
