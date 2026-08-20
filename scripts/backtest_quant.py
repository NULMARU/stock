#!/usr/bin/env python3
"""quant 신호 컴포넌트 채택 검증 — 3신호 vs 4신호 워크포워드 백테스트 비교.

기존 3신호(reversal/trend/drift) 앙상블과 4신호(+quant) 앙상블의 익일 방향
적중률을 최근 BACKTEST_DAYS거래일 워크포워드로 비교한다.
가중치는 현재 모델 값 기준으로 고정(룩어헤드 없음):
  - 3신호: 현재 모델 가중치를 3요소 합 1로 정규화
  - 4신호: quant에 0.15 배정 후 나머지 3요소를 비례 축소(합 1)

채택 기준: 4신호 평균 적중률 ≥ 3신호 + 1%p

실행:
    python3 scripts/backtest_quant.py
"""

from __future__ import annotations

import json
from pathlib import Path

import predict
from universe import UNIVERSE

RESULT_PATH = Path(__file__).resolve().parent / "backtest_quant_result.json"
ADOPT_THRESHOLD_PP = 1.0  # 채택 기준: 4신호 적중률이 3신호 대비 +1%p 이상


def normalized_weights() -> tuple[dict, dict]:
    """(3신호 가중치, 4신호 가중치) 반환."""
    model: dict = predict.load_json(predict.MODEL_PATH, {})
    w = model.get("weights", dict(predict.DEFAULT_WEIGHTS))
    w3 = {k: v for k, v in w.items() if k != "quant"}
    total = sum(w3.values())
    w3 = {k: v / total for k, v in w3.items()}
    w4 = {k: v * 0.85 for k, v in w3.items()}
    w4["quant"] = 0.15
    return w3, w4


def run() -> int:
    print(f"[quant 검증 백테스트] 최근 {predict.BACKTEST_DAYS}거래일 워크포워드 "
          f"(3신호 vs 4신호, 가중치 고정·지표 인과적 계산)")
    w3, w4 = normalized_weights()
    print(f"  3신호 가중치: { {k: round(v, 4) for k, v in w3.items()} }")
    print(f"  4신호 가중치: { {k: round(v, 4) for k, v in w4.items()} }")

    data = predict.fetch_all()
    t3_hits = t3_total = t4_hits = t4_total = q_hits = q_total = 0
    per_ticker: list[dict] = []
    for item in UNIVERSE:
        t = item["ticker"]
        df = data.get(t)
        if df is None:
            print(f"  {t}: 데이터 없음 — 제외")
            continue
        a_hits = b_hits = s_hits = n = 0
        start = max(predict.MIN_I, len(df) - 1 - predict.BACKTEST_DAYS)
        for i in range(start, len(df) - 1):
            actual = (float(df["Close"].iloc[i + 1])
                      / float(df["Close"].iloc[i]) - 1.0) * 100.0
            p3 = predict.predict_at(df, i, w3)
            p4 = predict.predict_at(df, i, w4)
            if p3 is None or p4 is None:
                continue
            n += 1
            if predict.is_hit(p3["direction"], actual):
                a_hits += 1
            if predict.is_hit(p4["direction"], actual):
                b_hits += 1
            qsig = p4["signals"].get("quant")
            if qsig is not None:
                s_hits += predict.is_hit(qsig, actual)
        if n == 0:
            print(f"  {t}: 표본 없음")
            continue
        t3_hits += a_hits
        t3_total += n
        t4_hits += b_hits
        t4_total += n
        q_hits += s_hits
        q_total += n
        per_ticker.append({
            "ticker": t, "samples": n,
            "hitRate3": round(a_hits / n, 4),
            "hitRate4": round(b_hits / n, 4),
            "quantOnly": round(s_hits / n, 4),
        })
        print(f"  {t}: 3신호 {a_hits}/{n} ({a_hits / n * 100:.1f}%) | "
              f"4신호 {b_hits}/{n} ({b_hits / n * 100:.1f}%) | "
              f"quant 단독 {s_hits}/{n} ({s_hits / n * 100:.1f}%)")

    if t3_total == 0:
        print("[quant 검증 백테스트] 표본 없음 — 검증 불가")
        return 1

    r3 = t3_hits / t3_total
    r4 = t4_hits / t4_total
    rq = q_hits / q_total if q_total else None
    diff_pp = (r4 - r3) * 100.0
    adopted = diff_pp >= ADOPT_THRESHOLD_PP

    print("\n[quant 검증 결과]")
    print(f"  종목 수: {len(per_ticker)} (표본 {t3_total}건)")
    print(f"  3신호 적중률: {r3 * 100:.2f}% ({t3_hits}/{t3_total})")
    print(f"  4신호 적중률: {r4 * 100:.2f}% ({t4_hits}/{t4_total})")
    if rq is not None:
        print(f"  quant 단독 적중률: {rq * 100:.2f}%")
    print(f"  차이: {diff_pp:+.2f}%p (채택 기준 +{ADOPT_THRESHOLD_PP:.0f}%p)")
    print(f"  채택 여부: {'채택' if adopted else '미채택'}")

    result = {
        "date": predict.now_kst().isoformat(timespec="seconds"),
        "backtestDays": predict.BACKTEST_DAYS,
        "tickers": len(per_ticker),
        "samples": t3_total,
        "weights3": {k: round(v, 4) for k, v in w3.items()},
        "weights4": {k: round(v, 4) for k, v in w4.items()},
        "hitRate3": round(r3, 4),
        "hitRate4": round(r4, 4),
        "hitRateQuantOnly": round(rq, 4) if rq is not None else None,
        "diffPp": round(diff_pp, 2),
        "adoptThresholdPp": ADOPT_THRESHOLD_PP,
        "adopted": adopted,
        "perTicker": per_ticker,
    }
    RESULT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=1),
                           encoding="utf-8")
    print(f"[저장] {RESULT_PATH.relative_to(predict.ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
