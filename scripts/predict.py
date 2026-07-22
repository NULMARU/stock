#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 익일 주가 방향 예측 + 자동 피드백 파이프라인.

매일 아침 1회 실행되어 universe.py 26종목의 익일 방향(up/down/flat)을 예측하고,
과거 예측을 실제 종가와 정산해 3개 요소의 가중치를 자동 개선한다.

알고리즘 (검증된 기법 3개의 가중 앙상블, 입력은 종가·고가·저가·거래량뿐):
    ① reversal  단기 평균회귀: 최근 5일 수익률 + RSI(14) 기반 반전 신호
    ② trend     추세: 20일/50일 이동평균 정배열·가격 위치
    ③ drift     변동성 조정 드리프트: 60일 평균 수익률을 ATR(14)로 스케일

파일:
    scripts/prediction_model.json    가중치·버전·갱신 이력
    scripts/prediction_history.json  종목별 예측 로그 (최근 120일 유지)
    src/data/predictions.json        프론트 출력 (public/data와 동일)
    public/data/predictions.json
    scripts/METHODOLOGY_PREDICT.md   방법론 + 백테스트 결과 (--backtest 실행 시 갱신)

실행:
    python3 scripts/predict.py              # 정산 → 가중치 갱신 → 오늘 예측
    python3 scripts/predict.py --backtest   # 최근 120거래일 워크포워드 적중률
    python3 scripts/predict.py --refresh    # 당일 시세 캐시 무시
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

from universe import UNIVERSE

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
CACHE_DIR = ROOT / ".cache"
MODEL_PATH = SCRIPTS / "prediction_model.json"
HISTORY_PATH = SCRIPTS / "prediction_history.json"
OUT_SRC = ROOT / "src" / "data" / "predictions.json"
OUT_PUBLIC = ROOT / "public" / "data" / "predictions.json"
MD_PATH = SCRIPTS / "METHODOLOGY_PREDICT.md"

KST = timezone(timedelta(hours=9))

# UNICORN 방법론(unicorn_config.py의 UNICORN_METHODOLOGY_VERSION)과 별개의 버전.
PREDICT_METHODOLOGY_VERSION = "predict-v1.0"

DEFAULT_WEIGHTS = {"reversal": 0.34, "trend": 0.33, "drift": 0.33}

HISTORY_KEEP = 120        # 종목별 예측 로그 보관 일수
WEIGHT_WINDOW = 60        # 가중치 갱신에 쓰는 최근 정산 예측 수 (전 종목 합산)
WEIGHT_MIN_SAMPLES = 10   # 이 미만이면 가중치 갱신 보류
BACKTEST_DAYS = 120       # 백테스트 워크포워드 거래일 수
MIN_I = 61                # 지표 계산에 필요한 최소 일수 (60일 드리프트+워밍업)
FLAT_BAND_PCT = 0.5       # |실제수익률| < 0.5% → flat 적중 판정
DIR_THRESHOLD = 0.08      # 앙상블 스코어 방향 결정 임계값

FORCE_REFRESH = "--refresh" in sys.argv


# ─────────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────────

def now_kst() -> datetime:
    return datetime.now(KST)


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def save_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1),
                    encoding="utf-8")


def r(x: float, n: int = 2) -> float:
    return round(float(x), n)


# ─────────────────────────────────────────────────────────────
# 1단계: 시세 수집 (당일 캐시 재사용)
# ─────────────────────────────────────────────────────────────

def fetch_history(ticker: str) -> pd.DataFrame | None:
    """최근 1년 일봉(시·고·저·종·거래량). 당일 캐시가 있으면 재사용."""
    CACHE_DIR.mkdir(exist_ok=True)
    today = now_kst().date().isoformat()
    cache_file = CACHE_DIR / f"predict_{ticker.replace('.', '_')}_{today}.json"
    if cache_file.exists() and not FORCE_REFRESH:
        try:
            raw = json.loads(cache_file.read_text(encoding="utf-8"))
            df = pd.DataFrame(raw)
            df.index = pd.to_datetime(df["date"])
            return df[["Open", "High", "Low", "Close", "Volume"]].astype(float)
        except Exception:
            pass

    last_err: Exception | None = None
    for attempt in range(2):
        try:
            hist = yf.Ticker(ticker).history(period="1y", auto_adjust=True)
            if hist is None or hist.empty or len(hist) < MIN_I + 5:
                raise ValueError("일봉 데이터 부족 (조회 불가 티커)")
            df = hist[["Open", "High", "Low", "Close", "Volume"]].copy()
            df = df.dropna(subset=["Close"])
            raw = {
                "date": [idx.strftime("%Y-%m-%d") for idx in df.index],
                "Open": df["Open"].tolist(), "High": df["High"].tolist(),
                "Low": df["Low"].tolist(), "Close": df["Close"].tolist(),
                "Volume": df["Volume"].tolist(),
            }
            cache_file.write_text(json.dumps(raw), encoding="utf-8")
            return df
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt == 0:
                time.sleep(2)
    print(f"  [실패] {ticker}: {last_err}")
    return None


