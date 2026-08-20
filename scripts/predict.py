#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 익일 주가 방향 예측 + 1년 장기 전망 + 자동 피드백 파이프라인.

매일 아침 1회 실행되어 universe.py 26종목의 익일 방향(up/down/flat)을 예측하고,
과거 예측을 실제 종가와 정산해 3개 요소의 가중치를 자동 개선한다.
추가로 1년 장기 전망(longTerm)을 3기둥 앙상블(애널리스트 컨센서스 +
밸류에이션 모델 + 몬테카를로 확률 밴드)로 생성해 entries[ticker].longTerm에 저장한다.

알고리즘 (검증된 기법 3개의 가중 앙상블, 입력은 종가·고가·저가·거래량뿐):
    ① reversal  단기 평균회귀: 최근 5일 수익률 + RSI(14) 기반 반전 신호
    ② trend     추세: 20일/50일 이동평균 정배열·가격 위치
    ③ drift     변동성 조정 드리프트: 60일 평균 수익률을 ATR(14)로 스케일

파일:
    scripts/prediction_model.json    가중치·버전·갱신 이력
    scripts/prediction_history.json  종목별 예측 로그 (daily 최근 120일,
                                     longTermLog 최근 53개 스냅샷)
    src/data/predictions.json        프론트 출력 (public/data와 동일)
    public/data/predictions.json
    scripts/METHODOLOGY_PREDICT.md   방법론 + 백테스트 결과 (--backtest 실행 시 갱신)

실행:
    python3 scripts/predict.py              # 정산 → 가중치 갱신 → 오늘 예측 + 장기 전망
    python3 scripts/predict.py --backtest   # 최근 120거래일 워크포워드 적중률
    python3 scripts/predict.py --refresh    # 당일 시세·info 캐시 무시
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
# v1.1: 1년 장기 전망(longTerm) 3기둥 앙상블 + longTermLog 스냅샷 추가
PREDICT_METHODOLOGY_VERSION = "predict-v1.1"

DEFAULT_WEIGHTS = {"reversal": 0.34, "trend": 0.33, "drift": 0.33}

HISTORY_KEEP = 120        # 종목별 예측 로그 보관 일수
WEIGHT_WINDOW = 60        # 가중치 갱신에 쓰는 최근 정산 예측 수 (전 종목 합산)
WEIGHT_MIN_SAMPLES = 10   # 이 미만이면 가중치 갱신 보류
BACKTEST_DAYS = 120       # 백테스트 워크포워드 거래일 수
MIN_I = 61                # 지표 계산에 필요한 최소 일수 (60일 드리프트+워밍업)
FLAT_BAND_PCT = 0.5       # |실제수익률| < 0.5% → flat 적중 판정
DIR_THRESHOLD = 0.08      # 앙상블 스코어 방향 결정 임계값

# ── 1년 장기 전망(longTerm) 파라미터 ──
LT_HORIZON_DAYS = 365     # 전망 대상일 = 오늘 + 365일
LT_TRADING_DAYS = 252     # 1년 거래일 수 (몬테카를로 horizon)
LT_MC_SIMS = 10_000       # GBM 시뮬레이션 경로 수
LT_MC_SEED = 20260815     # 난수 시드 (재현성 — 같은 입력이면 같은 밴드)
LT_MIN_LOGRETS = 60       # 몬테카를로에 필요한 최소 로그수익률 표본
LT_HISTORY_KEEP = 53      # longTermLog 스냅샷 보관 개수 (주 1회 × 약 1년)
LT_EXP_CLAMP = (-60.0, 150.0)    # expectedReturnPct 이상치 클램프 (%)
LT_BAND_CLAMP = (-80.0, 300.0)   # bandLowPct/bandHighPct 이상치 클램프 (%)
INFO_KEYS = (             # 캐시할 yfinance info 필드
    "targetMeanPrice", "targetMedianPrice", "targetLowPrice", "targetHighPrice",
    "numberOfAnalystOpinions", "forwardEps", "forwardPE",
    "earningsGrowth", "trailingEps",
)

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


