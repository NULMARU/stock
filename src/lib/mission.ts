/**
 * 스페이스AI 스톡랩 — 일일 학습 미션 + 연속 학습일(스트릭) (로컬 전용, 외부 전송 없음)
 *
 * 하루 3개의 가벼운 학습 미션으로 꾸준한 학습 습관을 만든다.
 * 모든 데이터는 이 기기의 localStorage에만 저장된다.
 *
 * 오늘의 미션:
 * - term: 용어 1개 읽기 (용어 탭 방문 또는 용어 모달 열람)
 * - quiz: 퀴즈 1회 완료 (오늘의 용어 퀴즈 3문제 끝까지 풀기)
 * - news: 뉴스 1건 읽기 (뉴스 탭 방문 또는 기사 클릭)
 *
 * 스트릭 규칙:
 * - 3개 모두 완료한 날이 '학습 완료일'
 * - 어제도 완료했으면 streak + 1, 아니면 1로 시작
 * - 하루라도 건너뛰면 다음 완료 시 1로 리셋 (자정이 지나면 진행상황만 자동 초기화)
 */

const STORAGE_KEY = 'spaceai-stocklab:mission:v1'

export type MissionKey = 'term' | 'quiz' | 'news'

export interface MissionState {
  /** 진행상황이 속한 날짜 (로컬 YYYY-MM-DD) */
  date: string
  /** 오늘 미션별 완료 여부 */
  done: Record<MissionKey, boolean>
  /** 오늘 3개 모두 완료했는지 */
  completed: boolean
  /** 연속 학습일 수 */
  streak: number
  /** 마지막으로 학습 완료한 날짜 (로컬 YYYY-MM-DD, 없으면 null) */
  lastCompletedDate: string | null
}

/** markMissionDone 결과 — 토스트 표시 여부 판단용 */
export interface MissionMarkResult {
  state: MissionState
  /** 이번 호출로 3개가 모두 완료되어 '오늘의 학습 완료'가 된 경우에만 true */
  justCompleted: boolean
}

const DEFAULT_STATE: MissionState = {
  date: '',
  done: { term: false, quiz: false, news: false },
  completed: false,
  streak: 0,
  lastCompletedDate: null,
}

/** 로컬 날짜 키 — 예: '2025-01-07' (UTC가 아닌 사용자 기기 날짜 기준) */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 하루 전 날짜 키 */
function yesterdayKey(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return todayKey(d)
}

function load(): MissionState {
  let s: MissionState
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      s = { ...DEFAULT_STATE, done: { ...DEFAULT_STATE.done } }
    } else {
      const parsed = JSON.parse(raw) as Partial<MissionState>
      s = {
        date: typeof parsed.date === 'string' ? parsed.date : '',
        done: {
          term: parsed.done?.term === true,
          quiz: parsed.done?.quiz === true,
          news: parsed.done?.news === true,
        },
        completed: parsed.completed === true,
        streak: typeof parsed.streak === 'number' ? parsed.streak : 0,
        lastCompletedDate:
          typeof parsed.lastCompletedDate === 'string' ? parsed.lastCompletedDate : null,
      }
    }
  } catch {
    s = { ...DEFAULT_STATE, done: { ...DEFAULT_STATE.done } }
  }

  // 자정이 지나면 오늘 진행상황만 초기화 (스트릭/마지막 완료일은 유지)
  const today = todayKey()
  if (s.date !== today) {
    s = { ...s, date: today, done: { term: false, quiz: false, news: false }, completed: false }
  }
  return s
}

function save(s: MissionState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // 저장 실패 시에도 동작은 유지 (다음 기회에 저장)
  }
}

/** 현재 미션 상태 스냅샷 (읽기 전용, 날짜 롤오버 자동 반영) */
export function getMissionState(): MissionState {
  return load()
}

/**
 * 미션 1개 완료 기록.
 * 3개 모두 완료되는 순간 스트릭을 갱신하고 justCompleted=true를 반환한다.
 * (어제 완료 → streak+1 / 아니면 1로 리셋 후 시작)
 */
export function markMissionDone(key: MissionKey): MissionMarkResult {
  const s = load()
  s.done[key] = true

  let justCompleted = false
  if (!s.completed && s.done.term && s.done.quiz && s.done.news) {
    s.completed = true
    s.streak = s.lastCompletedDate === yesterdayKey() ? s.streak + 1 : 1
    s.lastCompletedDate = s.date
    justCompleted = true
  }

  save(s)
  return { state: s, justCompleted }
}

/**
 * 미션 완료 기록 + '오늘의 학습 완료' 토스트.
 * 3개 모두 완료되는 순간에만 토스트를 띄운다 (중복 호출 안전).
 */
export function completeMission(key: MissionKey): MissionState {
  const { state, justCompleted } = markMissionDone(key)
  if (justCompleted) {
    // 순환 import 방지를 위해 동적 import (sonner는 UI 레이어)
    void import('sonner').then(({ toast }) => {
      toast.success(`오늘의 학습 완료! 🔥 ${state.streak}일 연속`)
    })
  }
  return state
}