def fetch_all() -> dict[str, pd.DataFrame]:
    data: dict[str, pd.DataFrame] = {}
    for item in UNIVERSE:
        t = item["ticker"]
        df = fetch_history(t)
        if df is not None:
            data[t] = add_indicators(df)
            print(f"  [수집] {t}: {len(df)}일 ({df.index[-1].strftime('%Y-%m-%d')})")
    return data


# ─────────────────────────────────────────────────────────────
# 2단계: 지표 (모두 과거 데이터만 쓰는 인과적 계산 → 백테스트 재사용 가능)
# ─────────────────────────────────────────────────────────────

def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    c, h, l = df["Close"], df["High"], df["Low"]
    df["ret"] = c.pct_change()
    # RSI(14) — Wilder 스무딩
    delta = c.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    ag = gain.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    al = loss.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    df["rsi"] = 100 - 100 / (1 + ag / al.replace(0, np.nan))
    # 이동평균
    df["sma20"] = c.rolling(20).mean()
    df["sma50"] = c.rolling(50).mean()
    # ATR(14) — Wilder 스무딩
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()],
                   axis=1).max(axis=1)
    df["atr"] = tr.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    # 60일 평균 일수익률
    df["mu60"] = df["ret"].rolling(60).mean()
    return df


# ─────────────────────────────────────────────────────────────
# 3단계: 요소별 신호 (signal, strength 0~1, detail)
# ─────────────────────────────────────────────────────────────

def comp_reversal(rsi_v: float, r5: float) -> tuple[str, float, str]:
    """단기 평균회귀: RSI(14)·5일 수익률의 극단값에서 반전을 기대."""
    under = max(0.0, (35.0 - rsi_v) / 35.0) + max(0.0, (-r5 * 100 - 3.0) / 7.0)
    over = max(0.0, (rsi_v - 65.0) / 35.0) + max(0.0, (r5 * 100 - 3.0) / 7.0)
    info = f"RSI {rsi_v:.0f}·5일 {r5 * 100:+.1f}%"
    if under > over and under > 0.25:
        return "up", min(1.0, under), f"{info} — 단기 과매도, 반등 기대"
    if over > under and over > 0.25:
        return "down", min(1.0, over), f"{info} — 단기 과열, 조정 경계"
    return "flat", 0.2, f"{info} — 반전 신호 약함"


def comp_trend(close: float, sma20: float, sma50: float) -> tuple[str, float, str]:
    """추세: 20일/50일 정배열 + 종가의 20일선 위치."""
    spread = (sma20 - sma50) / close
    pos = (close - sma20) / close
    strength = min(1.0, (abs(spread) + abs(pos)) / 0.06)
    info = f"20일선 {sma20:,.0f} vs 50일선 {sma50:,.0f}, 종가 {close:,.0f}"
    if sma20 > sma50 and close > sma20:
        return "up", strength, f"{info} — 정배열·20일선 상회, 상승 추세"
    if sma20 < sma50 and close < sma20:
        return "down", strength, f"{info} — 역배열·20일선 하회, 하락 추세"
    return "flat", 0.2, f"{info} — 추세 혼조"


def comp_drift(mu60: float, atr_pct: float) -> tuple[str, float, str]:
    """변동성 조정 드리프트: 60일 평균 수익률 / ATR(14)% 비율의 부호."""
    z = mu60 / atr_pct if atr_pct > 0 else 0.0
    strength = min(1.0, abs(z) / 0.25)
    info = f"60일 평균 {mu60 * 100:+.2f}%/일, ATR 대비 {z:+.2f}"
    if z > 0.08:
        return "up", strength, f"{info} — 상방 드리프트"
    if z < -0.08:
        return "down", strength, f"{info} — 하방 드리프트"
    return "flat", 0.2, f"{info} — 드리프트 미미"


SIGN = {"up": 1, "flat": 0, "down": -1}


