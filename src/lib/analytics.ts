/**
 * 스페이스AI 스톡랩 — 사용 패턴 수집 (로컬 전용, 외부 전송 없음)
 *
 * 앱이 스스로 사용자 경험을 학습하기 위한 최소 통계.
 * 모든 데이터는 이 기기의 localStorage에만 저장된다.
 *
 * 수집 항목:
 * - launches: 앱 실행 횟수, firstUsedAt/lastUsedAt
 * - tabViews: 탭별 방문 횟수 (home/news/glossary/detail)
 * - stockViews: 종목 상세 조회 횟수 (티커 → 횟수)
 * - refreshClicks: 전체갱신 버튼 클릭 횟수
 */

const STORAGE_KEY = 'spaceai-stocklab:usage:v1'

export interface UsageStats {
  launches: number
  firstUsedAt: number
  lastUsedAt: number
  tabViews: Record<string, number>
  stockViews: Record<string, number>
  refreshClicks: number
}

const DEFAULT_STATS: UsageStats = {
  launches: 0,
  firstUsedAt: 0,
  lastUsedAt: 0,
  tabViews: {},
  stockViews: {},
  refreshClicks: 0,
}

function load(): UsageStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATS }
    const parsed = JSON.parse(raw) as Partial<UsageStats>
    return {
      launches: typeof parsed.launches === 'number' ? parsed.launches : 0,
      firstUsedAt: typeof parsed.firstUsedAt === 'number' ? parsed.firstUsedAt : 0,
      lastUsedAt: typeof parsed.lastUsedAt === 'number' ? parsed.lastUsedAt : 0,
      tabViews:
        parsed.tabViews && typeof parsed.tabViews === 'object' ? parsed.tabViews : {},
      stockViews:
        parsed.stockViews && typeof parsed.stockViews === 'object'
          ? parsed.stockViews
          : {},
      refreshClicks:
        typeof parsed.refreshClicks === 'number' ? parsed.refreshClicks : 0,
    }
  } catch {
    return { ...DEFAULT_STATS }
  }
}

function save(stats: UsageStats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // 저장 실패 시에도 수집은 포기하지 않음 (다음 기회에 저장)
  }
}

function mutate(fn: (s: UsageStats) => void) {
  const s = load()
  fn(s)
  s.lastUsedAt = Date.now()
  save(s)
}

/** 앱 실행 1회 기록 (첫 실행 시각 포함) */
export function trackLaunch() {
  mutate((s) => {
    s.launches += 1
    if (!s.firstUsedAt) s.firstUsedAt = Date.now()
  })
}

/** 탭 방문 기록 — 'home' | 'news' | 'glossary' | 'detail' */
export function trackTabView(tab: string) {
  mutate((s) => {
    s.tabViews[tab] = (s.tabViews[tab] ?? 0) + 1
  })
}

/** 종목 상세 조회 기록 */
export function trackStockView(ticker: string) {
  const key = ticker.toUpperCase()
  mutate((s) => {
    s.stockViews[key] = (s.stockViews[key] ?? 0) + 1
  })
}

/** 전체갱신 버튼 클릭 기록 */
export function trackRefreshClick() {
  mutate((s) => {
    s.refreshClicks += 1
  })
}

/** 현재 통계 스냅샷 (읽기 전용) */
export function getUsageStats(): UsageStats {
  return load()
}

/** 사용 패턴 기반 인사이트 요약 */
export interface UsageInsight {
  /** 가장 많이 본 종목 티커 (없으면 null) */
  topTicker: string | null
  topTickerViews: number
  /** 가장 많이 쓰는 탭 */
  topTab: string | null
  launches: number
  daysUsed: number
}

export function getUsageInsight(): UsageInsight {
  const s = load()
  const topStock = Object.entries(s.stockViews).sort((a, b) => b[1] - a[1])[0]
  const topTab = Object.entries(s.tabViews).sort((a, b) => b[1] - a[1])[0]
  const daysUsed =
    s.firstUsedAt > 0
      ? Math.max(1, Math.ceil((Date.now() - s.firstUsedAt) / 86_400_000))
      : 0
  return {
    topTicker: topStock ? topStock[0] : null,
    topTickerViews: topStock ? topStock[1] : 0,
    topTab: topTab ? topTab[0] : null,
    launches: s.launches,
    daysUsed,
  }
}
