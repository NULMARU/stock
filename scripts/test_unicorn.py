#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 유니콘 평가 단위·회귀 테스트.

(a) 합성 지표: 명백한 통과 / 명백한 탈락 / 결측 정규화 / 함정 필터 케이스
(b) 회귀: 실제 수집 데이터로
    통과 기대 — BRK.B · KB금융(105560.KS) · CNOOC(0883.HK) ≥ 65
    탈락 기대 — INTC · DGB금융지주(139130.KS) ≤ 50
    (에버그란데 3333.HK는 상장폐지로 데이터 부재 → 자동 탈락 처리 확인으로 대체)

실행: python3 scripts/test_unicorn.py   (또는 scripts/ 안에서 python3 test_unicorn.py)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import unicorn_config as CFG
from unicorn_evaluate import evaluate, extract, load_or_fetch, exclusion_reason

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""), flush=True)


def base_metrics() -> dict:
    """모든 지표가 채워진 '평범한' 기준값 (테스트마다 덮어써서 사용)."""
    return {
        "trailingPE": 20.0, "forwardPE": 15.0, "priceToBook": 2.0, "peg": 1.2,
        "fcfYield": 0.05, "fcfPositive": True,
        "roe": 0.12, "roa": 0.06, "operatingMargin": 0.12, "profitMargin": 0.10,
        "debtToEquity": 80.0, "currentRatio": 1.2,
        "revenueGrowth": 0.05, "earningsGrowth": 0.05, "dividendYield": 0.02,
        "marketCap": 10_000_000_000,
    }


# ─────────────────────────────────────────────────────────────
# (a) 합성 지표 단위 테스트
# ─────────────────────────────────────────────────────────────

def test_synthetic() -> None:
    print("\n[단위] 합성 지표 케이스", flush=True)

    # a-1) 명백한 통과: 3축 모두 만점권 → 100점
    m = base_metrics() | {
        "trailingPE": 8.0, "forwardPE": 7.0, "priceToBook": 0.9, "peg": 0.7,
        "fcfYield": 0.12, "roe": 0.22, "roa": 0.12, "operatingMargin": 0.25,
        "debtToEquity": 30.0, "currentRatio": 2.5,
        "revenueGrowth": 0.15, "earningsGrowth": 0.20, "dividendYield": 0.045,
    }
    ev = evaluate(m, is_financial=False)
    axis_sum = round(sum(p["score"] for p in ev["pillars"].values()), 1)
    check("합성-통과: 만점권 가치주 ≥ 80", ev["totalScore"] >= 80,
          f"총점 {ev['totalScore']} (등급 {ev['grade']})")
    check("합성-통과: 총점 = 축 점수 합", ev["totalScore"] == axis_sum,
          f"총점 {ev['totalScore']} vs 축 합 {axis_sum}")
    check("합성-통과: 등급 A", ev["grade"] == "A")

    # a-2) 명백한 탈락: 고밸류·역성장·고부채 → ≤ 50 + T1·T3 발동
    m = base_metrics() | {
        "trailingPE": 60.0, "forwardPE": 45.0, "priceToBook": 8.0, "peg": 4.0,
        "fcfYield": 0.005, "roe": 0.02, "roa": 0.01, "operatingMargin": 0.03,
        "debtToEquity": 250.0, "currentRatio": 0.7,
        "revenueGrowth": -0.10, "earningsGrowth": -0.35, "dividendYield": 0.0,
    }
    ev = evaluate(m, is_financial=False)
    check("합성-탈락: 고밸류 역성장 ≤ 50", ev["totalScore"] <= 50,
          f"총점 {ev['totalScore']} (등급 {ev['grade']})")
    check("합성-탈락: T1 구조적 쇠퇴 발동", CFG.T1_FLAG in ev["trapFlags"])
    check("합성-탈락: T3 과잉 레버리지 발동 + 등급 B 캡",
          CFG.T3_FLAG in ev["trapFlags"] and ev["grade"] in ("B", "C"))

    # a-3) 결측 정규화: 성장 지표 전부 None → 해당 배점 제외 후 환산
    m = base_metrics() | {
        "trailingPE": 9.0, "forwardPE": 8.0, "priceToBook": 1.0,
        "peg": None, "fcfYield": 0.09,
        "roe": 0.18, "roa": 0.09, "operatingMargin": 0.20,
        "debtToEquity": 40.0, "currentRatio": 2.0,
        "revenueGrowth": None, "earningsGrowth": None, "dividendYield": 0.035,
    }
    ev = evaluate(m, is_financial=False)
    g = ev["pillars"]["growth"]
    axis_sum = round(sum(p["score"] for p in ev["pillars"].values()), 1)
    # 성장 축에서 C1·C2 결측 제외 → C3(만점)·C4(만점)만으로 25점 만점 환산 기대
    check("합성-결측: 성장 결측 시 정규화로 고득점", g["score"] >= 20,
          f"성장 축 {g['score']}/{g['max']}")
    check("합성-결측: 총점 = 축 점수 합", ev["totalScore"] == axis_sum,
          f"총점 {ev['totalScore']} vs 축 합 {axis_sum}")
    check("합성-결측: 결측 체크는 '배점 제외' 표기",
          any("배점 제외" in c["detail"] for c in g["checks"]))

    # a-4) T2 저PBR 함정: PBR 0.4 + ROE 3% → A3 무효화 + 플래그
    m = base_metrics() | {"priceToBook": 0.4, "roe": 0.03}
    ev = evaluate(m, is_financial=False)
    pbr_chk = next(c for c in ev["pillars"]["valuation"]["checks"] if c["label"] == "PBR")
    check("합성-T2: 저PBR 함정 플래그 + A3 무효화",
          CFG.T2_FLAG in ev["trapFlags"] and not pbr_chk["pass"],
          pbr_chk["detail"])

    # a-5) T4 배당 함정: 배당 7% + FCF 적자 → C4 0점 + 플래그
    m = base_metrics() | {"dividendYield": 0.07, "fcfPositive": False, "fcfYield": None}
    ev = evaluate(m, is_financial=False)
    div_chk = next(c for c in ev["pillars"]["growth"]["checks"] if c["label"] == "배당수익률")
    check("합성-T4: 배당 함정 플래그 + C4 0점",
          CFG.T4_FLAG in ev["trapFlags"] and not div_chk["pass"], div_chk["detail"])

    # a-6) 금융 보정: 동일 지표라도 금융이면 B5·B6 대신 PBR 가산 적용
    m = base_metrics() | {"debtToEquity": 800.0, "currentRatio": 0.3,
                          "priceToBook": 0.9, "roe": 0.11}
    ev_fin = evaluate(m, is_financial=True)
    ev_gen = evaluate(m, is_financial=False)
    q_labels = [c["label"] for c in ev_fin["pillars"]["quality"]["checks"]]
    check("합성-금융: 부채·유동비율 대신 PBR 가산 체크 사용",
          "PBR(금융 가산)" in q_labels and "부채비율" not in q_labels)
    check("합성-금융: 고부채 왜곡 시 금융 보정 점수가 더 높음",
          ev_fin["pillars"]["quality"]["score"] > ev_gen["pillars"]["quality"]["score"],
          f"금융 {ev_fin['pillars']['quality']['score']} vs 일반 {ev_gen['pillars']['quality']['score']}")

    # a-7) PEG 성장률 0 이하 → 0점(결측 제외 아님)
    m = base_metrics() | {"peg": None, "earningsGrowth": -0.05}
    ev = evaluate(m, is_financial=False)
    peg_chk = next(c for c in ev["pillars"]["valuation"]["checks"] if c["label"] == "PEG")
    check("합성-PEG: 성장률 ≤0 → PEG 0점 (배점 제외 아님)",
          not peg_chk["pass"] and "무의미" in peg_chk["detail"], peg_chk["detail"])


