/**
 * 한글 초성검색 유틸
 *
 * - 한글 음절(가-힣)에서 초성을 추출해 검색 매칭에 활용한다.
 * - 검색어가 순수 초성(ㄱ-ㅎ)으로만 구성되면 대상 문자열의 초성 문자열과 매칭한다.
 * - 완성형 한글/영문/숫자가 섞이면 기존 substring 매칭 + 초성 매칭을 OR로 적용한다.
 * - 대소문자는 무시한다.
 *
 * @example
 * searchMatches('삼성전자 Samsung Electronics 005930', 'ㅅㅅㅈㅈ') // true — 순초성 검색어 → 초성 매칭
 * searchMatches('삼성전자 Samsung Electronics 005930', '삼성')    // true — 완성형 substring 매칭
 * searchMatches('엔비디아 NVIDIA NVDA', 'nvda')                  // true — 영문/티커 substring (대소문자 무시)
 * searchMatches('삼성전자 Samsung Electronics 005930', '삼ㅅ')    // true — 혼합 검색어 → 초성 변환 매칭 (OR)
 * searchMatches('삼성전자 Samsung Electronics 005930', '현대')    // false
 */

/** 한글 음절 시작 코드(가) */
const HANGUL_SYLLABLE_BASE = 0xac00
/** 한글 음절 끝 코드(힣) */
const HANGUL_SYLLABLE_END = 0xd7a3
/** 초성 하나가 차지하는 음절 수 (중성 21 × 종성 28) */
const CHOSEONG_SPAN = 588

/** 초성 테이블 (Unicode 한글 음절 순서와 동일) */
const CHOSEONG_TABLE = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const

/** 단일 문자가 초성(ㄱ-ㅎ)인지 판별 */
function isChoseongChar(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code >= 0x3131 && code <= 0x314e
}

/**
 * 문자열의 각 한글 음절을 초성으로 치환한 문자열을 반환한다.
 * 한글 음절이 아닌 문자(영문/숫자/공백/자모 등)는 소문자로 변환해 그대로 둔다.
 */
export function toChoseong(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= HANGUL_SYLLABLE_BASE && code <= HANGUL_SYLLABLE_END) {
      out += CHOSEONG_TABLE[Math.floor((code - HANGUL_SYLLABLE_BASE) / CHOSEONG_SPAN)]
    } else {
      out += ch.toLowerCase()
    }
  }
  return out
}

/** 검색어가 순수 초성(ㄱ-ㅎ)으로만 이뤄졌는지 판별 */
export function isChoseongOnly(query: string): boolean {
  return query.length > 0 && [...query].every(isChoseongChar)
}

/**
 * 검색 매칭 판정
 *
 * - 빈 검색어는 항상 true
 * - 순초성 검색어: 대상의 초성 문자열에 포함되는지 확인
 * - 그 외: 소문자 substring 매칭 OR (검색어를 초성 변환한 문자열이 대상 초성 문자열에 포함)
 */
export function searchMatches(haystack: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true

  const haystackChoseong = toChoseong(haystack)

  // 순초성 검색어 — 초성 문자열끼리만 비교 (예: 'ㅅㅅㅇㅈ' → '삼성전자')
  if (isChoseongOnly(q)) {
    return haystackChoseong.includes(q)
  }

  const qLower = q.toLowerCase()
  // 1) 기존 substring 매칭 (완성형 한글/영문/티커)
  if (haystack.toLowerCase().includes(qLower)) return true
  // 2) 혼합 검색어 보완 — 완성형 음절도 초성으로 환산해 비교 (예: '삼ㅅ' → 'ㅅㅅ')
  return haystackChoseong.includes(toChoseong(q))
}
