import predictionsJson from '@/data/predictions.json'
import { useLiveData } from '@/lib/liveData'
import { cn } from '@/lib/utils'

/* ── predictions.json 스키마 ─────────────────────────────────── */

export interface PredictionComponent {
  name: string
  signal: string
  detail: string
}

export interface PredictionFeedback {
  date: string
  predicted: string
  actual: string
  hit: boolean
  returnPct: number
}

export interface PredictionEntry {
  predictedAt: string
  forDate: string
  direction: 'up' | 'down' | 'flat'
  /** 0~100 (또는 0~1 소수) 확률 */
  probability: number
  expectedReturnPct: number
  band: { low: number; high: number }
  close: number
  components: PredictionComponent[]
  lastFeedback: PredictionFeedback | null
}

export interface PredictionData {
  /** 기준일 YYYY-MM-DD (수집 전이면 빈 문자열) */
  asOf: string
  methodologyVersion: string
  model: {
    weights?: Record<string, number>
    hitRate20?: number | null
    hitRateAll?: number | null
    evaluated?: number
  }
  entries: Record<string, PredictionEntry>
}

const bundledPredictions = predictionsJson as PredictionData

/** 로컬 오늘 날짜 문자열 (YYYY-MM-DD) */
function localToday(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** entries 키는 대소문자 무시하고 조회 */
function findEntry(
  entries: Record<string, PredictionEntry>,
  ticker: string,
): PredictionEntry | undefined {
  if (entries[ticker]) return entries[ticker]
  const upper = ticker.toUpperCase()
  if (entries[upper]) return entries[upper]
  const key = Object.keys(entries).find((k) => k.toUpperCase() === upper)
  return key ? entries[key] : undefined
}

/** 방향별 표시 — 한국 관습: 상승 빨강 / 하락 파랑 / 보합 회색 */
const DIRECTION_STYLE: Record<
  PredictionEntry['direction'],
  { arrow: string; label: string; className: string }
> = {
  up: { arrow: '▲', label: '상승', className: 'bg-stock-up text-white' },
  down: { arrow: '▼', label: '하락', className: 'bg-stock-down text-white' },
  flat: { arrow: '', label: '보합', className: 'bg-muted text-muted-foreground' },
}

interface PredictionChipProps {
  ticker: string
  /** '뉴스 받기' 체크 여부 — false면 칩 숨김 */
  isChecked: boolean
}

/**
 * AI 예측 칩 — 체크된 종목에만 'AI예측 ▲상승 62%' 형태로 표시.
 * predictions.json의 entries에 티커가 없거나 asOf가 오늘(로컬 날짜)이 아니면 숨김.
 */
export function PredictionChip({ ticker, isChecked }: PredictionChipProps) {
  const { data } = useLiveData<PredictionData>('predictions.json', bundledPredictions)

  if (!isChecked) return null
  if (!data || data.asOf.slice(0, 10) !== localToday()) return null

  const entry = findEntry(data.entries, ticker)
  if (!entry || !Number.isFinite(entry.probability)) return null

  // 확률이 0~1 소수로 올 수도 있어 정규화
  const prob = entry.probability <= 1 ? entry.probability * 100 : entry.probability
  const pct = Math.round(prob)
  const style = DIRECTION_STYLE[entry.direction] ?? DIRECTION_STYLE.flat

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
        style.className,
      )}
      title={`AI 예측 (${data.asOf} 기준) · 예상 ${entry.expectedReturnPct > 0 ? '+' : ''}${entry.expectedReturnPct}%`}
    >
      AI예측 {style.arrow}
      {style.label} {pct}%
    </span>
  )
}

export default PredictionChip
