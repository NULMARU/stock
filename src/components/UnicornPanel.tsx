import { useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import type { UnicornData, UnicornEntry, UnicornGrade, UnicornPillar } from '@/types/stock'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  changeColorClass,
  formatChange,
  formatMarketCap,
  formatPrice,
  MARKET_BADGE_CLASS,
  MARKET_LABEL,
} from '@/lib/format'
import { cn } from '@/lib/utils'

/** 3축 메타 — 밸류에이션 40 / 퀄리티 35 / 성장 25 */
const PILLAR_META: { key: keyof UnicornEntry['pillars']; label: string; max: number }[] = [
  { key: 'valuation', label: '밸류에이션', max: 40 },
  { key: 'quality', label: '퀄리티', max: 35 },
  { key: 'growth', label: '성장', max: 25 },
]

const GRADE_META: Record<UnicornGrade, { label: string; className: string }> = {
  A: { label: 'A', className: 'border-[#7D9B76]/40 bg-[#7D9B76]/15 text-[#4F6B4B]' },
  B: { label: 'B', className: 'border-[#C9A227]/40 bg-[#C9A227]/15 text-[#8A6D14]' },
  C: { label: 'C', className: 'border-[#C2571B]/40 bg-[#C2571B]/10 text-[#C2571B]' },
}

/** 지표 키 → 한국어 라벨 */
const METRIC_LABELS: Record<string, string> = {
  trailingPE: 'PER',
  forwardPE: 'Forward PER',
  priceToBook: 'PBR',
  priceToSales: 'PSR',
  peg: 'PEG',
  roe: 'ROE',
  profitMargin: '순이익률',
  operatingMargin: '영업이익률',
  debtToEquity: '부채비율',
  revenueGrowth: '매출성장률',
  earningsGrowth: '이익성장률',
  dividendYield: '배당수익률',
  beta: '베타',
  totalRevenue: '매출',
}

/** 소수 단위(0.25 = 25%)로 저장되는 비율 지표 */
const RATIO_KEYS = new Set([
  'roe',
  'profitMargin',
  'operatingMargin',
  'revenueGrowth',
  'earningsGrowth',
  'dividendYield',
])
/** 배수 단위 지표 */
const MULTIPLE_KEYS = new Set(['trailingPE', 'forwardPE', 'priceToBook', 'priceToSales', 'peg'])

function formatMetric(key: string, value: number | null): string {
  if (value == null || Number.isNaN(value)) return 'N/A'
  if (RATIO_KEYS.has(key)) return `${(value * 100).toFixed(1)}%`
  if (key === 'debtToEquity') return `${value.toFixed(0)}%`
  if (MULTIPLE_KEYS.has(key)) return `${value.toFixed(1)}배`
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

/** 점수 비율별 바 색상 — 저채도 웜 톤 (ChecklistPanel과 동일 팔레트) */
function barColorClass(ratio: number): string {
  if (ratio >= 0.8) return 'bg-[#7D9B76]'
  if (ratio >= 0.5) return 'bg-[#C9A227]'
  return 'bg-[#C2571B]'
}

function PillarTrack({ pillar }: { pillar: UnicornPillar }) {
  const ratio = pillar.max > 0 ? pillar.score / pillar.max : 0
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={pillar.max}
      aria-valuenow={pillar.score}
    >
      <div
        className={cn('h-full rounded-full transition-all', barColorClass(ratio))}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  )
}

