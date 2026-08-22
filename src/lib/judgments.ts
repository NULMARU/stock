/**
 * 스페이스AI 스톡랩 — 나의 판단 일기 스토어 (localStorage 기반)
 *
 * 사용자가 "이 종목, 내일 오를까?"를 예측·기록해 두면, 며칠 뒤 실제 등락과
 * 비교해 채점해 주는 학습 장치. 데이터는 브라우저 localStorage에만 저장되고
 * 외부로 전송되지 않는다.
 *
 * 저장 형식:
 * - Judgment[] 배열을 통째로 JSON 직렬화
 * - 같은 ticker + forDate 조합의 예측은 하나만 유지 (재기록 시 덮어쓰기)
 *
 * 채점 규칙 (stocks.json 데이터 기준):
 * - forDate가 종목 데이터 기준일(asOf)이면 quote.changePct 사용
 * - 그보다 과거면 priceHistory에서 forDate 이하 마지막 포인트 종가 vs
 *   그 직전 포인트 종가로 등락률 계산 (priceHistory는 주 1회 샘플링이라
 *   정확히 일치하는 날짜가 없을 수 있어 '이하 마지막 포인트'로 흡수)
 * - 실제 등락률 절댓값이 0.5% 이내면 실제 방향을 'flat'(보합)으로 간주
 * - 결과: 'hit' | 'miss' | 'pending' (미래 날짜, 주말 등 데이터 부재)
 */

import { useSyncExternalStore } from 'react'
import type { StockEntry } from '@/types/stock'

const STORAGE_KEY = 'spaceai-stocklab:judgments:v1'
const CHANGE_EVENT = 'spaceai-stocklab:judgments-change'

/** 이유(note) 최대 글자 수 */
export const NOTE_MAX_LENGTH = 100

/** 실제 등락률 절댓값이 이 값(%) 이내면 보합으로 간주 */
export const FLAT_THRESHOLD_PCT = 0.5

export type JudgmentDirection = 'up' | 'flat' | 'down'

export interface Judgment {
  /** 고유 id */
  id: string
  /** Yahoo Finance 형식 티커 (예: "TSLA", "005930.KS") */
  ticker: string
  /** 예측을 기록한 시각 (ISO 8601) */
  predictedAt: string
  /** 예측 대상일 YYYY-MM-DD (보통 기록 익일) */
  forDate: string
  /** 내가 예측한 방향 */
  direction: JudgmentDirection
  /** 예측 이유 한 줄 (최대 100자) */
  note: string
}

export type GradeResult = 'hit' | 'miss' | 'pending'

/** 채점이 끝난(또는 대기 중인) 예측 레코드 */
export interface GradedJudgment extends Judgment {
  grade: GradeResult
  /** 실제 방향 — 아직 결과를 알 수 없으면 null */
  actualDirection: JudgmentDirection | null
  /** 실제 등락률 (퍼센트 단위) — 모르면 null */
  actualChangePct: number | null
}

// ── 날짜 유틸 ─────────────────────────────────────────────

/** 로컬 기준 오늘 YYYY-MM-DD */
export function localToday(): string {
  return toDateStr(new Date())
}

/** 로컬 기준 익일 YYYY-MM-DD — 새 예측의 기본 대상일 */
export function localTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return toDateStr(d)
}

function toDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ── 저장소 (localStorage + useSyncExternalStore 패턴, userStore.ts 참고) ──

const DIRECTIONS: JudgmentDirection[] = ['up', 'flat', 'down']

function sanitize(parsed: unknown): Judgment[] {
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (j): j is Judgment =>
        !!j &&
        typeof j === 'object' &&
        typeof (j as Judgment).id === 'string' &&
        typeof (j as Judgment).ticker === 'string' &&
        typeof (j as Judgment).predictedAt === 'string' &&
        typeof (j as Judgment).forDate === 'string' &&
        DIRECTIONS.includes((j as Judgment).direction) &&
        typeof (j as Judgment).note === 'string',
    )
    .map((j) => ({ ...j, note: j.note.slice(0, NOTE_MAX_LENGTH) }))
}

function load(): Judgment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return sanitize(JSON.parse(raw))
  } catch {
    return []
  }
}

/** 모듈 레벨 단일 상태 — getSnapshot은 항상 이 참조를 반환해야 한다 */
let state: Judgment[] = load()

function setState(next: Judgment[]) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 용량 초과 등 저장에 실패해도 메모리 상태는 유지
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

function getSnapshot(): Judgment[] {
  return state
}

const sameTicker = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── 액션 ─────────────────────────────────────────────────

export interface SaveJudgmentInput {
  ticker: string
  direction: JudgmentDirection
  /** 예측 이유 (100자로 잘림, 빈 문자열 허용) */
  note: string
  /** 예측 대상일 — 생략 시 로컬 기준 익일 */
  forDate?: string
}

/**
 * 예측 기록 — 같은 ticker + forDate 예측이 이미 있으면 덮어쓴다.
 * 덮어쓸 때도 id와 predictedAt은 새로 부여한다 (수정 시각이 곧 최신 기록).
 */
