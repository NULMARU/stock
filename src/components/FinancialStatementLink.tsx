import { Link } from 'react-router'
import { FileText, ChevronRight } from 'lucide-react'
import type { Market } from '@/types/stock'

export function FinancialStatementLink({ ticker, market, name }: { ticker: string; market: Market; name: string }) {
  return (
    <Link
      to={`/stock/${encodeURIComponent(ticker)}/financials?market=${market}`}
      aria-label={`${name} (${ticker}) 재무제표 보기`}
      className="relative z-10 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <FileText className="h-4 w-4" aria-hidden />
      재무제표 보기
      <ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  )
}