def fetch_info(ticker: str) -> dict:
    """yfinance info(애널리스트 목표가·forwardEPS 등). 당일 캐시 재사용."""
    CACHE_DIR.mkdir(exist_ok=True)
    today = now_kst().date().isoformat()
    cache_file = CACHE_DIR / f"predict_info_{ticker.replace('.', '_')}_{today}.json"
    if cache_file.exists() and not FORCE_REFRESH:
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception as e:  # noqa: BLE001
        print(f"  [info 실패] {ticker}: {e}")
        return {}
    keep = {k: info.get(k) for k in INFO_KEYS if info.get(k) is not None}
    try:
        cache_file.write_text(json.dumps(keep), encoding="utf-8")
    except Exception:
        pass
    return keep


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
    for ticker, th in history.items():
        entries = th.get("daily") if isinstance(th, dict) else th
        if not isinstance(entries, list):
            continue
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
    for ticker, th in history.items():
        entries = th.get("daily") if isinstance(th, dict) else th
        if not isinstance(entries, list):
            continue
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
# 6단계: 1년 장기 전망 (컨센서스 + 밸류에이션 + 몬테카를로 3기둥 앙상블)
# ─────────────────────────────────────────────────────────────

def _f(x) -> float | None:
    """숫자로 변환 가능하면 float, 아니면 None."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None


def gbm_terminal(closes: np.ndarray, sims: int = LT_MC_SIMS,
                 horizon: int = LT_TRADING_DAYS,
                 seed: int = LT_MC_SEED) -> tuple[np.ndarray, float, float]:
    """로그수익률 평균·표준편차로 GBM 1년 뒤 가격 분포를 시뮬레이션.

    반환: (터미널 가격 배열, 일간 로그수익률 평균, 일간 로그수익률 표준편차)
    """
    px = closes[closes > 0]
    logret = np.diff(np.log(px))
    mu = float(logret.mean())
    sigma = float(logret.std(ddof=1))
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((sims, horizon))
    drift = mu - 0.5 * sigma ** 2
    terminal = float(px[-1]) * np.exp(drift * horizon + sigma * z.sum(axis=1))
    return terminal, mu, sigma


def pillar_consensus(info: dict) -> tuple[dict, int]:
    """① 애널리스트 컨센서스: targetMeanPrice(없으면 targetMedianPrice)."""
    n = int(_f(info.get("numberOfAnalystOpinions")) or 0)
    target = _f(info.get("targetMeanPrice")) or _f(info.get("targetMedianPrice"))
    lo, hi = _f(info.get("targetLowPrice")), _f(info.get("targetHighPrice"))
    if target is None or target <= 0 or n <= 0:
        return {"name": "애널리스트 컨센서스", "target": None, "weight": 0.0,
                "detail": "목표가를 제시하는 애널리스트가 없어 이 기둥은 제외"}, n
    weight = 0.50 if n >= 5 else 0.35
    rng_txt = (f", 목표가 범위 {lo:,.2f}~{hi:,.2f}"
               if lo is not None and hi is not None else "")
    return {"name": "애널리스트 컨센서스", "target": r(target), "weight": weight,
            "detail": (f"애널리스트 {n}명의 평균 목표가{rng_txt} — "
                       f"집단 추정이지만 낙관 편향이 알려져 있음")}, n


def pillar_valuation(info: dict, n_analysts: int) -> dict:
    """② 밸류에이션 모델: forward EPS × 정당 PE(PEG 사고방식)."""
    feps = _f(info.get("forwardEps"))
    if feps is None or feps <= 0:
        return {"name": "밸류에이션 모델", "target": None, "weight": 0.0,
                "detail": "forward EPS가 없거나 적자(음수)라 밸류에이션 산출 불가"}
    fpe = _f(info.get("forwardPE"))
    growth = _f(info.get("earningsGrowth"))
    parts, basis = [], []
    if fpe is not None and fpe > 0:
        parts.append(min(28.0, max(12.0, fpe)))
        basis.append(f"forwardPE {fpe:.1f}배→{parts[-1]:.1f}배")
    if growth is not None:
        g100 = growth * 100.0
        parts.append(min(25.0, max(8.0, g100)))
        basis.append(f"이익성장률 {g100:.1f}%→{parts[-1]:.1f}배")
    if not parts:
        return {"name": "밸류에이션 모델", "target": None, "weight": 0.0,
                "detail": (f"forward EPS {feps:.2f}이나 정당 PE 근거"
                           f"(forwardPE·이익성장률)가 없어 산출 불가")}
    pe = sum(parts) / len(parts)
    weight = 0.30 if n_analysts >= 5 else (0.35 if n_analysts >= 1 else 0.45)
    return {"name": "밸류에이션 모델", "target": r(feps * pe), "weight": weight,
            "detail": (f"forward EPS {feps:.2f} × 정당 PE {pe:.1f}배 "
                       f"({'; '.join(basis)}) — 성장 대비 적정 주수익비율 환산")}


def pillar_montecarlo(closes: np.ndarray, has_consensus: bool,
                      has_valuation: bool) -> tuple[dict, float, float, float] | None:
    """③ 몬테카를로 확률 밴드: GBM 10,000회, 1년 뒤 20/50/80 백분위.

    반환: (기둥 dict, p10, p90, 연간 변동성) 또는 데이터 부족 시 None.
    """
    px = closes[closes > 0]
    if len(px) < LT_MIN_LOGRETS + 1:
        return None
    terminal, mu, sigma = gbm_terminal(px)
    p10, p20, p50, p80, p90 = (float(x)
                               for x in np.percentile(terminal, [10, 20, 50, 80, 90]))
    weight = 0.20 if has_consensus else (0.55 if has_valuation else 1.0)
    ann_drift = mu * LT_TRADING_DAYS
    ann_vol = sigma * float(np.sqrt(LT_TRADING_DAYS))
    pillar = {"name": "몬테카를로 확률 밴드", "target": r(p50), "weight": weight,
              "detail": (f"최근 1년 일간 로그수익률로 GBM {LT_MC_SIMS:,}회 시뮬레이션 — "
                         f"연간 드리프트 {ann_drift:+.1%}, 연간 변동성 {ann_vol:.0%}, "
                         f"1년 뒤 20/50/80 백분위 {p20:,.2f}/{p50:,.2f}/{p80:,.2f}")}
    return pillar, p10, p90, ann_vol


def longterm_forecast(df: pd.DataFrame, info: dict) -> dict | None:
    """3기둥 가중 앙상블로 1년 장기 전망 생성. 데이터 부족 시 None."""
    close = float(df["Close"].iloc[-1])
    if close <= 0:
        return None
    closes = df["Close"].to_numpy(dtype=float)

    cons, n_analysts = pillar_consensus(info)
    val = pillar_valuation(info, n_analysts)
    mc_res = pillar_montecarlo(closes, cons["target"] is not None,
                               val["target"] is not None)
    if mc_res is None:
        return None
    mc, mc_p10, mc_p90, ann_vol = mc_res
    pillars = [cons, val, mc]

    total_w = sum(p["weight"] for p in pillars)
    if total_w <= 0:
        return None
    for p in pillars:  # 가중치 합 = 1로 정규화
        p["weight"] = r(p["weight"] / total_w, 4)

    valid = [p for p in pillars if p["target"] is not None and p["weight"] > 0]
    if not valid:
        return None
    central = (sum(p["target"] * p["weight"] for p in valid)
               / sum(p["weight"] for p in valid))

    # 밴드: 몬테카를로 10/90 백분위와 애널리스트 low/high(있으면)의 평균 블렌드
    lows, highs = [mc_p10], [mc_p90]
    if cons["target"] is not None:
        a_lo, a_hi = _f(info.get("targetLowPrice")), _f(info.get("targetHighPrice"))
        if a_lo is not None and a_lo > 0:
            lows.append(a_lo)
        if a_hi is not None and a_hi > 0:
            highs.append(a_hi)
    t_low = min(sum(lows) / len(lows), central)
    t_high = max(sum(highs) / len(highs), central)

    def pct(t: float) -> float:
        return (t / close - 1.0) * 100.0

    exp = min(LT_EXP_CLAMP[1], max(LT_EXP_CLAMP[0], pct(central)))
    band_lo = min(LT_BAND_CLAMP[1], max(LT_BAND_CLAMP[0], pct(t_low)))
    band_hi = min(LT_BAND_CLAMP[1], max(LT_BAND_CLAMP[0], pct(t_high)))
    band_lo, band_hi = min(band_lo, band_hi), max(band_lo, band_hi)

    targets = [p["target"] for p in valid if p["target"] > 0]
    spread = (max(targets) / min(targets) - 1.0) if len(targets) >= 2 else None
    if n_analysts >= 5 and spread is not None and spread < 0.40:
        confidence = "high"
    elif n_analysts == 0 and ann_vol > 0.60:
        confidence = "low"
    else:
        confidence = "medium"

    return {
        "forDate": (now_kst().date() + timedelta(days=LT_HORIZON_DAYS)).isoformat(),
        "targetCentral": r(central),
        "targetLow": r(t_low),
        "targetHigh": r(t_high),
        "expectedReturnPct": r(exp),
        "bandLowPct": r(band_lo),
        "bandHighPct": r(band_hi),
        "confidence": confidence,
        "pillars": pillars,
    }


# ─────────────────────────────────────────────────────────────
# 7단계: 일일 실행
# ─────────────────────────────────────────────────────────────

def run_daily() -> int:
    print(f"[예측] {now_kst().isoformat(timespec='seconds')} 수집 시작 "
          f"({len(UNIVERSE)}종목)")
    data = fetch_all()
    if len(data) < 1:
        print("[오류] 수집된 종목이 없습니다")
        return 1

    history: dict = load_json(HISTORY_PATH, {})
    # 구조 마이그레이션: {ticker: [...]} → {ticker: {"daily": [...], "longTermLog": [...]}}
    for k, v in list(history.items()):
        if isinstance(v, list):
            history[k] = {"daily": v, "longTermLog": []}
        elif isinstance(v, dict):
            v.setdefault("daily", [])
            v.setdefault("longTermLog", [])
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
    today_date = now_kst().date().isoformat()
    entries: dict[str, dict] = {}
    lt_count = 0
    lt_conf = {"high": 0, "medium": 0, "low": 0}
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

        th = history.setdefault(t, {"daily": [], "longTermLog": []})
        log = th["daily"]
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

        # 1년 장기 전망 (데이터 부족 시 longTerm 생략)
        lt = longterm_forecast(df, fetch_info(t))
        if lt is not None:
            entries[t]["longTerm"] = lt
            lt_count += 1
            lt_conf[lt["confidence"]] += 1
            # 자기개선 원천 데이터: 1년 후 정산·밴드 캘리브레이션용 스냅샷
            lt_log = th["longTermLog"]
            lt_log[:] = [e for e in lt_log if e.get("date") != today_date]
            lt_log.append({
                "date": today_date,
                "targetCentral": lt["targetCentral"],
                "targetLow": lt["targetLow"],
                "targetHigh": lt["targetHigh"],
                "close": pred["close"],
            })
            del lt_log[:-LT_HISTORY_KEEP]

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
    print(f"[장기] longTerm {lt_count}종목 생성 "
          f"(high {lt_conf['high']} / medium {lt_conf['medium']} / low {lt_conf['low']})")
    print(f"[저장] {OUT_SRC.relative_to(ROOT)}, {OUT_PUBLIC.relative_to(ROOT)}")
    return 0


# ─────────────────────────────────────────────────────────────
# 8단계: 백테스트 (최근 120거래일 워크포워드)
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


# 장기 전망 방법론 섹션 — --backtest로 문서를 재생성해도 유지되도록 상수로 분리.
# 스팟체크 결과 표는 검증 실행 후 갱신한다.
LT_MD_SECTION = """
## 5. 1년 장기 전망 (longTerm)