export function saveJudgment(input: SaveJudgmentInput): Judgment {
  const forDate = input.forDate ?? localTomorrow()
  const record: Judgment = {
    id: newId(),
    ticker: input.ticker,
    predictedAt: new Date().toISOString(),
    forDate,
    direction: input.direction,
    note: input.note.trim().slice(0, NOTE_MAX_LENGTH),
  }
  const rest = state.filter(
    (j) => !(sameTicker(j.ticker, record.ticker) && j.forDate === forDate),
  )
  setState([...rest, record])
  return record
}

/** 예측 삭제 */
export function deleteJudgment(id: string) {
  if (!state.some((j) => j.id === id)) return
  setState(state.filter((j) => j.id !== id))
}

/** 목록 조회 — 최신순 (예측 대상일 → 기록 시각 내림차순). ticker 주면 해당 종목만 */
export function listJudgments(ticker?: string): Judgment[] {
  const filtered = ticker
    ? state.filter((j) => sameTicker(j.ticker, ticker))
    : state
  return [...filtered].sort((a, b) =>
    a.forDate === b.forDate
      ? b.predictedAt.localeCompare(a.predictedAt)
      : b.forDate.localeCompare(a.forDate),
  )
}

/** 같은 ticker + forDate 기존 예측 조회 (수정 모드 판별용) */
export function findJudgment(ticker: string, forDate: string): Judgment | undefined {
  return state.find((j) => sameTicker(j.ticker, ticker) && j.forDate === forDate)
}

// ── 채점 ─────────────────────────────────────────────────

/**
 * forDate의 실제 등락률(%)을 stocks 데이터에서 찾는다.
 * - forDate === asOf(데이터 기준일): quote.changePct
 * - forDate < asOf: priceHistory에서 forDate 이하 마지막 포인트와
 *   그 직전 포인트의 종가로 계산
 * - forDate > asOf(아직 오지 않은 날): null
 */
export function actualChangePctFor(stock: StockEntry, forDate: string): number | null {
  if (forDate === stock.asOf) {
    return stock.quote.changePct
  }
  if (forDate > stock.asOf) return null

  const hist = stock.priceHistory
  // priceHistory는 날짜 오름차순 — forDate 이하인 마지막 포인트 탐색
  let idx = -1
  for (let i = 0; i < hist.length; i++) {
    if (hist[i].date <= forDate) idx = i
    else break
  }
  if (idx < 1) return null // 비교할 직전 포인트가 없음
  const prev = hist[idx - 1].close
  const cur = hist[idx].close
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

/** 등락률 → 방향 (±0.5% 이내는 보합) */
export function directionFromChangePct(changePct: number): JudgmentDirection {
  if (Math.abs(changePct) <= FLAT_THRESHOLD_PCT) return 'flat'
  return changePct > 0 ? 'up' : 'down'
}

/**
 * 예측 1건 채점 — 해당 종목 데이터를 넘긴다. 종목 데이터가 없거나
 * 아직 결과가 나오지 않았으면 'pending'.
 */
export function gradeJudgment(
  judgment: Judgment,
  stock: StockEntry | undefined,
): GradedJudgment {
  if (!stock) {
    return { ...judgment, grade: 'pending', actualDirection: null, actualChangePct: null }
  }
  const pct = actualChangePctFor(stock, judgment.forDate)
  if (pct == null || Number.isNaN(pct)) {
    return { ...judgment, grade: 'pending', actualDirection: null, actualChangePct: null }
  }
  const actualDirection = directionFromChangePct(pct)
  return {
    ...judgment,
    grade: actualDirection === judgment.direction ? 'hit' : 'miss',
    actualDirection,
    actualChangePct: pct,
  }
}

/** 예측 목록 일괄 채점 — 목록의 티커를 stocks에서 찾아 매칭 */
export function gradeJudgments(
  judgments: Judgment[],
  stocks: StockEntry[],
): GradedJudgment[] {
  const byTicker = new Map(stocks.map((s) => [s.ticker.toUpperCase(), s]))
  return judgments.map((j) => gradeJudgment(j, byTicker.get(j.ticker.toUpperCase())))
}

// ── 적중률 ───────────────────────────────────────────────

export interface HitRate {
  /** 적중 수 */
  hits: number
  /** 채점 완료 수 (hit + miss, pending 제외) */
  evaluated: number
  /** 적중률 (0~100 정수) — 채점 완료가 없으면 null */
  rate: number | null
}

/** 누적 적중률 계산 — 아직 채점 안 된(pending) 예측은 분모에서 제외 */
export function calcHitRate(graded: GradedJudgment[]): HitRate {
  const evaluated = graded.filter((g) => g.grade !== 'pending')
  const hits = evaluated.filter((g) => g.grade === 'hit').length
  return {
    hits,
    evaluated: evaluated.length,
    rate: evaluated.length > 0 ? Math.round((hits / evaluated.length) * 100) : null,
  }
}

/** React 훅 — 예측 목록 상태 + 액션 */
export function useJudgments() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  return { judgments: snapshot, saveJudgment, deleteJudgment }
}
