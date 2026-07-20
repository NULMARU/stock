"""스페이스AI 스톡랩 — 유니콘(3축 가치주) 평가의 모든 임계값·배점·가중치.

근거: research/unicorn_research.md §2 (밸류에이션 40 / 퀄리티 35 / 성장 25, 100점 만점)
자기개선 규칙:
  - 임계값/배점을 바꿀 때는 이 파일만 수정하고,
    변경 이유와 날짜를 scripts/METHODOLOGY_UNICORN.md 이력에 기록한다.
  - UNICORN_METHODOLOGY_VERSION을 올려 unicorns.json의 methodologyVersion과 대응시킨다.
"""

UNICORN_METHODOLOGY_VERSION = "1.1.0"

# ── 축 가중치 (100점 만점) ───────────────────────────────────
AXIS_WEIGHTS = {"valuation": 40, "quality": 35, "growth": 25}

# ── 통과/등급 기준 ───────────────────────────────────────────
PASS_SCORE = 65            # 총점 ≥ 65 → 유니콘 탭 노출
GRADE_A_MIN = 80           # 80~100 → A (리서치 표기 S에 해당, 타입은 A/B/C만 지원)
GRADE_B_MIN = 65           # 65~79 → B, 그 미만 → C (탭 미노출)

# ── A. 밸류에이션 축 (40점) ──────────────────────────────────
# A1 trailingPE: 만점 ≤15 / 부분(50%) 15~22 / 0점 >35 또는 적자 — 배점 10
A1_POINTS = 10
PE_FULL = 15
PE_PARTIAL = 22
PE_ZERO = 35

# A2 forwardPE: 만점 ≤12 / 부분 12~18 / 0점 >25 — 배점 8
A2_POINTS = 8
FPE_FULL = 12
FPE_PARTIAL = 18
FPE_ZERO = 25

# A3 priceToBook: 만점 ≤1.5 / 부분 1.5~3.0 / 0점 >5 — 배점 6
A3_POINTS = 6
PB_FULL = 1.5
PB_PARTIAL = 3.0
PB_ZERO = 5.0

# A4 PEG (pegRatio, 폴스백 forwardPE/(earningsGrowth×100)):
#    만점 ≤1.0 / 부분 1.0~1.5 / 0점 >2.0 또는 성장률 ≤0 — 배점 8
A4_POINTS = 8
PEG_FULL = 1.0
PEG_PARTIAL = 1.5
PEG_ZERO = 2.0

# A5 FCF 수익률 (freeCashflow/marketCap): 만점 ≥8% / 부분 4~8% / 0점 <2% 또는 FCF 음수 — 배점 8
A5_POINTS = 8
FCFY_FULL = 0.08
FCFY_PARTIAL = 0.04
FCFY_ZERO = 0.02

# ── B. 퀄리티 축 (35점) ──────────────────────────────────────
# B1 ROE: 만점 ≥15% / 부분 8~15% / 0점 <0 — 배점 10
B1_POINTS = 10
ROE_FULL = 0.15
ROE_PARTIAL = 0.08

# B2 ROA: 만점 ≥7% / 부분 4~7% / 0점 <0 — 배점 5
B2_POINTS = 5
ROA_FULL = 0.07
ROA_PARTIAL = 0.04

# B3 영업이익률: 만점 ≥15% / 부분 8~15% / 0점 <0 — 배점 7
B3_POINTS = 7
OPM_FULL = 0.15
OPM_PARTIAL = 0.08

# B4 순이익 흑자 AND FCF 흑자 — 배점 3 (부분 없음)
B4_POINTS = 3

# B5 debtToEquity(yfinance % 단위): 만점 ≤50 / 부분 50~100 / 0점 >150 — 배점 6
B5_POINTS = 6
DE_FULL = 50
DE_PARTIAL = 100
DE_ZERO = 150

# B6 currentRatio: 만점 ≥1.5 / 부분 1.0~1.5 / 0점 <1.0 — 배점 4
B6_POINTS = 4
CR_FULL = 1.5
CR_PARTIAL = 1.0

# ── 금융 섹터 보정 (리서치 §2 '시장·섹터 보정') ───────────────
# 은행·보험·지주는 예금·보험부채가 부채로 잡혀 B5·B6이 왜곡 →
# B5·B6(10점)을 제외하고, ① B1 ROE 만점 기준을 10%로 완화,
# ② 그 배점 10점을 'PBR ≤ 1.0 가산' 단일 체크로 대체한다.
FIN_ROE_FULL = 0.10        # 금융 B1 만점 기준 (완화)
FIN_ROE_PARTIAL = 0.05     # 금융 B1 부분 기준 (완화)
FIN_PB_POINTS = 10         # B5·B6 대체 가산 체크 배점
FIN_PB_FULL = 1.0          # PBR ≤ 1.0 → 만점
FIN_PB_PARTIAL = 1.5       # 1.0~1.5 → 부분(50%)
# [v1.1 보정] 금융 ROA 완화: 은행·보험은 레버리지 모델상 ROA ~1%가 우량.
# 리서치 B2 기준(7%)은 비금융 기업용이라 금융에 그대로 쓰면 전원 0점이 됨.
FIN_ROA_FULL = 0.01        # 금융 B2 만점 기준 ROA ≥ 1%
FIN_ROA_PARTIAL = 0.005    # 금융 B2 부분 기준 ROA ≥ 0.5%