매일 실행 시 각 종목에 **1년 뒤 전망**(`entries[ticker].longTerm`)을 3기둥
가중 앙상블로 생성한다. 입력은 yfinance `info`(애널리스트 목표가·forwardEPS 등,
당일 캐시)와 최근 1년 일봉(단기 예측과 동일 수집 로직)뿐이다.

| 기둥 | 산출 | 기본 가중치 |
|---|---|---|
| 애널리스트 컨센서스 | `targetMeanPrice`(없으면 `targetMedianPrice`) | 애널리스트 ≥5명: 0.50 · 1~4명: 0.35 · 없음: 0 |
| 밸류에이션 모델 | forward EPS × 정당 PE — 정당 PE = clamp(forwardPE, 12, 28)와 clamp(이익성장률%, 8, 25)의 평균(PEG 사고방식) | 컨센서스 ≥5명: 0.30 · 1~4명: 0.35 · 없음: 0.45 (적자 기업은 산출 불가 → 0) |
| 몬테카를로 확률 밴드 | 최근 1년 일간 로그수익률의 평균·표준편차로 GBM 10,000회 시뮬레이션, 1년 뒤 가격 분포의 20/50/80 백분위 (target = 중앙값) | 컨센서스 있음: 0.20 · 컨센서스 없고 밸류에이션 있음: 0.55 · 둘 다 없음: 1.0 |

