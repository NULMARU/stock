import { HelpCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface MetricCardProps {
  /** 지표명 (한글, 예: "PER") */
  label: string
  /** 포맷된 값 문자열 (예: "31.5배", "N/A(적자)") */
  value: string
  /** N/A 여부 — true면 값을 흐리게 표시 */
  isNA?: boolean
  /** 한 줄 해석 (예: "높은 편 · 업종 중간값 31.5배와 비교") */
  interpretation: string
  /** glossary.json 용어 id */
  termId: string
  /** '이게 뭐예요?' 클릭 시 용어 모달 오픈 요청 */
  onOpenGlossary: (termId: string) => void
}

/**
 * 핵심 지표 카드 — 지표명, 값, 한 줄 해석, 용어 설명 버튼.
 * 버튼을 누류리면 부모(StockDetailPage)가 GlossaryTermModal을 연다.
 */
export function MetricCard({
  label,
  value,
  isNA = false,
  interpretation,
  termId,
  onOpenGlossary,
}: MetricCardProps) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <span className="pt-0.5 text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenGlossary(termId)}
            aria-label={`${label} 용어 설명 보기`}
            className="h-auto shrink-0 gap-1 rounded-full px-2 py-1 text-xs font-medium text-[#C2571B] hover:bg-[#C2571B]/10 hover:text-[#C2571B]"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            이게 뭐예요?
          </Button>
        </div>
        <div
          className={cn(
            "mt-1 font-bold tracking-tight",
            isNA ? "text-lg text-muted-foreground" : "text-2xl text-foreground",
          )}
        >
          {value}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {interpretation}
        </p>
      </CardContent>
    </Card>
  )
}

export default MetricCard