function UnicornCard({ entry, onOpen }: { entry: UnicornEntry; onOpen: () => void }) {
  const grade = GRADE_META[entry.grade] ?? GRADE_META.C
  return (
    <button type="button" onClick={onOpen} className="block text-left focus:outline-none">
      <Card className="flex h-full flex-col gap-3 rounded-xl border-border/70 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-ring">
        {/* 상단: 시장 배지 + 등급/총점 */}
        <div className="flex items-center justify-between gap-2">
          <Badge
            className={cn(
              'border-0 px-2 py-0.5 text-[11px] font-medium text-white',
              MARKET_BADGE_CLASS[entry.market],
            )}
          >
            {MARKET_LABEL[entry.market] ?? entry.market}
          </Badge>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={cn('px-2 py-0.5 text-[11px] font-bold', grade.className)}>
              등급 {grade.label}
            </Badge>
            <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-semibold tabular-nums">
              {entry.totalScore}
              <span className="opacity-70">/100</span>
            </Badge>
          </div>
        </div>

        {/* 이름 + 티커 */}
        <div>
          <h3 className="text-base font-semibold leading-snug text-foreground">{entry.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {entry.nameEn} · <span className="font-mono">{entry.ticker}</span>
          </p>
        </div>

        {/* 가격 + 등락 */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-bold tabular-nums text-foreground">
            {formatPrice(entry.quote.price, entry.currency)}
          </span>
          <span className={cn('text-sm font-semibold tabular-nums', changeColorClass(entry.quote.changePct))}>
            {formatChange(entry.quote.changePct)}
          </span>
        </div>

        {/* 선정 이유 상위 2개 */}
        {entry.reasons.length > 0 && (
          <ul className="mt-auto space-y-1 border-t border-border/60 pt-2.5">
            {entry.reasons.slice(0, 2).map((reason, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-[#C2571B]" aria-hidden />
                {reason}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </button>
  )
}

function UnicornDetailDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: UnicornEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!entry) return null
  const grade = GRADE_META[entry.grade] ?? GRADE_META.C
  const metricEntries = Object.entries(entry.metrics ?? {})

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              className={cn(
                'border-0 px-2 py-0.5 text-[11px] font-medium text-white',
                MARKET_BADGE_CLASS[entry.market],
              )}
            >
              {MARKET_LABEL[entry.market] ?? entry.market}
            </Badge>
            <Badge variant="outline" className={cn('px-2 py-0.5 text-[11px] font-bold', grade.className)}>
              등급 {grade.label}
            </Badge>
            <Badge variant="secondary" className="px-2 py-0.5 text-[11px] font-semibold tabular-nums">
              총점 {entry.totalScore}/100
            </Badge>
          </div>
          <DialogTitle>
            {entry.name}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {entry.nameEn} · <span className="font-mono">{entry.ticker}</span>
            </span>
          </DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 시세 요약 */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="font-bold tabular-nums text-foreground">
              {formatPrice(entry.quote.price, entry.currency)}
            </span>
            <span className={cn('font-semibold tabular-nums', changeColorClass(entry.quote.changePct))}>
              {formatChange(entry.quote.changePct)}
            </span>
            <span className="text-muted-foreground">
              시가총액 {formatMarketCap(entry.quote.marketCap, entry.currency)}
            </span>
          </div>

          {/* 3축 점수 + 체크 아코디언 */}
          <section>
            <h4 className="mb-2 text-sm font-bold text-foreground">3축 평가 근거</h4>
            <Accordion type="multiple" className="w-full">
              {PILLAR_META.map(({ key, label, max }) => {
                const pillar = entry.pillars[key]
                const passedCount = pillar.checks.filter((c) => c.pass).length
                return (
                  <AccordionItem key={key} value={key}>
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="flex-1 pr-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {label}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              (만점 {max})
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{pillar.score}</span>
                            /{pillar.max} · {passedCount}/{pillar.checks.length} 통과
                          </span>
                        </div>
                        <div className="mt-2">
                          <PillarTrack pillar={pillar} />
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2.5 pt-1">
                        {pillar.checks.map((check, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span
                              className={cn(
                                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                                check.pass
                                  ? 'bg-[#7D9B76]/15 text-[#4F6B4B]'
                                  : 'bg-[#D64545]/10 text-[#D64545]',
                              )}
                              aria-label={check.pass ? '통과' : '미달'}
                            >
                              {check.pass ? (
                                <Check className="h-3 w-3" strokeWidth={3} />
                              ) : (
                                <X className="h-3 w-3" strokeWidth={3} />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">{check.label}</div>
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
          </section>

          {/* 주요 지표 표 */}
          {metricEntries.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-bold text-foreground">주요 지표</h4>
              <div className="rounded-lg border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/2">지표</TableHead>
                      <TableHead className="text-right">값</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metricEntries.map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="text-sm">{METRIC_LABELS[key] ?? key}</TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">
                          {formatMetric(key, value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {/* 선정 이유 전체 */}
          {entry.reasons.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-bold text-foreground">선정 이유</h4>
              <ul className="space-y-1.5">
                {entry.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm leading-relaxed text-foreground">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C2571B]" aria-hidden />
                    {reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 리스크 */}
          {entry.risks.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-bold text-foreground">주의할 리스크</h4>
              <ul className="space-y-1.5">
                {entry.risks.map((risk, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-[#C2571B]/30 bg-[#C2571B]/5 px-3 py-2 text-xs leading-relaxed text-foreground"
                  >
                    ⚠ {risk}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 출처 노트 */}
          {entry.sourceNotes.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-bold text-foreground">데이터 출처</h4>
              <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                {entry.sourceNotes.map((note, i) => (
                  <li key={i}>· {note}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export interface UnicornPanelProps {
  data: UnicornData
}

/** 멋주 탭 — 저평가·내실·성장 3축 알고리즘 평가 통과 종목 */
export function UnicornPanel({ data }: UnicornPanelProps) {
  const [selected, setSelected] = useState<UnicornEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const openDetail = (entry: UnicornEntry) => {
    setSelected(entry)
    setDetailOpen(true)
  }

  return (
    <div>
      {/* 평가 요약 헤더 */}
      <div className="mb-4 rounded-xl border border-border/70 bg-card/60 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">
          멋주(멋진 주식) · 저평가·내실·성장 3축 알고리즘 평가 통과 종목 (매주 토요일 갱신)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          평가 {data.evaluated}개 중 {data.passed.length}개 통과
          {data.asOf && <span className="ml-1">· 기준일 {data.asOf}</span>}
          {data.methodologyVersion && (
            <span className="ml-1">· 방법론 v{data.methodologyVersion}</span>
          )}
        </p>
      </div>

      {data.passed.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.passed.map((entry) => (
            <UnicornCard key={entry.ticker} entry={entry} onOpen={() => openDetail(entry)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card/60 py-16 text-center text-sm text-muted-foreground">
          아직 평가 통과 종목이 없어요. 다음 주간 평가(매주 토요일)를 기다려 주세요.
        </div>
      )}

      <UnicornDetailDialog entry={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  )
}

export default UnicornPanel