# ── C. 성장 축 (25점) ────────────────────────────────────────
# C1 매출 성장률: 만점 ≥10% / 부분 3~10% / 0점 <0 — 배점 7
C1_POINTS = 7
REVG_FULL = 0.10
REVG_PARTIAL = 0.03

# C2 이익 성장률: 만점 ≥10% / 부분 5~10% / 0점 <0 — 배점 8
# [v1.1 보정] 부분 기준 3%→5%: 3~5% 명목 성장은 물가상승률 수준으로
# 실질 성장으로 보기 어려워 부분 점수 하한을 상향 (회귀 캘리브레이션).
C2_POINTS = 8
EARG_FULL = 0.10
EARG_PARTIAL = 0.05

# C3 forwardPE < trailingPE (이익 증가 예상) — 배점 5 (부분 없음)
C3_POINTS = 5

# C4 배당수익률: 만점 ≥3% / 부분 1~3% / 0점 0% — 배점 5
C4_POINTS = 5
DIV_FULL = 0.03
DIV_PARTIAL = 0.01

# ── 가치 함정 필터 T1~T4 (리서치 §2) ─────────────────────────
# T1 구조적 쇠퇴: revenueGrowth < 0 AND earningsGrowth < -20%
#    → 성장 축에서 15점 감점(바닥 0) + 플래그
T1_EARN_DECLINE = -0.20
T1_PENALTY = 15
T1_FLAG = "구조적 쇠퇴 의심"

# T2 저PBR 함정: priceToBook < 0.5 AND ROE < 5% → A3 점수 무효화 + 플래그
T2_PB = 0.5
T2_ROE = 0.05
T2_FLAG = "저PBR 함정 경고"

# T2f 금융 저ROE 함정 [v1.1 추가]: 금융 AND ROE < 8%
#    → B1 점수 무효화 + 플래그.
#    리서치 §4는 DGB금융지주를 'ROE 한 자리 초반에 머무는 저PBR → T2 발동 대상'으로
#    지목했으나, yfinance는 한국 금융주의 PBR을 제공하지 않아 원형 T2가 못 잡는다.
#    함정의 본질(구조적 저ROE가 만드는 영구 할인)을 ROE 단독으로 판정하는 금융 변형.
T2F_ROE = 0.08
T2F_FLAG = "금융 저ROE 함정 경고"

# PEG 이상치 처리 [v1.1 추가]: yfinance pegRatio(5년 예상 성장률 기반)가
# 5 초과·0 이하이면 비정상 값으로 보고 forwardPE/(earningsGrowth×100)로 재계산.
# 재계산 시 성장률은 50%로 상한을 둬 일회성 이익 급증의 왜곡을 눌러둠.
PEG_OUTLIER = 5.0
PEG_GROWTH_CAP = 0.50

# T3 과잉 레버리지: debtToEquity > 200 AND currentRatio < 1.0
#    → 퀄리티 축에서 10점 감점(바닥 0) + 최고 등급 B 캡 + 플래그
T3_DE = 200
T3_CR = 1.0
T3_PENALTY = 10
T3_FLAG = "과잉 레버리지"

# T4 배당 함정: dividendYield ≥ 6% AND (FCF 음수 또는 순이익 적자)
#    → C4 0점 + 플래그
T4_DIV = 0.06
T4_FLAG = "배당 지속성 경고"

# ── 데이터 품질 / 수집 정책 ──────────────────────────────────
RETRY_COUNT = 1            # 티커당 재시도 횟수
RETRY_SLEEP_SEC = 3
INTER_TICKER_SLEEP_SEC = 0.4
MIN_SUCCESS = 10           # 이 수보다 적게 수집되면 파이프라인 중단
MIN_METRIC_COVERAGE = 0.5  # 채점 대상 지표 결측 비율이 50% 초과면 평가 제외

# 시장별 최소 시가총액 (리서치 §5-4: 미국 $2B, 한국 5천억 원, 중국 HK$200억)
MIN_MARKET_CAP = {
    "USD": 2_000_000_000,
    "KRW": 500_000_000_000,
    "HKD": 20_000_000_000,
    "CNY": 20_000_000_000,
}
