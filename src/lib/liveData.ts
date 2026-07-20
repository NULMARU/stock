/**
 * 스페이스AI 스톡랩 — 런타임 라이브 데이터 로딩 훅
 *
 * 배경: stocks.json / news.json / unicorns.json은 JS 번들에도 포함되지만,
 * public/data/ 아래에도 그대로 배포된다. 자동 수집 워커가 GitHub 저장소의
 * public/data/*.json만 갱신하면, 앱은 재빌드 없이 최신 게시 데이터를 보여줄 수 있다.
 *
 * 동작:
 * - 마운트 시 fetch(`./data/${fileName}`, { cache: 'no-store' })를 시도하고,
 *   성공하면 그 데이터로 교체한다. 실패하면 번들 fallback을 그대로 유지한다.
 * - refresh()는 `?v=${Date.now()}` 캐시버스팅으로 재조회한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface LiveDataResult<T> {
  /** 현재 표시 중인 데이터 (라이브 조회 성공 시 라이브, 아니면 번들 fallback) */
  data: T
  /** 라이브 데이터를 마지막으로 성공적으로 가져온 시각 (ms epoch), 없으면 null */
  fetchedAt: number | null
  /** 조회/재조회 진행 중 여부 */
  refreshing: boolean
  /** 캐시버스팅 재조회. 성공 시 새 데이터, 실패 시 null 반환 (기존 데이터 유지) */
  refresh: () => Promise<T | null>
}

export function useLiveData<T>(fileName: string, bundledFallback: T): LiveDataResult<T> {
  const [data, setData] = useState<T>(bundledFallback)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // 언마운트 후 setState 방지
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const load = useCallback(
    async (bustCache: boolean): Promise<T | null> => {
      try {
        const url = `./data/${fileName}${bustCache ? `?v=${Date.now()}` : ''}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as T
        if (aliveRef.current) {
          setData(json)
          setFetchedAt(Date.now())
        }
        return json
      } catch {
        // 네트워크 오류·파싱 오류 시 번들 fallback 유지
        return null
      }
    },
    [fileName],
  )

  // 마운트 시 1회 조회
  useEffect(() => {
    setRefreshing(true)
    void load(false).finally(() => {
      if (aliveRef.current) setRefreshing(false)
    })
  }, [load])

  const refresh = useCallback(async (): Promise<T | null> => {
    setRefreshing(true)
    try {
      return await load(true)
    } finally {
      if (aliveRef.current) setRefreshing(false)
    }
  }, [load])

  return { data, fetchedAt, refreshing, refresh }
}