def predict_at(df: pd.DataFrame, i: int, weights: dict[str, float]) -> dict | None:
    """i번째 거래일 종가 기준 익일 예측. 데이터 부족 시 None."""
    if i < MIN_I:
        return None
    row = df.iloc[i]
    if pd.isna(row["sma50"]) or pd.isna(row["rsi"]) or pd.isna(row["atr"]) \
            or pd.isna(row["mu60"]):
        return None
    close = float(row["Close"])
    if close <= 0:
        return None
    r5 = close / float(df["Close"].iloc[i - 5]) - 1.0
    atr_pct = float(row["atr"]) / close

    comps = [
        ("reversal",) + comp_reversal(float(row["rsi"]), r5),
        ("trend",) + comp_trend(close, float(row["sma20"]), float(row["sma50"])),
        ("drift",) + comp_drift(float(row["mu60"]), atr_pct),
    ]
    score = sum(weights.get(name, 0.0) * SIGN[sig] * strength
                for name, sig, strength, _ in comps)
    score = max(-1.0, min(1.0, score))

    if score > DIR_THRESHOLD:
        direction = "up"
    elif score < -DIR_THRESHOLD:
        direction = "down"
    else:
        direction = "flat"
    probability = min(0.75, max(0.5, 0.5 + 0.5 * abs(score)))
    expected = score * atr_pct * 100.0
    half = atr_pct * 100.0

    return {
        "direction": direction,
        "probability": r(probability, 3),
        "expectedReturnPct": r(expected, 2),
        "band": {"low": r(expected - half, 2), "high": r(expected + half, 2)},
        "close": r(close, 2),
        "components": [{"name": n, "signal": s, "detail": d}
                       for n, s, _, d in comps],
        "signals": {n: s for n, s, _, _ in comps},
        "score": r(score, 4),
    }


def next_weekday(date_str: str) -> str:
    """마지막 거래일 다음 날짜(주말 건너뜀) — 다음 거래일 추정."""
    d = datetime.strptime(date_str, "%Y-%m-%d").date() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


# ─────────────────────────────────────────────────────────────
# 4단계: 정산 (미정산 예측을 실제 종가와 대조)
# ─────────────────────────────────────────────────────────────

def is_hit(direction: str, actual_pct: float) -> bool:
    if direction == "up":
        return actual_pct > 0
    if direction == "down":
        return actual_pct < 0
    return abs(actual_pct) < FLAT_BAND_PCT  # flat


def actual_class(actual_pct: float) -> str:
    if actual_pct >= FLAT_BAND_PCT:
        return "up"
    if actual_pct <= -FLAT_BAND_PCT:
        return "down"
    return "flat"


def settle(history: dict, data: dict[str, pd.DataFrame]) -> int:
    """미정산 예측을 실제 종가로 정산. 새로 정산된 건수 반환."""
    settled = 0
    for ticker, entries in history.items():
        df = data.get(ticker)
        if df is None:
            continue
        dates = [d.strftime("%Y-%m-%d") for d in df.index]
        closes = df["Close"].tolist()
        for e in entries:
            if e.get("hit") is not None:
                continue
            target = next((k for k, d in enumerate(dates)
                           if d >= e["forDate"]), None)
            if target is None:
                continue  # 아직 그 날짜의 종가가 없음
            base = e.get("baseClose")
            if not base:
                prev = next((k for k in range(target - 1, -1, -1)
                             if dates[k] < e["forDate"]), None)
                if prev is None:
                    continue
                base = closes[prev]
                e["baseClose"] = r(base, 2)
                e["baseDate"] = dates[prev]
            actual = (closes[target] - base) / base * 100.0
            e["actualReturnPct"] = r(actual, 3)
            e["settledDate"] = dates[target]
            e["hit"] = is_hit(e["direction"], actual)
            settled += 1
    return settled


def settled_entries(history: dict) -> list[dict]:
    out = []
    for ticker, entries in history.items():
        for e in entries:
            if e.get("hit") is not None:
                out.append(e)
    out.sort(key=lambda e: (e.get("settledDate") or e["forDate"]))
    return out


def hit_rate(entries: list[dict]) -> float | None:
    if not entries:
        return None
    return r(sum(1 for e in entries if e["hit"]) / len(entries), 4)


# ─────────────────────────────────────────────────────────────
# 5단계: 가중치 자동 갱신 (요소별 최근 60회 적중률 비례)
# ─────────────────────────────────────────────────────────────

