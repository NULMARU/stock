/**
 * 스페이스AI 스톡랩 — 사용자 상태 스토어 (localStorage 기반)
 *
 * 저장 항목:
 * - hiddenTickers: 홈에서 '숨기기'한 기본 종목 티커
 * - addedStocks:   사용자가 직접 추가한 간이 종목
 * - newsChecked:   '뉴스 받기'를 체크한 티커
 * - newsCheckedAt: 체크한 시각 (대문자 티커 → epoch ms)
 *
 * 같은 탭 안에서는 커스텀 이벤트로, 다른 탭에서는 storage 이벤트로
 * 변경이 즉시 전파된다. React 쪽은 useSyncExternalStore로 구독한다.
 */

import { useSyncExternalStore } from 'react'
import type { UserAddedStock } from '@/types/stock'

const STORAGE_KEY = 'spaceai-stocklab:user:v1'
const CHANGE_EVENT = 'spaceai-stocklab:user-change'

export interface UserState {
  /** 홈에서 숨긴 기본 종목 티커 */
  hiddenTickers: string[]
  /** 사용자가 직접 추가한 간이 종목 */
  addedStocks: UserAddedStock[]
  /** '뉴스 받기' 체크한 티커 */
  newsChecked: string[]
  /** 체크 시각 — 대문자 티커 → epoch ms (체크 해제 시 제거) */
  newsCheckedAt: Record<string, number>
}

const DEFAULT_STATE: UserState = {
  hiddenTickers: [],
  addedStocks: [],
  newsChecked: [],
  newsCheckedAt: {},
}

function sanitize(parsed: Partial<UserState> | null): UserState {
  if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const newsChecked = strArray(parsed.newsChecked)

  // 마이그레이션: 시각 맵이 없던 구버전 데이터(배열만 저장)는
  // 배열 순서를 유지하도록 인덱스(ms)를 점진적 시각으로 부여
  const rawAt =
    parsed.newsCheckedAt && typeof parsed.newsCheckedAt === 'object'
      ? (parsed.newsCheckedAt as Record<string, unknown>)
      : {}
  const newsCheckedAt: Record<string, number> = {}
  newsChecked.forEach((ticker, i) => {
    const v = rawAt[ticker.toUpperCase()]
    newsCheckedAt[ticker.toUpperCase()] =
      typeof v === 'number' && Number.isFinite(v) ? v : i
  })

  return {
    hiddenTickers: strArray(parsed.hiddenTickers),
    addedStocks: Array.isArray(parsed.addedStocks)
      ? parsed.addedStocks.filter(
          (s): s is UserAddedStock =>
            !!s &&
            typeof s === 'object' &&
            typeof (s as UserAddedStock).ticker === 'string' &&
            typeof (s as UserAddedStock).name === 'string' &&
            Array.isArray((s as UserAddedStock).theme),
        )
      : [],
    newsChecked,
    newsCheckedAt,
  }
}

function load(): UserState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    return sanitize(JSON.parse(raw) as Partial<UserState>)
  } catch {
    return DEFAULT_STATE
  }
}

/** 모듈 레벨 단일 상태 — getSnapshot은 항상 이 참조를 반환해야 한다 */
let state: UserState = load()

function setState(next: UserState) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 용량 초과 등 저장에 실패하는 경우에도 메모리 상태는 유지
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      state = load()
      listener()
    }
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): UserState {
  return state
}

/** 티커 비교는 대소문자 무시 */
const sameTicker = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

// ── 액션 (모듈 함수 — 참조가 안정적이라 훅에서 그대로 반환) ─────────

/** 기본 종목 숨기기 */
export function hideTicker(ticker: string) {
  if (state.hiddenTickers.some((t) => sameTicker(t, ticker))) return
  setState({ ...state, hiddenTickers: [...state.hiddenTickers, ticker] })
}

/** 숨긴 종목 전부 복원 */
export function restoreHidden() {
  if (state.hiddenTickers.length === 0) return
  setState({ ...state, hiddenTickers: [] })
}

/** 간이 종목 추가 (같은 티커가 있으면 교체) */
export function addStock(stock: UserAddedStock) {
  const rest = state.addedStocks.filter((s) => !sameTicker(s.ticker, stock.ticker))
  setState({ ...state, addedStocks: [...rest, stock] })
}

/** 간이 종목 삭제 — 뉴스 체크도 함께 해제 */
export function removeAddedStock(ticker: string) {
  const newsCheckedAt = { ...state.newsCheckedAt }
  delete newsCheckedAt[ticker.toUpperCase()]
  setState({
    ...state,
    addedStocks: state.addedStocks.filter((s) => !sameTicker(s.ticker, ticker)),
    newsChecked: state.newsChecked.filter((t) => !sameTicker(t, ticker)),
    newsCheckedAt,
  })
}

/** 뉴스 받기 체크/해제 — 체크 시 현재 시각 기록, 해제 시 제거 */
export function setNewsChecked(ticker: string, checked: boolean) {
  const has = state.newsChecked.some((t) => sameTicker(t, ticker))
  if (checked && !has) {
    setState({
      ...state,
      newsChecked: [...state.newsChecked, ticker],
      newsCheckedAt: { ...state.newsCheckedAt, [ticker.toUpperCase()]: Date.now() },
    })
  } else if (!checked && has) {
    const newsCheckedAt = { ...state.newsCheckedAt }
    delete newsCheckedAt[ticker.toUpperCase()]
    setState({
      ...state,
      newsChecked: state.newsChecked.filter((t) => !sameTicker(t, ticker)),
      newsCheckedAt,
    })
  }
}

/** 체크 시각 조회 — 체크 안 된 종목은 undefined */
export function getCheckedAt(ticker: string): number | undefined {
  return state.newsCheckedAt[ticker.toUpperCase()]
}

/** React 훅 — 상태 + 액션을 한 번에 제공 */
export function useUserStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  return {
    ...snapshot,
    hideTicker,
    restoreHidden,
    addStock,
    removeAddedStock,
    setNewsChecked,
    getCheckedAt,
  }
}