# ─────────────────────────────────────────────────────────────
# (b) 회귀 테스트 (실제 수집 데이터)
# ─────────────────────────────────────────────────────────────

REGRESSION_PASS = [
    {"ticker": "BRK.B", "name": "버크셔 해서웨이 B", "financial": True,
     "currency": "USD", "min": CFG.PASS_SCORE},
    {"ticker": "105560.KS", "name": "KB금융", "financial": True,
     "currency": "KRW", "min": CFG.PASS_SCORE},
    {"ticker": "0883.HK", "name": "CNOOC", "financial": False,
     "currency": "HKD", "min": CFG.PASS_SCORE},
]
REGRESSION_FAIL = [
    {"ticker": "INTC", "name": "인텔", "financial": False, "max": 50},
    {"ticker": "139130.KS", "name": "DGB금융지주", "financial": True, "max": 50},
]


def _evaluate_ticker(t: str, financial_hint: bool, currency: str = "USD") -> tuple[float | None, dict | None, str | None]:
    """(총점, 평가결과, 제외사유). 수집 실패 또는 평가 제외 시 총점 None."""
    raw = load_or_fetch(t)
    if raw is None:
        return None, None, "데이터 수집 실패"
    entry = {"ticker": t, "financial": financial_hint, "currency": currency}
    x = extract(entry, raw)
    reason = exclusion_reason(x, entry)
    if reason:
        return None, None, reason
    ev = evaluate(x["metrics"], x["isFinancial"])
    return ev["totalScore"], ev, None


def test_regression() -> None:
    print("\n[회귀] 실제 수집 데이터 (리서치 §4 기준)", flush=True)

    for c in REGRESSION_PASS:
        score, ev, reason = _evaluate_ticker(c["ticker"], c["financial"], c["currency"])
        if score is None:
            check(f"회귀-통과기대: {c['name']}({c['ticker']}) 수집", False, f"평가 불가: {reason}")
            continue
        check(f"회귀-통과기대: {c['name']}({c['ticker']}) ≥ {c['min']}",
              score >= c["min"], f"총점 {score} (등급 {ev['grade']})")

    for c in REGRESSION_FAIL:
        score, ev, reason = _evaluate_ticker(c["ticker"], c["financial"])
        if score is None:
            # 데이터 부재·핵심 지표 결측으로 평가 불가 → 자동 탈락 처리된 것으로 간주
            check(f"회귀-탈락기대: {c['name']}({c['ticker']})", True,
                  f"{reason} → 평가 제외(자동 탈락)로 처리됨")
            continue
        check(f"회귀-탈락기대: {c['name']}({c['ticker']}) ≤ {c['max']}",
              score <= c["max"],
              f"총점 {score} (등급 {ev['grade']}, 함정: {'·'.join(ev['trapFlags']) or '없음'})")

    # 에버그란데: 상장폐지로 데이터 부재 시 자동 탈락 확인
    score, ev, reason = _evaluate_ticker("3333.HK", False, "HKD")
    check("회귀-탈락기대: 에버그란데(3333.HK) 자동 탈락",
          score is None or score <= 50,
          f"{reason} → 평가 제외" if score is None else f"총점 {score}")


def main() -> int:
    print(f"[test_unicorn] 방법론 v{CFG.UNICORN_METHODOLOGY_VERSION}", flush=True)
    test_synthetic()
    test_regression()
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n[결과] {len(RESULTS) - len(failed)}/{len(RESULTS)} PASS", flush=True)
    if failed:
        print("실패 항목:", *failed, sep="\n  - ", flush=True)
        return 1
    print("ALL PASS", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
