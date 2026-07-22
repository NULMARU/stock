import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ThemeFilterProps {
  /** [테마명, 종목 수] — 빈도 내림차순 */
  themes: [string, number][]
  /** 선택된 테마 (null = 전체) */
  value: string | null
  onChange: (theme: string | null) => void
}

/** 테마 필터 — 왼쪽 '전체테마' 고정 버튼 + 오른쪽 테마 콤보박스 */
export function ThemeFilter({ themes, value, onChange }: ThemeFilterProps) {
  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          value === null
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
        )}
      >
        전체테마
      </button>

      <Select value={value ?? ''} onValueChange={(v) => onChange(v || null)}>
        <SelectTrigger className="w-[220px] bg-card" aria-label="테마 선택">
          <SelectValue placeholder="테마 선택" />
        </SelectTrigger>
        <SelectContent>
          {themes.map(([t, count]) => (
            <SelectItem key={t} value={t}>
              {t} ({count})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default ThemeFilter