def update_weights(model: dict, history: dict) -> dict:
    settled = settled_entries(history)
    recent = settled[-WEIGHT_WINDOW:]
    today = now_kst().date().isoformat()
    hist_updates = model.setdefault("updateHistory", [])
    if len(recent) < WEIGHT_MIN_SAMPLES:
        print(f"  [가중치] 정산 표본 {len(recent)}건 < {WEIGHT_MIN_SAMPLES} — 갱신 보류")
        return model
    if hist_updates and hist_updates[-1].get("date", "")[:10] == today:
        print("  [가중치] 오늘 이미 갱신됨 — 생략")
        return model

    rates: dict[str, float] = {}
    for comp in ("reversal", "trend", "drift"):
        hits = [is_hit(e.get("signals", {}).get(comp, "flat"),
                       e["actualReturnPct"]) for e in recent]
        rates[comp] = sum(hits) / len(hits)
    clamped = {c: min(0.60, max(0.15, v)) for c, v in rates.items()}
    total = sum(clamped.values())
    weights = {c: r(clamped[c] / total, 4) for c in clamped}

    model["weights"] = weights
    model["componentHitRates"] = {c: r(v, 4) for c, v in rates.items()}
    model["updatedAt"] = now_kst().isoformat(timespec="seconds")
    hist_updates.append({
        "date": model["updatedAt"],
        "samples": len(recent),
        "componentHitRates": model["componentHitRates"],
        "weights": weights,
    })
    del hist_updates[:-60]
    print(f"  [가중치] 갱신: {weights} (요소별 적중률 {model['componentHitRates']}, "
          f"표본 {len(recent)}건)")
    return model


# ─────────────────────────────────────────────────────────────
# 6단계: 일일 실행
# ─────────────────────────────────────────────────────────────

def run_daily() -> int:
    print(f"[예측] {now_kst().isoformat(timespec='seconds')} 수집 시작 "
          f"({len(UNIVERSE)}종목)")
    data = fetch_all()
    if len(data) < 1:
        print("[오류] 수집된 종목이 없습니다")
        return 1

    history: dict = load_json(HISTORY_PATH, {})
    model: dict = load_json(MODEL_PATH, {})
    model.setdefault("version", PREDICT_METHODOLOGY_VERSION)
    model["version"] = PREDICT_METHODOLOGY_VERSION
    model.setdefault("weights", dict(DEFAULT_WEIGHTS))
    model.setdefault("updateHistory", [])

    n_settled = settle(history, data)
    print(f"[정산] 새로 정산 {n_settled}건")
    model = update_weights(model, history)

    settled = settled_entries(history)
    stats = {
        "hitRate20": hit_rate(settled[-20:]),
        "hitRateAll": hit_rate(settled),
        "evaluated": len(settled),
    }

    now_iso = now_kst().isoformat(timespec="seconds")
    entries: dict[str, dict] = {}
    for item in UNIVERSE:
        t = item["ticker"]
        df = data.get(t)
        if df is None:
            continue
        pred = predict_at(df, len(df) - 1, model["weights"])
        if pred is None:
            print(f"  [건너뜀] {t}: 지표 데이터 부족")
            continue
        base_date = df.index[-1].strftime("%Y-%m-%d")
        for_date = next_weekday(base_date)

        log = history.setdefault(t, [])
        log[:] = [e for e in log
                  if not (e["forDate"] == for_date and e.get("hit") is None)]
        log.append({
            "predictedAt": now_iso,
            "baseDate": base_date,
            "baseClose": pred["close"],
            "forDate": for_date,
            "direction": pred["direction"],
            "probability": pred["probability"],
            "expectedReturnPct": pred["expectedReturnPct"],
            "signals": pred["signals"],
            "actualReturnPct": None,
            "hit": None,
        })
        del log[:-HISTORY_KEEP]

        last_fb = None
        for e in reversed(log):
            if e.get("hit") is not None:
                last_fb = {
                    "date": e.get("settledDate") or e["forDate"],
                    "predicted": e["direction"],
                    "actual": actual_class(e["actualReturnPct"]),
                    "hit": e["hit"],
                    "returnPct": e["actualReturnPct"],
                }
                break

        entries[t] = {
            "predictedAt": now_iso,
            "forDate": for_date,
            "direction": pred["direction"],
            "probability": pred["probability"],
            "expectedReturnPct": pred["expectedReturnPct"],
            "band": pred["band"],
            "close": pred["close"],
            "components": pred["components"],
            "lastFeedback": last_fb,
        }

    output = {
        "asOf": now_iso,
        "methodologyVersion": PREDICT_METHODOLOGY_VERSION,
        "model": {"weights": model["weights"], **stats},
        "entries": entries,
    }
    save_json(OUT_SRC, output)
    save_json(OUT_PUBLIC, output)
    save_json(HISTORY_PATH, history)
    save_json(MODEL_PATH, model)

    up = sum(1 for e in entries.values() if e["direction"] == "up")
    down = sum(1 for e in entries.values() if e["direction"] == "down")
    flat = len(entries) - up - down
    print(f"[완료] {len(entries)}종목 예측 (up {up} / down {down} / flat {flat}), "
          f"hitRate20={stats['hitRate20']}, evaluated={stats['evaluated']}")
    print(f"[저장] {OUT_SRC.relative_to(ROOT)}, {OUT_PUBLIC.relative_to(ROOT)}")
    return 0


