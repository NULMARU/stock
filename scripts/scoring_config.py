"""스페이스AI 스톡랩 — 5축 점수 알고리즘의 모든 임계값·가중치.

자기개선 규칙 (spec.md §2):
  - 임계값/가중치를 바꿀 때는 이 파일만 수정하고,
    변경 이유와 날짜를 scripts/METHODOLOGY.md 이력에 기록한다.
  - METHODOLOGY_VERSION을 올려 stocks.json의 methodologyVersion과 대응시킨다.
"""

METHODOLOGY_VERSION = "1.0.0"

# ── 5축 가중치 (spec §4.6: 동일 가중 원칙, 조정 가능) ─────────
AXIS_WEIGHTS = {
    "valuation": 1.0,
    "growth": 1.0,
    "profitability": 1.0,
    "financialHealth": 1.0,
    "momentum": 1.0,
}
AXIS_MAX_SCORE = 5          # 축당 만점
TOTAL_MAX_SCORE = 25        # 총점 만점

# ── 밸류에이션 (valuation) ────────────────────────────────────
# 흑자 기업: PER 절대 구간 + 그룹 중앙값 비교 + PBR + PSR
PE_CHEAP = 15               # PER ≤ 15 → 저평가 구간
PE_FAIR = 30                # PER ≤ 30 → 적정 구간
PE_OVERHEAT = 200           # PER > 200 → '과열' 단일 판정 캡 (캠브리콘 사례)
OVERHEAT_VALUATION_SCORE = 1  # 과열 캡 발동 시 밸류에이션 점수 상한
PB_FAIR = 3                 # PBR ≤ 3
PS_FAIR = 5                 # PSR ≤ 5 (흑자 기업용)
# 적자 기업: PSR + 매출성장률 대체 판정 (spec §4.3)
PS_CHEAP = 3                # PSR ≤ 3
PS_FAIR_LOSS = 10           # PSR ≤ 10
REV_GROWTH_STRONG = 0.20    # 매출성장률 ≥ 20%
REV_GROWTH_VERY_STRONG = 0.40  # 매출성장률 ≥ 40%
PE_RISK_FLAG = 100          # PER ≥ 100 → "고PER" 리스크 플래그

# ── 성장성 (growth) ───────────────────────────────────────────
REV_GROWTH_OK = 0.10        # 매출성장률 ≥ 10%
REV_GROWTH_HIGH = 0.25      # 매출성장률 ≥ 25%
EARN_GROWTH_OK = 0.10       # 순이익성장률 ≥ 10%
EARN_GROWTH_HIGH = 0.25     # 순이익성장률 ≥ 25%

# ── 수익성 (profitability) ────────────────────────────────────
ROE_OK = 0.08               # ROE ≥ 8%
ROE_GOOD = 0.15             # ROE ≥ 15% (S&P500 평균 대략 15~20%)
OPM_OK = 0.10               # 영업이익률 ≥ 10%
OPM_GOOD = 0.20             # 영업이익률 ≥ 20%
NPM_OK = 0.10               # 순이익률 ≥ 10%
# 적자 기업 대체 판정 (spec §4.3: 영업이익률 추세)
GM_OK = 0.30                # 매출총이익률 ≥ 30%
GM_GOOD = 0.50              # 매출총이익률 ≥ 50%

# ── 재무건전성 (financialHealth) ──────────────────────────────
DE_OK = 100                 # 부채비율 ≤ 100%
DE_GOOD = 50                # 부채비율 ≤ 50%
CURRENT_RATIO_OK = 1.5      # 유동비율 ≥ 1.5

# ── 모멘텀 (momentum, spec §4.5) ─────────────────────────────
POS_OK = 0.40               # 52주 범위 내 위치 ≥ 40%
POS_GOOD = 0.60             # 52주 범위 내 위치 ≥ 60%
RET3M_OK = 0.0              # 3개월 수익률 > 0%
RET3M_GOOD = 0.10           # 3개월 수익률 ≥ 10%
OVERHEAT_POS = 0.95         # 52주 위치 ≥ 95% → 고점 근처 과열 감점
OVERHEAT_PENALTY = 1        # 과열 시 감점 폭
MA_WINDOW = 50              # 이동평균 기준 (50일선 상회 체크)
RET3M_DAYS = 63             # 3개월 ≈ 거래일 63일

# ── 리스크 플래그 ─────────────────────────────────────────────
BETA_HIGH = 2.0             # 베타 ≥ 2 → "고변동성"
SMALL_CAP_THRESHOLD = {     # 시장별 '소형주' 시총 기준 (상장 통화 기준)
    "USD": 2_000_000_000,        # $20억 미만
    "KRW": 3_000_000_000_000,    # 3조 원 미만
    "HKD": 15_000_000_000,       # HK$150억 미만
    "CNY": 15_000_000_000,       # 150억 위안 미만
}

# ── 데이터 품질 ───────────────────────────────────────────────
MIN_SUCCESS = 22            # 26개 중 최소 성공 종목 수
HISTORY_WEEKLY_POINTS = 52  # 1년 일봉 → 주 1개 샘플링 목표 포인트 수
RETRY_COUNT = 1             # 티커당 재시도 횟수
RETRY_SLEEP_SEC = 3         # 재시도 전 대기
INTER_TICKER_SLEEP_SEC = 0.4  # 요청 간 최소 간격 (레이트리밋 방지)