- 가중치는 매 실행 시 **합이 1이 되도록 정규화**하고, `targetCentral`은 target이
  있는 기둥만의 가중 평균이다. `targetLow/High`는 몬테카를로 10/90 백분위와
  애널리스트 low/high(있으면)의 평균 블렌드다.
- 이상치 클램프: `expectedReturnPct` ∈ [-60, +150]%, 밴드 ∈ [-80, +300]%.
- `confidence`: high = 애널리스트 ≥5명 AND 기둥 간 목표가 최대/최소 스프레드 < 40%,
  low = 애널리스트 0명 AND 연간 변동성 > 60%, 나머지 medium.
- **자기개선 연결**: 매 실행마다 `prediction_history.json`의 종목별 `longTermLog`에
  `{date, targetCentral, targetLow, targetHigh, close}` 스냅샷을 남긴다(최근 53개 유지).
  이 로그는 **1년 후 실제 가격과 정산해 장기 전망의 오차를 측정하고, 몬테카를로
  밴드 폭의 캘리브레이션(예: 10/90 밴드가 실제로 80%를 덮는지 점검·보정)을 수행하는
  원천 데이터**다.

### 벤치마크 근거 (왜 이 조합인가)

1. M4·M5 등 대규모 예측 대회에서 **장기 horizon일수록 단순 통계 기법(지수평활·
   드리프트·확률 밴드)이 복잡한 머신러닝과 대등하거나 오히려 우수**했다.
   1년 예측에서 모델 복잡도는 정확도가 아니라 과적합 위험을 키운다.