# ─────────────────────────────────────────────────────────────
# 7단계: 백테스트 (최근 120거래일 워크포워드)
# ─────────────────────────────────────────────────────────────

def run_backtest() -> int:
    print(f"[백테스트] 최근 {BACKTEST_DAYS}거래일 워크포워드 "
          f"(가중치: 현재 모델 값 고정, 지표는 인과적 계산)")
    data = fetch_all()
    model: dict = load_json(MODEL_PATH, {})
    weights = model.get("weights", dict(DEFAULT_WEIGHTS))

    total = hits = 0
    comp_total = {c: 0 for c in DEFAULT_WEIGHTS}
    comp_hits = {c: 0 for c in DEFAULT_WEIGHTS}
    per_ticker: list[tuple[str, int, int]] = []
    for item in UNIVERSE:
        t = item["ticker"]
        df = data.get(t)
        if df is None:
            continue
        t_hits = t_total = 0
        start = max(MIN_I, len(df) - 1 - BACKTEST_DAYS)
        for i in range(start, len(df) - 1):
            pred = predict_at(df, i, weights)
            if pred is None:
                continue
            actual = (float(df["Close"].iloc[i + 1])
                      / float(df["Close"].iloc[i]) - 1.0) * 100.0
            total += 1
            t_total += 1
            if is_hit(pred["direction"], actual):
                hits += 1
                t_hits += 1
            for comp in comp_total:
                comp_total[comp] += 1
                if is_hit(pred["signals"][comp], actual):
                    comp_hits[comp] += 1
        per_ticker.append((t, t_hits, t_total))
        print(f"  {t}: {t_hits}/{t_total} "
              f"({t_hits / t_total * 100:.1f}%)" if t_total else f"  {t}: 표본 없음")

    overall = hits / total if total else None
    comp_rates = {c: (comp_hits[c] / comp_total[c] if comp_total[c] else None)
                  for c in comp_total}
    print(f"[백테스트 결과] 전체 {hits}/{total} "
          f"({overall * 100:.1f}%)" if overall is not None else "[백테스트 결과] 표본 없음")
    for c, v in comp_rates.items():
        print(f"  요소 {c}: {v * 100:.1f}%" if v is not None else f"  요소 {c}: -")

    write_methodology_md(overall, hits, total, comp_rates, per_ticker, weights)
    return 0


