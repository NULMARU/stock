#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 빌드타임 데이터 파이프라인.

yfinance로 시세·재무지표·1년 일봉을 수집하고, 5축 점수와 한국어 해석 문장을
생성해 ../src/data/stocks.json 으로 저장한다.

실행 (scripts/ 디렉터리 기준):
    python3 refresh_data.py            # 당일 캐시 재사용
    python3 refresh_data.py --refresh  # 캐시 무시하고 전부 재수집
"""

from __future__ import annotations

import json
import math
import statistics
import sys
import time
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

from universe import UNIVERSE
import scoring_config as CFG

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent
OUT_PATH = ROOT.parent / "src" / "data" / "stocks.json"
CACHE_DIR = ROOT / ".cache"
KST = timezone(timedelta(hours=9))
AS_OF = datetime.now(KST).date().isoformat()
FORCE_REFRESH = "--refresh" in sys.argv


# ─────────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────────

def clean(value):
    """numpy 스칼라·NaN을 JSON 안전 값으로 변환."""
    if value is None:
        return None
    try:
        if hasattr(value, "item"):
            value = value.item()
    except Exception:
        pass
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, (int, float, str, bool)):
        return value
    return None


def num(value, digits=2):
    """소수점 정리 (None 유지)."""
    value = clean(value)
    if value is None or not isinstance(value, (int, float)):
        return None
    return round(float(value), digits)


def pct(x: float, digits=0) -> str:
    return f"{x * 100:.{digits}f}%"


def fmt(x: float, digits=1) -> str:
    s = f"{x:,.{digits}f}"
    if digits > 0 and s.endswith("." + "0" * digits):
        s = s[: -(digits + 1)]
    return s


# ─────────────────────────────────────────────────────────────
# 1단계: 수집 (당일 캐시 재사용)
# ─────────────────────────────────────────────────────────────

def fetch_raw(ticker: str) -> dict:
    """yfinance에서 info + 1년 일봉 + (적자 판정용) 분기 영업이익을 가져온다."""
    t = yf.Ticker(ticker)
    info = t.info or {}
    hist = t.history(period="1y", auto_adjust=True)

    closes: list[dict] = []
    if hist is not None and not hist.empty:
        for idx, row in hist.iterrows():
            c = clean(row.get("Close"))
            if c is None:
                continue
            closes.append({"date": idx.strftime("%Y-%m-%d"), "close": float(c)})

    return {
        "info": {k: clean(v) for k, v in info.items()},
        "closes": closes,
        # 분기 영업이익은 적자 기업 판정 후 2단계에서 필요할 때만 채운다
        "quarterlyOI": None,
    }


def fetch_quarterly_oi(ticker: str) -> list[float] | None:
    """최근 4개 분기 영업이익(최신순). 적자 기업 수익성 추세 판정에만 사용."""
    try:
        q = yf.Ticker(ticker).quarterly_income_stmt
        if q is None or q.empty or "Operating Income" not in q.index:
            return None
        vals = [clean(v) for v in q.loc["Operating Income"].tolist()[:4]]
        vals = [float(v) for v in vals if v is not None]
        return vals or None
    except Exception:
        return None


def load_or_fetch(ticker: str) -> dict | None:
    """당일 캐시가 있으면 재사용, 없으면 재시도 1회 포함해 수집."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{ticker.replace('.', '_')}_{AS_OF}.json"
    if cache_file.exists() and not FORCE_REFRESH:
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    last_err: Exception | None = None
    for attempt in range(CFG.RETRY_COUNT + 1):
        try:
            raw = fetch_raw(ticker)
            price = (raw["info"] or {}).get("currentPrice") or \
                    (raw["info"] or {}).get("regularMarketPrice") or \
                    (raw["info"] or {}).get("previousClose")
            if price is None and not raw["closes"]:
                raise ValueError("가격 데이터 없음 (조회 불가 티커)")
            cache_file.write_text(
                json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            return raw
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < CFG.RETRY_COUNT:
                time.sleep(CFG.RETRY_SLEEP_SEC)
    print(f"  [실패] {ticker}: {last_err}")
    return None


# ─────────────────────────────────────────────────────────────
# 2단계: 지표 추출
# ─────────────────────────────────────────────────────────────

def extract(entry: dict, raw: dict) -> dict:
    info = raw["info"] or {}
    closes = raw["closes"]

    # 시세
    price = num(info.get("currentPrice") or info.get("regularMarketPrice"))
    if price is None and closes:
        price = round(closes[-1]["close"], 2)
    change_pct = num(info.get("regularMarketChangePercent"))
    if change_pct is None and len(closes) >= 2 and closes[-2]["close"]:
        change_pct = round((closes[-1]["close"] / closes[-2]["close"] - 1) * 100, 2)

    hist_high = max((c["close"] for c in closes), default=None)
    hist_low = min((c["close"] for c in closes), default=None)
    high52 = num(info.get("fiftyTwoWeekHigh")) or (round(hist_high, 2) if hist_high else None)
    low52 = num(info.get("fiftyTwoWeekLow")) or (round(hist_low, 2) if hist_low else None)

    market_cap = clean(info.get("marketCap"))
    if market_cap is None and price and clean(info.get("sharesOutstanding")):
        market_cap = price * info["sharesOutstanding"]

    # 재무 지표 — 음수 PER/ROE는 null 처리 (spec §3: 적자 기업은 PER/ROE null)
    trailing_pe = num(info.get("trailingPE"))
    if trailing_pe is not None and trailing_pe <= 0:
        trailing_pe = None
    roe = num(info.get("returnOnEquity"), 4)
    if roe is not None and roe <= 0:
        roe = None

    dividend_yield = num(info.get("dividendYield"), 4)
    if dividend_yield is not None and dividend_yield > 0.2:  # 구형 퍼센트 단위 방어
        dividend_yield = round(dividend_yield / 100, 4)

    metrics = {
        "trailingPE": trailing_pe,
        "forwardPE": num(info.get("forwardPE")),
        "priceToBook": num(info.get("priceToBook")),
        "priceToSales": num(info.get("priceToSalesTrailing12Months")),
        "roe": roe,
        "profitMargin": num(info.get("profitMargins"), 4),
        "operatingMargin": num(info.get("operatingMargins"), 4),
        "debtToEquity": num(info.get("debtToEquity")),
        "revenueGrowth": num(info.get("revenueGrowth"), 4),
        "earningsGrowth": num(info.get("earningsGrowth"), 4),
        "dividendYield": dividend_yield,
        "beta": num(info.get("beta")),
        "totalRevenue": clean(info.get("totalRevenue")),
    }

    profit_margin = metrics["profitMargin"]
    # '적자 기업'은 근거가 있을 때만 판정: 순이익률이 실제로 0 이하이거나
    # yfinance가 음수 PER를 반환한 경우. 지표가 그냥 없으면(데이터 부재) 적자로 단정하지 않는다.
    is_loss = profit_margin is not None and profit_margin <= 0

    # 적자 기업만 분기 영업이익 추세 추가 조회 (API 부하 절감)
    oi_trend_ok = None   # None = 데이터 없음
    oi_recent_profit = None
    if is_loss:
        q = fetch_quarterly_oi(entry["ticker"])
        if q and len(q) >= 2:
            oi_recent_profit = q[0] > 0
            oi_trend_ok = q[0] > q[-1]  # 손실 축소(또는 이익 증가) 추세

    # 낶은 지표 (체크용, 스키마 외)
    gross_margin = num(info.get("grossMargins"), 4)
    current_ratio = num(info.get("currentRatio"))
    total_cash = clean(info.get("totalCash"))
    total_debt = clean(info.get("totalDebt"))
    fcf = clean(info.get("freeCashflow"))

    # 모멘텀
    pos52 = None
    if price is not None and high52 and low52 and high52 > low52:
        pos52 = (price - low52) / (high52 - low52)
        pos52 = max(0.0, min(1.0, pos52))
    ret3m = None
    if len(closes) > CFG.RET3M_DAYS and closes[-CFG.RET3M_DAYS - 1]["close"]:
        ret3m = closes[-1]["close"] / closes[-CFG.RET3M_DAYS - 1]["close"] - 1
    ma50 = None
    if len(closes) >= CFG.MA_WINDOW:
        ma50 = sum(c["close"] for c in closes[-CFG.MA_WINDOW:]) / CFG.MA_WINDOW

    return {
        "quote": {
            "price": price,
            "changePct": change_pct,
            "fiftyTwoWeekHigh": high52,
            "fiftyTwoWeekLow": low52,
            "marketCap": int(market_cap) if market_cap else None,
            "volume": clean(info.get("regularMarketVolume")) or 0,
        },
        "metrics": metrics,
        "isLoss": is_loss,
        "extra": {
            "grossMargin": gross_margin,
            "currentRatio": current_ratio,
            "cashGtDebt": (total_cash is not None and total_debt is not None
                           and total_cash > total_debt),
            "cashDebtKnown": total_cash is not None and total_debt is not None,
            "fcfPositive": (fcf > 0) if fcf is not None else None,
            "oiTrendOk": oi_trend_ok,
            "oiRecentProfit": oi_recent_profit,
            "pos52": pos52,
            "ret3m": ret3m,
            "aboveMa50": (price > ma50) if (price is not None and ma50) else None,
        },
        "closes": closes,
    }


# ─────────────────────────────────────────────────────────────
# 3단계: 점수 (투명한 check 근거)
# ─────────────────────────────────────────────────────────────

def chk(label: str, passed: bool, detail: str) -> dict:
    return {"label": label, "pass": bool(passed), "detail": detail}


def score_valuation(m: dict, is_loss: bool, sector_pe) -> dict:
    checks: list[dict] = []
    if not is_loss:
        pe = m["trailingPE"]
        if pe is not None and pe > CFG.PE_OVERHEAT:
            checks.append(chk("과열 캡", False,
                              f"PER {fmt(pe, 0)}배 > {CFG.PE_OVERHEAT}배 → 과열 단일 판정, 점수 상한 {CFG.OVERHEAT_VALUATION_SCORE}점"))
            return {"score": CFG.OVERHEAT_VALUATION_SCORE, "checks": checks}
        if pe is None:
            checks.append(chk("PER 절대 수준", False, "PER 데이터 없음"))
            checks.append(chk("PER 절대 수준(완화)", False, "PER 데이터 없음"))
        else:
            checks.append(chk(f"PER ≤ {CFG.PE_CHEAP}배", pe <= CFG.PE_CHEAP,
                              f"PER {fmt(pe)}배 (저평가 기준 {CFG.PE_CHEAP}배)"))
            checks.append(chk(f"PER ≤ {CFG.PE_FAIR}배", pe <= CFG.PE_FAIR,
                              f"PER {fmt(pe)}배 (적정 기준 {CFG.PE_FAIR}배)"))
        if pe is not None and sector_pe is not None:
            checks.append(chk("PER 그룹 중앙값 이하", pe <= sector_pe,
                              f"PER {fmt(pe)}배 vs 그룹 중앙값 {fmt(sector_pe)}배"))
        else:
            checks.append(chk("PER 그룹 중앙값 이하", False, "비교 그룹 데이터 부족"))
        pb = m["priceToBook"]
        checks.append(chk(f"PBR ≤ {CFG.PB_FAIR}배",
                          pb is not None and pb <= CFG.PB_FAIR,
                          f"PBR {fmt(pb)}배" if pb is not None else "PBR 데이터 없음"))
        ps = m["priceToSales"]
        checks.append(chk(f"PSR ≤ {CFG.PS_FAIR}배",
                          ps is not None and ps <= CFG.PS_FAIR,
                          f"PSR {fmt(ps)}배" if ps is not None else "PSR 데이터 없음"))
    else:
        ps = m["priceToSales"]
        rg = m["revenueGrowth"]
        fpe = m["forwardPE"]
        checks.append(chk(f"PSR ≤ {CFG.PS_CHEAP}배",
                          ps is not None and ps <= CFG.PS_CHEAP,
                          f"PSR {fmt(ps)}배 (적자 기업 대체 지표)" if ps is not None else "PSR 데이터 없음"))
        checks.append(chk(f"PSR ≤ {CFG.PS_FAIR_LOSS}배",
                          ps is not None and ps <= CFG.PS_FAIR_LOSS,
                          f"PSR {fmt(ps)}배" if ps is not None else "PSR 데이터 없음"))
        checks.append(chk(f"매출성장률 ≥ {pct(CFG.REV_GROWTH_STRONG)}",
                          rg is not None and rg >= CFG.REV_GROWTH_STRONG,
                          f"매출성장률 {pct(rg)}" if rg is not None else "매출성장률 데이터 없음"))
        checks.append(chk(f"매출성장률 ≥ {pct(CFG.REV_GROWTH_VERY_STRONG)}",
                          rg is not None and rg >= CFG.REV_GROWTH_VERY_STRONG,
                          f"매출성장률 {pct(rg)}" if rg is not None else "매출성장률 데이터 없음"))
        checks.append(chk("흑자 전환 기대", fpe is not None and fpe > 0,
                          f"forward PER {fmt(fpe)}배 존재" if fpe else "forward PER 없음 (흑자 전망 부재)"))
    return {"score": sum(c["pass"] for c in checks), "checks": checks}


def score_growth(m: dict, is_loss: bool) -> dict:
    rg, eg = m["revenueGrowth"], m["earningsGrowth"]
    checks = [
        chk(f"매출성장률 ≥ {pct(CFG.REV_GROWTH_OK)}", rg is not None and rg >= CFG.REV_GROWTH_OK,
            f"매출성장률 {pct(rg)}" if rg is not None else "매출성장률 데이터 없음"),
        chk(f"매출성장률 ≥ {pct(CFG.REV_GROWTH_HIGH)}", rg is not None and rg >= CFG.REV_GROWTH_HIGH,
            f"매출성장률 {pct(rg)}" if rg is not None else "매출성장률 데이터 없음"),
        chk(f"순이익성장률 ≥ {pct(CFG.EARN_GROWTH_OK)}", eg is not None and eg >= CFG.EARN_GROWTH_OK,
            f"순이익성장률 {pct(eg)}" if eg is not None else "순이익성장률 데이터 없음"),
        chk(f"순이익성장률 ≥ {pct(CFG.EARN_GROWTH_HIGH)}", eg is not None and eg >= CFG.EARN_GROWTH_HIGH,
            f"순이익성장률 {pct(eg)}" if eg is not None else "순이익성장률 데이터 없음"),
    ]
    tpe, fpe = m["trailingPE"], m["forwardPE"]
    if is_loss:
        checks.append(chk("흑자 전환 기대", fpe is not None and fpe > 0,
                          f"forward PER {fmt(fpe)}배 존재" if fpe else "forward PER 없음"))
    else:
        ok = tpe is not None and fpe is not None and fpe <= tpe
        if tpe is not None and fpe is not None:
            detail = (f"forward PER {fmt(fpe)}배 ≤ 현재 PER {fmt(tpe)}배 → 이익 증가 예상" if ok
                      else f"forward PER {fmt(fpe)}배 > 현재 PER {fmt(tpe)}배 → 이익 감소 예상")
        else:
            detail = "forward PER 데이터 없음"
        checks.append(chk("이익 개선 기대", ok, detail))
    return {"score": sum(c["pass"] for c in checks), "checks": checks}


def score_profitability(m: dict, is_loss: bool, extra: dict) -> dict:
    checks: list[dict] = []
    if not is_loss:
        roe, opm, npm = m["roe"], m["operatingMargin"], m["profitMargin"]
        checks = [
            chk(f"ROE ≥ {pct(CFG.ROE_OK)}", roe is not None and roe >= CFG.ROE_OK,
                f"ROE {pct(roe)}" if roe is not None else "ROE 데이터 없음"),
            chk(f"ROE ≥ {pct(CFG.ROE_GOOD)}", roe is not None and roe >= CFG.ROE_GOOD,
                f"ROE {pct(roe)} (시장 평균 15~20% 기준)" if roe is not None else "ROE 데이터 없음"),
            chk(f"영업이익률 ≥ {pct(CFG.OPM_OK)}", opm is not None and opm >= CFG.OPM_OK,
                f"영업이익률 {pct(opm)}" if opm is not None else "영업이익률 데이터 없음"),
            chk(f"영업이익률 ≥ {pct(CFG.OPM_GOOD)}", opm is not None and opm >= CFG.OPM_GOOD,
                f"영업이익률 {pct(opm)}" if opm is not None else "영업이익률 데이터 없음"),
            chk(f"순이익률 ≥ {pct(CFG.NPM_OK)}", npm is not None and npm >= CFG.NPM_OK,
                f"순이익률 {pct(npm)}" if npm is not None else "순이익률 데이터 없음"),
        ]
    else:
        gm = extra["grossMargin"]
        trend, recent = extra["oiTrendOk"], extra["oiRecentProfit"]
        checks = [
            chk(f"매출총이익률 ≥ {pct(CFG.GM_OK)}", gm is not None and gm >= CFG.GM_OK,
                f"매출총이익률 {pct(gm)}" if gm is not None else "매출총이익률 데이터 없음"),
            chk(f"매출총이익률 ≥ {pct(CFG.GM_GOOD)}", gm is not None and gm >= CFG.GM_GOOD,
                f"매출총이익률 {pct(gm)}" if gm is not None else "매출총이익률 데이터 없음"),
            chk("영업손실 축소 추세", trend is True,
                ("최근 4분기 영업이익 개선" if trend else "최근 4분기 영업이익 악화·정체")
                if trend is not None else "분기 영업이익 데이터 없음"),
            chk("최근 분기 영업 흑자", recent is True,
                ("최근 분기 영업이익 흑자" if recent else "최근 분기 영업 적자 지속")
                if recent is not None else "분기 영업이익 데이터 없음"),
            chk("흑자 전환 기대", m["forwardPE"] is not None and m["forwardPE"] > 0,
                f"forward PER {fmt(m['forwardPE'])}배 존재" if m["forwardPE"] else "forward PER 없음"),
        ]
    return {"score": sum(c["pass"] for c in checks), "checks": checks}


def score_financial_health(m: dict, extra: dict) -> dict:
    de = m["debtToEquity"]
    cr = extra["currentRatio"]
    checks = [
        chk(f"부채비율 ≤ {CFG.DE_OK}%", de is not None and de <= CFG.DE_OK,
            f"부채비율 {fmt(de, 0)}%" if de is not None else "부채비율 데이터 없음"),
        chk(f"부채비율 ≤ {CFG.DE_GOOD}%", de is not None and de <= CFG.DE_GOOD,
            f"부채비율 {fmt(de, 0)}%" if de is not None else "부채비율 데이터 없음"),
        chk(f"유동비율 ≥ {CFG.CURRENT_RATIO_OK}", cr is not None and cr >= CFG.CURRENT_RATIO_OK,
            f"유동비율 {fmt(cr)}" if cr is not None else "유동비율 데이터 없음"),
        chk("총현금 > 총부채", extra["cashGtDebt"] is True,
            ("보유 현금이 총부채보다 많음" if extra["cashGtDebt"] else "총현금이 총부채 이하")
            if extra["cashDebtKnown"] else "현금·부채 데이터 없음"),
        chk("잉여현금흐름 흑자", extra["fcfPositive"] is True,
            ("잉여현금흐름 흑자" if extra["fcfPositive"] else "잉여현금흐름 적자 또는 0")
            if extra["fcfPositive"] is not None else "잉여현금흐름 데이터 없음"),
    ]
    return {"score": sum(c["pass"] for c in checks), "checks": checks}


def score_momentum(extra: dict) -> dict:
    pos, r3, ma = extra["pos52"], extra["ret3m"], extra["aboveMa50"]
    checks = [
        chk(f"52주 위치 ≥ {pct(CFG.POS_OK)}", pos is not None and pos >= CFG.POS_OK,
            f"52주 범위의 {pct(pos)} 지점" if pos is not None else "52주 범위 데이터 없음"),
        chk(f"52주 위치 ≥ {pct(CFG.POS_GOOD)}", pos is not None and pos >= CFG.POS_GOOD,
            f"52주 범위의 {pct(pos)} 지점" if pos is not None else "52주 범위 데이터 없음"),
        chk("3개월 수익률 > 0%", r3 is not None and r3 > CFG.RET3M_OK,
            f"3개월 수익률 {pct(r3, 1)}" if r3 is not None else "3개월 수익률 데이터 없음"),
        chk(f"3개월 수익률 ≥ {pct(CFG.RET3M_GOOD)}", r3 is not None and r3 >= CFG.RET3M_GOOD,
            f"3개월 수익률 {pct(r3, 1)}" if r3 is not None else "3개월 수익률 데이터 없음"),
        chk(f"현재가 > {CFG.MA_WINDOW}일 이동평균", ma is True,
            (f"{CFG.MA_WINDOW}일선 상회" if ma else f"{CFG.MA_WINDOW}일선 하회")
            if ma is not None else "이동평균 데이터 부족"),
    ]
    score = sum(c["pass"] for c in checks)
    if pos is not None and pos >= CFG.OVERHEAT_POS:
        checks.append(chk("52주 고점 근처 과열 감점", False,
                          f"52주 위치 {pct(pos)} ≥ {pct(CFG.OVERHEAT_POS)} → {CFG.OVERHEAT_PENALTY}점 감점"))
        score = max(0, score - CFG.OVERHEAT_PENALTY)
    return {"score": score, "checks": checks}


# ─────────────────────────────────────────────────────────────
# 4단계: insights (토스식 한 줄 해석)
# ─────────────────────────────────────────────────────────────

def build_insights(m: dict, extra: dict, is_loss: bool, sector_pe, entry: dict) -> list[str]:
    out: list[str] = []

    # 밸류에이션
    pe, ps = m["trailingPE"], m["priceToSales"]
    if is_loss:
        if ps is not None:
            out.append(f"지금은 적자라 PER을 계산할 수 없어요. 대신 매출 대비 시가총액(PSR) "
                       f"{fmt(ps)}배와 매출 성장률로 가치를 가늠해요.")
        else:
            out.append("지금은 적자라 PER을 계산할 수 없어요. 매출 성장률과 손익분기점 도달 여부를 봐야 해요.")
    elif pe is not None:
        if pe > CFG.PE_OVERHEAT:
            out.append(f"PER이 {fmt(pe, 0)}배로, 1년 이익의 {fmt(pe, 0)}배 가격이에요. "
                       f"이익 대비 아주 비싼 '과열' 구간으로 볼 수 있어요.")
        else:
            s = f"PER이 {fmt(pe)}배로, 이 회사가 1년에 버는 이익의 {fmt(pe, 0)}배 가격에 거래돼요."
            if sector_pe is not None:
                if pe > sector_pe * 1.2:
                    s += f" 같은 그룹 중앙값({fmt(sector_pe)}배)보다 높은 편이에요."
                elif pe < sector_pe * 0.8:
                    s += f" 같은 그룹 중앙값({fmt(sector_pe)}배)보다 낮은 편이에요."
                else:
                    s += f" 같은 그룹 중앙값({fmt(sector_pe)}배)과 비슷한 수준이에요."
            out.append(s)

    # 성장
    rg = m["revenueGrowth"]
    if rg is not None:
        if rg >= CFG.REV_GROWTH_HIGH:
            out.append(f"매출이 1년 전보다 {pct(rg)} 늘었어요. 성장 속도가 빠른 편이에요.")
        elif rg >= CFG.REV_GROWTH_OK:
            out.append(f"매출이 1년 전보다 {pct(rg)} 늘었어요. 꾸준히 성장하고 있어요.")
        elif rg >= 0:
            out.append(f"매출이 1년 전보다 {pct(rg)} 늘었어요. 성장 속도는 완만한 편이에요.")
        else:
            out.append(f"매출이 1년 전보다 {pct(rg)} 줄었어요. 역성장 여부를 눈여겨봐야 해요.")

    # 수익성
    if is_loss:
        opm = m["operatingMargin"]
        s = "아직 이익을 내지 못하고 있는 적자 기업이에요."
        if opm is not None:
            s += f" 영업이익률은 {pct(opm)}예요."
        s += " 손익분기점에 얼마나 가까워졌는지가 관건이에요."
        out.append(s)
    else:
        roe = m["roe"]
        if roe is not None:
            if roe >= CFG.ROE_GOOD:
                out.append(f"ROE가 {pct(roe)}예요. 주주가 맡긴 100원으로 1년에 {fmt(roe * 100, 0)}원을 "
                           f"벌었다는 뜻으로, 자본 효율이 좋은 편이에요.")
            elif roe >= CFG.ROE_OK:
                out.append(f"ROE가 {pct(roe)}예요. 주주 자본 대비 이익 효율이 평균적인 수준이에요.")
            else:
                out.append(f"ROE가 {pct(roe)}예요. 자본 대비 이익 효율이 낮은 편이에요.")

    # 재무
    de = m["debtToEquity"]
    if de is not None:
        if de <= CFG.DE_GOOD:
            s = f"부채비율이 {fmt(de, 0)}%로, 빚 부담이 크지 않은 안정적인 편이에요."
        elif de <= CFG.DE_OK:
            s = f"부채비율이 {fmt(de, 0)}%로, 일반적인 안정 기준(100%) 안에 있어요."
        else:
            s = f"부채비율이 {fmt(de, 0)}%로, 자기자본 대비 빚이 많은 편이라 이자 부담을 살펴야 해요."
        if extra["cashGtDebt"]:
            s += " 보유 현금이 총부채보다 많은 실질 무차입 구조예요."
        out.append(s)

    # 모멘텀
    pos, r3 = extra["pos52"], extra["ret3m"]
    if pos is not None:
        s = f"현재 주가는 52주 최저~최고 범위의 {pct(pos)} 지점이에요."
        if pos >= CFG.OVERHEAT_POS:
            s += " 52주 고점에 가까워 단기 과열 신호로 볼 수 있어요."
        elif pos <= 0.2:
            s += " 52주 저점 근처라 악재 반영 또는 저평가 구간일 수 있어요."
        if r3 is not None:
            s += f" 최근 3개월 수익률은 {pct(r3, 1)}예요."
        out.append(s)

    # 베타
    beta = m["beta"]
    if beta is not None and beta >= CFG.BETA_HIGH:
        out.append(f"베타가 {fmt(beta)}로, 시장이 1% 움직일 때 이 주식은 평균 {fmt(beta)}% "
                   f"움직여 왔어요. 흔들림이 큰 편이에요.")

    # 문장 수 보정: 최소 3개 보장
    if len(out) < 3:
        flags = build_risk_flags(entry, m, {"marketCap": None}, is_loss)
        if flags:
            out.append(f"이 종목에는 '{'·'.join(flags[:2])}' 주의 배지가 붙어 있어요. "
                       f"배지 설명을 함께 확인해 보세요.")
    if len(out) < 3:
        out.append("일부 재무 지표는 데이터가 부족해요. 지표 카드에서 'N/A' 표시를 확인해 주세요.")
    if len(out) < 3:
        out.append(f"이 데이터는 {AS_OF} 기준이에요. 지표는 시시각각 바뀌니 최신 값을 확인해 보세요.")
    return out[:5]


# ─────────────────────────────────────────────────────────────
# 5단계: 리스크 플래그 / priceHistory / sectorAvg
# ─────────────────────────────────────────────────────────────

def build_risk_flags(entry: dict, m: dict, quote: dict, is_loss: bool) -> list[str]:
    flags = list(entry.get("extraRiskFlags") or [])
    if is_loss:
        flags.append("적자 기업")
    pe = m["trailingPE"]
    if pe is not None and pe >= CFG.PE_RISK_FLAG:
        flags.append("고PER (100배 이상)")
    if m["beta"] is not None and m["beta"] >= CFG.BETA_HIGH:
        flags.append("고변동성")
    if entry["ticker"].endswith((".SS", ".SZ")):
        flags.append("중국 A주 조회 전용")
    mc = quote.get("marketCap")
    th = CFG.SMALL_CAP_THRESHOLD.get(entry["currency"])
    if mc is not None and th is not None and mc < th:
        flags.append("소형주")
    # 중복 제거 (순서 유지)
    seen, out = set(), []
    for f in flags:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def weekly_sample(closes: list[dict]) -> list[dict]:
    """1년 일봉 → 주 1개(약 52포인트) 샘플링. 마지막 포인트는 반드시 포함."""
    if not closes:
        return []
    step = max(1, len(closes) // CFG.HISTORY_WEEKLY_POINTS)
    sampled = closes[::step]
    if sampled[-1] is not closes[-1]:
        sampled.append(closes[-1])
    out = []
    for c in sampled:
        v = c["close"]
        out.append({"date": c["date"], "close": round(v, 0) if v >= 10000 else round(v, 2)})
    return out


def group_key(entry: dict) -> str:
    return f"{entry['market']}:{entry['theme'][0]}"


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

def main() -> int:
    print(f"[refresh_data] 기준일 {AS_OF} / 방법론 v{CFG.METHODOLOGY_VERSION}")
    if FORCE_REFRESH:
        print("[refresh_data] --refresh: 캐시 무시")

    raw_by_ticker: dict[str, dict] = {}
    failed: list[str] = []
    for i, entry in enumerate(UNIVERSE, 1):
        t = entry["ticker"]
        print(f"  ({i:2d}/{len(UNIVERSE)}) {t} ...", flush=True)
        raw = load_or_fetch(t)
        if raw is None:
            failed.append(t)
        else:
            raw_by_ticker[t] = raw
        time.sleep(CFG.INTER_TICKER_SLEEP_SEC)

    if "SPCX" in failed:
        print("[주의] SPCX(스페이스X) 조회 실패 → 유니버스에서 제외하고 진행합니다.")
    print(f"[수집 결과] 성공 {len(raw_by_ticker)}개 / 실패 {len(failed)}개: {', '.join(failed) or '없음'}")
    if len(raw_by_ticker) < CFG.MIN_SUCCESS:
        print(f"[오류] 성공 {len(raw_by_ticker)}개 < 최소 {CFG.MIN_SUCCESS}개 → 파이프라인 중단")
        return 1

    # 지표 추출
    extracted: dict[str, dict] = {}
    for entry in UNIVERSE:
        t = entry["ticker"]
        if t not in raw_by_ticker:
            continue
        try:
            extracted[t] = extract(entry, raw_by_ticker[t])
        except Exception as e:  # noqa: BLE001
            print(f"  [추출 실패] {t}: {e}")
            failed.append(t)
            raw_by_ticker.pop(t, None)

    # sectorAvg: market+theme[0] 그룹 내 양수 PER/PSR 중앙값
    groups: dict[str, dict[str, list[float]]] = {}
    for entry in UNIVERSE:
        t = entry["ticker"]
        if t not in extracted:
            continue
        g = groups.setdefault(group_key(entry), {"pe": [], "ps": []})
        m = extracted[t]["metrics"]
        if m["trailingPE"] is not None and m["trailingPE"] > 0:
            g["pe"].append(m["trailingPE"])
        if m["priceToSales"] is not None and m["priceToSales"] > 0:
            g["ps"].append(m["priceToSales"])
    sector_med = {
        k: {
            "pe": round(statistics.median(v["pe"]), 2) if v["pe"] else None,
            "ps": round(statistics.median(v["ps"]), 2) if v["ps"] else None,
        }
        for k, v in groups.items()
    }

    # 종목 조립
    stocks: list[dict] = []
    for entry in UNIVERSE:
        t = entry["ticker"]
        if t not in extracted:
            continue
        x = extracted[t]
        m, extra, quote = x["metrics"], x["extra"], x["quote"]
        is_loss = x["isLoss"]
        med = sector_med.get(group_key(entry), {"pe": None, "ps": None})

        valuation = score_valuation(m, is_loss, med["pe"])
        growth = score_growth(m, is_loss)
        profitability = score_profitability(m, is_loss, extra)
        health = score_financial_health(m, extra)
        momentum = score_momentum(extra)
        total = round(
            valuation["score"] * CFG.AXIS_WEIGHTS["valuation"]
            + growth["score"] * CFG.AXIS_WEIGHTS["growth"]
            + profitability["score"] * CFG.AXIS_WEIGHTS["profitability"]
            + health["score"] * CFG.AXIS_WEIGHTS["financialHealth"]
            + momentum["score"] * CFG.AXIS_WEIGHTS["momentum"], 1)

        stocks.append({
            "ticker": t,
            "name": entry["name"],
            "nameEn": entry["nameEn"],
            "market": entry["market"],
            "currency": entry["currency"],
            "theme": entry["theme"],
            "description": entry["description"],
            "beginnerFit": entry["beginnerFit"],
            "valueChain": entry.get("valueChain"),
            "exampleTermHints": entry.get("exampleTermHints", []),
            "quote": quote,
            "metrics": m,
            "scores": {
                "valuation": valuation,
                "growth": growth,
                "profitability": profitability,
                "financialHealth": health,
                "momentum": momentum,
                "total": total,
            },
            "insights": build_insights(m, extra, is_loss, med["pe"], entry),
            "priceHistory": weekly_sample(x["closes"]),
            "sectorAvg": med,
            "riskFlags": build_risk_flags(entry, m, quote, is_loss),
            "asOf": AS_OF,
            "methodologyVersion": CFG.METHODOLOGY_VERSION,
        })

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(stocks, ensure_ascii=False, indent=1), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"[완료] {OUT_PATH} — {len(stocks)}개 종목, {size_kb:.0f} KB")
    if failed:
        print(f"[제외된 티커] {', '.join(sorted(set(failed)))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