2. Chronos·TimesFM 같은 시계열 파운데이션 모델은 주로 전력·교통·기상 같은
   **비금융 시계열**로 학습됐고, 근-랜덤워크에 가까운 개별 주식 수익률 예측에서
   단순 벤치마크 대비 우위가 입증되지 않았다.
3. 애널리스트 목표가는 **낙관 편향**이 잘 알려져 있지만, 방향성과 분포의 중심을
   잡는 신호로는 유효하다 — 그래서 절대 수치를 맹신하지 않고 변동성 밴드와
   블렌드한다.
4. 따라서 **컨센서스 + 밸류에이션 + 확률 밴드** 앙상블을 채택했다.

**딥러닝을 쓰지 않는 이유 (초보자용)**: 주식의 1년 뒤 가격은 '새로운 뉴스'가
쌓여 결정되므로, 과거 가격 패턴을 외우는 큰 모델은 겉보기엔 똑똑해 보여도
실전에서는 잘 맞지 않는 경우가 많습니다. 오히려 ① 사람들의 집단 추정
(애널리스트), ② 회사가 벌어들일 이익(밸류에이션), ③ 가격이 얼마나 흔들리는지
(확률 밴드)라는 서로 다른 관점 3개를 섞는 편이, 하나가 틀려도 나머지가 받쳐 주어
더 튼튼합니다.

### 장기 밴드 스팟체크 (간이 백테스트, 2026-08-20 실행)

| 종목 | 기준일 | 기준 종가 | MC 10백분위 | MC 중앙값 | MC 90백분위 | 실제 1년 뒤 | 판정 |
|---|---|---|---|---|---|---|---|
| TSLA | 2025-08-19 | 329.31 | 154.76 | 376.40 | 926.20 | 351.12 (2026-08-19) | ✅ 밴드 안 |
| 005930.KS | 2025-08-20 | 69,626 | 39,838 | 59,738 | 90,056 | 271,000 (2026-08-20) | ❌ 밴드 밖 (상방 이탈) |
| NVDA | 2025-08-19 | 175.41 | 107.87 | 208.73 | 407.42 | 217.56 (2026-08-19) | ✅ 밴드 안 |

결과: **3종목 중 2종목 밴드 안**. 삼성전자(005930.KS)는 약 +289% 급등이라 GBM
90백분위(90,056)를 크게 상회 — 로그정규 GBM이 비정상적 급등 랠리를 과소추정하는
한계를 그대로 보여준다. 3종목에 대해 '1년 전 시점까지의 데이터로 몬테카를로
기둥만 계산 → 실제 1년 뒤 가격이 10/90 밴드 안에 들어왔는지'를 점검한 것으로,
표본이 3개뿐이라 통계적 결론은 불가하며 밴드 산출 파이프라인이 정상 작동하는지
확인하는 수준이다. 향후 `longTermLog`가 1년치 쌓이면 전 종목 정산으로 대체된다.
"""


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
""" + LT_MD_SECTION
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