def write_methodology_md(overall, hits, total, comp_rates, per_ticker, weights):
    def pct(x):
        return f"{x * 100:.1f}%" if x is not None else "-"

    rows = "\n".join(
        f"| {t} | {h}/{n} | {h / n * 100:.1f}% |" if n else f"| {t} | - | - |"
        for t, h, n in per_ticker)
    today = now_kst().isoformat(timespec="seconds")
    md = f"""# 익일 주가 방향 예측 알고리즘 방법론

> 구현: `scripts/predict.py` · 방법론 버전 `{PREDICT_METHODOLOGY_VERSION}`
> (유니콘 평가의 `UNICORN_METHODOLOGY_VERSION`과 별개 버전)
> 출력: `src/data/predictions.json` + `public/data/predictions.json` (동일 내용)
> 백테스트 실행: {today}

## 1. 개요

매일 아침 1회, `scripts/universe.py` 26종목에 대해 yfinance 최근 1년 일봉
(종가·고가·저가·거래량, 입력 최소화)으로 **익일 방향(up/down/flat)** 을 예측한다.
전일 예측은 실제 종가와 자동 정산되고, 요소별 적중률에 따라 가중치가 자동 개선된다.

- 방향 판정: 앙상블 스코어 > +{DIR_THRESHOLD} → up, < −{DIR_THRESHOLD} → down, 아니면 flat
- probability = 0.5 + 0.5×|스코어|, 0.50~0.75 클램프
- expectedReturnPct = 스코어 × ATR(14)% — 확신도와 변동성에 비례하는 기대 변동폭
- band = expectedReturnPct ± ATR(14)% (저·고 %)

## 2. 요소(컴포넌트) 3개와 가중 앙상블

각 요소는 signal(up/down/flat)과 강도(0~1)를 내고, `prediction_model.json`의
가중치로 합성한다 (score = Σ wᵢ × signᵢ × strengthᵢ, 가중치 합 = 1).

| 요소 | 기법 | 신호 규칙 |
|---|---|---|
| reversal | 단기 평균회귀 | RSI(14) ≤ 30대 또는 5일 수익률 ≤ −3% → up(반등 기대); RSI ≥ 65 이상 또는 5일 ≥ +3% → down(과열) |
| trend | 추세 추종 | 20일선 > 50일선 AND 종가 > 20일선 → up; 역배열 AND 20일선 하회 → down |
| drift | 변동성 조정 드리프트 | 60일 평균 일수익률 / ATR(14)% 비율 z > +0.08 → up; z < −0.08 → down |

초기 가중치: reversal {DEFAULT_WEIGHTS['reversal']}, trend {DEFAULT_WEIGHTS['trend']}, drift {DEFAULT_WEIGHTS['drift']} (거의 균등).

## 3. 자동 피드백 루프

1. **정산**: 미정산 예측을 `forDate` 이후 첫 실제 종가와 대조.
   적중(hit) = 방향 일치 (up: 실제 > 0, down: 실제 < 0,
   flat: |실제| < {FLAT_BAND_PCT}%).
   로그는 종목별 최근 {HISTORY_KEEP}일 유지 (`scripts/prediction_history.json`).
2. **가중치 갱신**: 전 종목 합산 최근 {WEIGHT_WINDOW}건(최소 {WEIGHT_MIN_SAMPLES}건)의
   요소별 신호 적중률을 계산 → 적중률 비례 가중치(각 0.15~0.60 클램프 후 합 1로 정규화)
   → `prediction_model.json` 저장 (버전·갱신 이력 포함, 하루 1회).
3. **성과 지표**: 출력의 `model.hitRate20`(최근 20건), `hitRateAll`(전체),
   `evaluated`(정산 건수).

## 4. 백테스트 결과 (워크포워드, 최근 {BACKTEST_DAYS}거래일)

각 종목의 최근 {BACKTEST_DAYS}거래일에 대해, 해당 시점까지의 데이터만으로 예측을
만들고 익일 실제 수익률과 비교(인과적 지표 계산, 룩어헤드 없음).
가중치는 현재 모델 값({weights})으로 고정 — 즉 가중치 자동개선 효과는
포함되지 않는 보수적 측정이다.

- **전체 방향 적중률: {pct(overall)} ({hits}/{total}건)**
- 요소별 적중률: reversal {pct(comp_rates.get('reversal'))} ·
  trend {pct(comp_rates.get('trend'))} · drift {pct(comp_rates.get('drift'))}

| 종목 | 적중 | 적중률 |
|---|---|---|
{rows}

### 정직한 해석

단기 주가 방향 예측은 본질적으로 어렵다. 이 모델은 3클래스(up/down/flat)
분류라 무작위 추측의 기준선이 대략 33~40%다(2클래스 동전 던지기의 50%가 아니다).
위 적중률이 그 범위를 크게 벗어나지 않는다면 "우연 수준"이라는 뜻이며,
그 사실을 숨기지 않고 숫자 그대로 공개한다. 거래비용까지 고려하면 실전
유용성은 더 낮아진다. 이 예측은 **투자 조언이 아니라** '왜 그런 신호가
나왔는지'를 components로 설명하는 학습용 도구다. 백테스트는 과거 데이터
기준이며 미래 수익을 보장하지 않는다.
"""
    MD_PATH.write_text(md, encoding="utf-8")
    print(f"[저장] {MD_PATH.relative_to(ROOT)}")


# ─────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="익일 주가 방향 예측 파이프라인")
    parser.add_argument("--backtest", action="store_true",
                        help="최근 120거래일 워크포워드 백테스트만 실행")
    parser.add_argument("--refresh", action="store_true",
                        help="당일 시세 캐시 무시")
    args, _ = parser.parse_known_args()
    if args.backtest:
        return run_backtest()
    return run_daily()


if __name__ == "__main__":
    sys.exit(main())
