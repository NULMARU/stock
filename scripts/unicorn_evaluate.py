#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 유니콘(저평가+내실+성장 3축 가치주) 평가 파이프라인.

research/unicorn_research.md §2의 채점표를 구현한다.
  · 밸류에이션 40 / 퀄리티 35 / 성장 25, 100점 만점
  · 결측(null) 항목은 배점 제외 후 (획득/응시만점)×축 가중치로 정규화
  · 가치 함정 필터 T1~T4, 금융 섹터 보정, PEG 폴스백 규칙 적용
  · 총점 ≥ 65 종목만 src/data/unicorns.json 과 public/data/unicorns.json 에 저장

실행 (scripts/ 디렉터리 기준):
    python3 unicorn_evaluate.py            # 당일 캐시 재사용
    python3 unicorn_evaluate.py --refresh  # 캐시 무시하고 전부 재수집
"""

from __future__ import annotations

import json
import math
import sys
import time
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

from unicorn_candidates import CANDIDATES
import unicorn_config as CFG

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent
OUT_PATHS = [
    ROOT.parent / "src" / "data" / "unicorns.json",
    ROOT.parent / "public" / "data" / "unicorns.json",
]
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
    value = clean(value)
    if value is None or not isinstance(value, (int, float)):
        return None
    return round(float(value), digits)


def pct(x: float, digits=1) -> str:
    return f"{x * 100:.{digits}f}%"


def fmt(x: float, digits=1) -> str:
    s = f"{x:,.{digits}f}"
    if digits > 0 and s.endswith("." + "0" * digits):
        s = s[: -(digits + 1)]
    return s


# ─────────────────────────────────────────────────────────────
# 1단계: 수집 (당일 캐시 재사용, 재시도 1회)
# ─────────────────────────────────────────────────────────────

# 미국 클래스주는 yfinance에서 대시 형식만 인식 (BRK.B → BRK-B).
# 거래소 접미사(.KS/.KQ/.HK/.SS/.SZ)가 있는 티커는 그대로 둔다.
_EXCHANGE_SUFFIXES = (".KS", ".KQ", ".HK", ".SS", ".SZ")


def to_yf(ticker: str) -> str:
    if ticker.upper().endswith(_EXCHANGE_SUFFIXES):
        return ticker
    return ticker.replace(".", "-")


def fetch_raw(ticker: str) -> dict:
    t = yf.Ticker(to_yf(ticker))
    info = t.info or {}
    return {"info": {k: clean(v) for k, v in info.items()}}


def load_or_fetch(ticker: str) -> dict | None:
    """당일 캐시가 있으면 재사용, 없으면 재시도 1회 포함해 수집."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"unicorn_{ticker.replace('.', '_')}_{AS_OF}.json"
    if cache_file.exists() and not FORCE_REFRESH:
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    last_err: Exception | None = None
    for attempt in range(CFG.RETRY_COUNT + 1):
        try:
            raw = fetch_raw(ticker)
            info = raw["info"] or {}
            price = info.get("currentPrice") or info.get("regularMarketPrice") \
                or info.get("previousClose")
            if price is None and not info.get("marketCap"):
                raise ValueError("가격·시총 데이터 없음 (조회 불가 티커)")
            cache_file.write_text(
                json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            return raw
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < CFG.RETRY_COUNT:
                time.sleep(CFG.RETRY_SLEEP_SEC)
    print(f"  [수집 실패] {ticker}: {last_err}", flush=True)
    return None


# ─────────────────────────────────────────────────────────────
# 2단계: 지표 추출
# ─────────────────────────────────────────────────────────────

COVERAGE_FIELDS = [
    "trailingPE", "forwardPE", "priceToBook", "fcfYield", "roe", "roa",
    "operatingMargin", "profitMargin", "debtToEquity", "currentRatio",
    "revenueGrowth", "earningsGrowth",
]


def extract(entry: dict, raw: dict) -> dict:
    """yfinance info → 채점용 표준 지표 dict."""
    info = raw["info"] or {}

    price = num(info.get("currentPrice") or info.get("regularMarketPrice")
                or info.get("previousClose"))
    change_pct = num(info.get("regularMarketChangePercent"))
    market_cap = clean(info.get("marketCap"))
    if market_cap is None and price and clean(info.get("sharesOutstanding")):
        market_cap = price * info["sharesOutstanding"]

    dividend_yield = num(info.get("dividendYield"), 4)
    if dividend_yield is not None and dividend_yield > 0.2:  # 구형 퍼센트 단위 방어
        dividend_yield = round(dividend_yield / 100, 4)

    fcf = clean(info.get("freeCashflow"))
    fcf_yield = None
    if fcf is not None and market_cap:
        fcf_yield = round(fcf / market_cap, 4)

    earnings_growth = num(info.get("earningsGrowth"), 4)
    forward_pe = num(info.get("forwardPE"))
    trailing_pe = num(info.get("trailingPE"))
    if trailing_pe is not None and trailing_pe <= 0:
        trailing_pe = None  # 적자 기업의 음수 PER는 결측 처리
    price_to_book = num(info.get("priceToBook"))
    if price_to_book is not None and price_to_book <= 0:
        price_to_book = None  # 0 이하 PBR은 이상치(결산 공백 등) → 결측 처리
    peg = num(info.get("pegRatio"))
    peg_recomputed = False
    if peg is not None and (peg <= 0 or peg > CFG.PEG_OUTLIER):
        peg = None  # pegRatio 이상치 → 직접 재계산으로 폴스백
        peg_recomputed = True
    # PEG 폴스백: pegRatio 결측·이상치 시 forwardPE / (earningsGrowth×100) 직접 계산.
    # 일회성 이익 급증 왜곡 방지로 성장률은 PEG_GROWTH_CAP 상한 적용.
    if peg is None and forward_pe is not None and forward_pe > 0 \
            and earnings_growth is not None and earnings_growth > 0:
        g = min(earnings_growth, CFG.PEG_GROWTH_CAP)
        peg = round(forward_pe / (g * 100), 2)

    # 금융 섹터 판정: yfinance sector 우선, 결측 시 후보 풀 힌트
    sector = info.get("sector")
    is_financial = (sector == "Financial Services") if sector else bool(entry["financial"])

    m = {
        "trailingPE": trailing_pe,
        "forwardPE": forward_pe,
        "priceToBook": price_to_book,
        "peg": peg,
        "pegRecomputed": peg_recomputed and peg is not None,
        "fcfYield": fcf_yield,
        "fcfPositive": (fcf > 0) if fcf is not None else None,
        "roe": num(info.get("returnOnEquity"), 4),
        "roa": num(info.get("returnOnAssets"), 4),
        "operatingMargin": num(info.get("operatingMargins"), 4),
        "profitMargin": num(info.get("profitMargins"), 4),
        "debtToEquity": num(info.get("debtToEquity")),
        "currentRatio": num(info.get("currentRatio")),
        "revenueGrowth": num(info.get("revenueGrowth"), 4),
        "earningsGrowth": earnings_growth,
        # 배당 미지급(None)은 0%로 간주 (리서치 §2-C4: 0점 기준이 '0%')
        "dividendYield": dividend_yield if dividend_yield is not None else 0.0,
        "marketCap": int(market_cap) if market_cap else None,
    }
    coverage = sum(1 for k in COVERAGE_FIELDS if m[k] is not None) / len(COVERAGE_FIELDS)
    return {
        "metrics": m,
        "isFinancial": is_financial,
        "sector": sector,
        "coverage": coverage,
        "quote": {"price": price, "changePct": change_pct,
                  "marketCap": int(market_cap) if market_cap else None},
    }


def exclusion_reason(x: dict, entry: dict) -> str | None:
    """평가 제외 사유. None이면 평가 진행.

    - 지표 결측 50% 초과 (리서치 §5-4-a)
    - 시장별 최소 시가총액 미달 (리서치 §5-4-b)
    """
    if x["coverage"] < CFG.MIN_METRIC_COVERAGE:
        return "지표 결측 50% 초과"
    m = x["metrics"]
    mc_th = CFG.MIN_MARKET_CAP.get(entry["currency"])
    if mc_th and m["marketCap"] is not None and m["marketCap"] < mc_th:
        return "시총 하한 미달"
    return None


# ─────────────────────────────────────────────────────────────
# 3단계: 3축 채점 (투명한 check 근거 + 결측 정규화)
# ─────────────────────────────────────────────────────────────

def _chk(label: str, passed: bool, detail: str, earned: float, applicable: float) -> dict:
    return {"label": label, "pass": bool(passed), "detail": detail,
            "earned": earned, "applicable": applicable}


def _missing(label: str) -> dict:
    return _chk(label, False, "데이터 없음 (배점 제외 후 정규화)", 0.0, 0.0)


def _band(label: str, value, full, partial, points: float,
          higher_better: bool, fmt_fn, unit_desc: str) -> dict:
    """만점/부분(50%)/0점 3단 채점. value None → 결측(배점 제외)."""
    if value is None:
        return _missing(label)
    v = float(value)
    if higher_better:
        is_full, is_partial = v >= full, v >= partial
    else:
        is_full, is_partial = v <= full, v <= partial
    vs = fmt_fn(v)
    if is_full:
        return _chk(label, True, f"{label} {vs} — 만점 기준({unit_desc}) 충족",
                    points, points)
    if is_partial:
        th = fmt_fn(partial)
        return _chk(label, False, f"{label} {vs} — 부분 기준({th})만 충족 (50% 배점)",
                    points / 2, points)
    th = fmt_fn(partial)
    return _chk(label, False, f"{label} {vs} — 부분 기준({th}) 미달", 0.0, points)


def score_valuation(m: dict) -> tuple[list[dict], list[str]]:
    """밸류에이션 축 체크 목록과 함정 플래그를 반환."""
    flags: list[str] = []
    pe, fpe, pb, peg, fy = (m["trailingPE"], m["forwardPE"], m["priceToBook"],
                            m["peg"], m["fcfYield"])
    checks = [
        _band("PER(트레일링)", pe, CFG.PE_FULL, CFG.PE_PARTIAL, CFG.A1_POINTS,
              False, lambda v: f"{fmt(v)}배", f"≤{CFG.PE_FULL}배"),
        _band("PER(포워드)", fpe, CFG.FPE_FULL, CFG.FPE_PARTIAL, CFG.A2_POINTS,
              False, lambda v: f"{fmt(v)}배", f"≤{CFG.FPE_FULL}배"),
        _band("PBR", pb, CFG.PB_FULL, CFG.PB_PARTIAL, CFG.A3_POINTS,
              False, lambda v: f"{fmt(v)}배", f"≤{CFG.PB_FULL}배"),
    ]

    # A4 PEG: 성장률 ≤0이면 무의미 → 0점 (결측 제외 아님)
    if peg is None and m["earningsGrowth"] is not None and m["earningsGrowth"] <= 0:
        checks.append(_chk("PEG", False,
                           f"이익성장률 {pct(m['earningsGrowth'])} ≤ 0 → PEG 무의미, 0점",
                           0.0, CFG.A4_POINTS))
    else:
        c = _band("PEG", peg, CFG.PEG_FULL, CFG.PEG_PARTIAL, CFG.A4_POINTS,
                  False, lambda v: f"{fmt(v)}", f"≤{CFG.PEG_FULL}")
        if m.get("pegRecomputed") and c["applicable"] > 0:
            c["detail"] += f" (pegRatio 이상치 → 포워드PER/성장률(상한 {pct(CFG.PEG_GROWTH_CAP,0)}) 재계산)"
        checks.append(c)

    # A5 FCF 수익률
    if m["fcfPositive"] is False:
        checks.append(_chk("FCF 수익률", False, "잉여현금흐름 적자 → 0점",
                           0.0, CFG.A5_POINTS))
    else:
        checks.append(_band("FCF 수익률", fy, CFG.FCFY_FULL, CFG.FCFY_PARTIAL,
                            CFG.A5_POINTS, True, pct, f"≥{pct(CFG.FCFY_FULL, 0)}"))

    # T2 저PBR 함정: A3 점수 무효화
    if pb is not None and pb < CFG.T2_PB and m["roe"] is not None and m["roe"] < CFG.T2_ROE:
        for c in checks:
            if c["label"] == "PBR":
                c["earned"] = 0.0
                c["pass"] = False
                c["detail"] += f" → {CFG.T2_FLAG}: PBR<{CFG.T2_PB} & ROE<{pct(CFG.T2_ROE,0)}로 A3 무효화"
        flags.append(CFG.T2_FLAG)
    return checks, flags


def score_quality(m: dict, is_financial: bool) -> list[dict]:
    roe, roa, opm = m["roe"], m["roa"], m["operatingMargin"]
    checks: list[dict] = []

    if is_financial:
        # 금융 보정: B1 ROE 만점 기준 15%→10% 완화
        checks.append(_band("ROE(금융 완화)", roe, CFG.FIN_ROE_FULL, CFG.FIN_ROE_PARTIAL,
                            CFG.B1_POINTS, True, pct, f"≥{pct(CFG.FIN_ROE_FULL,0)}"))
        # 금융 보정: B2 ROA 기준 7%→1% 완화 (은행·보험은 레버리지 모델상 ROA ~1%가 우량)
        checks.append(_band("ROA(금융 완화)", roa, CFG.FIN_ROA_FULL, CFG.FIN_ROA_PARTIAL,
                            CFG.B2_POINTS, True, pct, f"≥{pct(CFG.FIN_ROA_FULL,1)}"))
    else:
        checks.append(_band("ROE", roe, CFG.ROE_FULL, CFG.ROE_PARTIAL,
                            CFG.B1_POINTS, True, pct, f"≥{pct(CFG.ROE_FULL,0)}"))
        checks.append(_band("ROA", roa, CFG.ROA_FULL, CFG.ROA_PARTIAL,
                            CFG.B2_POINTS, True, pct, f"≥{pct(CFG.ROA_FULL,0)}"))
    checks.append(_band("영업이익률", opm, CFG.OPM_FULL, CFG.OPM_PARTIAL,
                        CFG.B3_POINTS, True, pct, f"≥{pct(CFG.OPM_FULL,0)}"))

    # B4 순이익 흑자 AND FCF 흑자
    npm, fcfp = m["profitMargin"], m["fcfPositive"]
    if npm is None or fcfp is None:
        checks.append(_missing("순이익·FCF 흑자"))
    else:
        ok = npm > 0 and fcfp
        detail = (f"순이익률 {pct(npm)}·FCF {'흑자' if fcfp else '적자'}"
                  + (" → 충족" if ok else " → 미충족"))
        checks.append(_chk("순이익·FCF 흑자", ok, detail,
                           CFG.B4_POINTS if ok else 0.0, CFG.B4_POINTS))

    if is_financial:
        # 금융 보정: B5·B6(부채·유동성, 은행은 왜곡) 제외 → PBR 가산으로 대체
        checks.append(_band("PBR(금융 가산)", m["priceToBook"], CFG.FIN_PB_FULL,
                            CFG.FIN_PB_PARTIAL, CFG.FIN_PB_POINTS, False,
                            lambda v: f"{fmt(v)}배", f"≤{CFG.FIN_PB_FULL}배"))
    else:
        checks.append(_band("부채비율", m["debtToEquity"], CFG.DE_FULL, CFG.DE_PARTIAL,
                            CFG.B5_POINTS, False, lambda v: f"{fmt(v,0)}%",
                            f"≤{CFG.DE_FULL}%"))
        checks.append(_band("유동비율", m["currentRatio"], CFG.CR_FULL, CFG.CR_PARTIAL,
                            CFG.B6_POINTS, True, lambda v: f"{fmt(v)}",
                            f"≥{CFG.CR_FULL}"))
    return checks


def score_growth(m: dict) -> tuple[list[dict], list[str]]:
    flags: list[str] = []
    rg, eg, dy = m["revenueGrowth"], m["earningsGrowth"], m["dividendYield"]
    checks = [
        _band("매출성장률", rg, CFG.REVG_FULL, CFG.REVG_PARTIAL,
              CFG.C1_POINTS, True, pct, f"≥{pct(CFG.REVG_FULL,0)}"),
        _band("이익성장률", eg, CFG.EARG_FULL, CFG.EARG_PARTIAL,
              CFG.C2_POINTS, True, pct, f"≥{pct(CFG.EARG_FULL,0)}"),
    ]
    # C3 forwardPE < trailingPE
    tpe, fpe = m["trailingPE"], m["forwardPE"]
    if tpe is None or fpe is None:
        checks.append(_missing("이익 개선 기대(포워드<트레일링 PER)"))
    else:
        ok = fpe < tpe
        checks.append(_chk("이익 개선 기대", ok,
                           f"포워드 PER {fmt(fpe)}배 {'<' if ok else '≥'} 트레일링 PER {fmt(tpe)}배",
                           CFG.C3_POINTS if ok else 0.0, CFG.C3_POINTS))
    # C4 배당 (None은 extract에서 0으로 정규화됨)
    checks.append(_band("배당수익률", dy, CFG.DIV_FULL, CFG.DIV_PARTIAL,
                        CFG.C4_POINTS, True, pct, f"≥{pct(CFG.DIV_FULL,0)}"))

    # T4 배당 함정: 고배당인데 FCF 적자 또는 순이익 적자 → C4 0점
    if dy is not None and dy >= CFG.T4_DIV \
            and (m["fcfPositive"] is False
                 or (m["profitMargin"] is not None and m["profitMargin"] <= 0)):
        for c in checks:
            if c["label"] == "배당수익률":
                c["earned"] = 0.0
                c["pass"] = False
                c["detail"] += f" → {CFG.T4_FLAG}: FCF·순이익이 배당을 뒷받침하지 못함"
        flags.append(CFG.T4_FLAG)
    return checks, flags


def _axis_score(checks: list[dict], weight: float) -> float:
    earned = sum(c["earned"] for c in checks)
    applicable = sum(c["applicable"] for c in checks)
    if applicable <= 0:
        return 0.0
    return round(earned / applicable * weight, 1)


def _public(checks: list[dict]) -> list[dict]:
    return [{"label": c["label"], "pass": c["pass"], "detail": c["detail"]}
            for c in checks]


def evaluate(m: dict, is_financial: bool) -> dict:
    """표준 지표 dict → 3축 점수·등급·함정 플래그. 순수 함수(테스트 재사용)."""
    v_checks, v_flags = score_valuation(m)
    q_checks = score_quality(m, is_financial)
    g_checks, g_flags = score_growth(m)

    flags: list[str] = []
    grade_cap: str | None = None

    # T1 구조적 쇠퇴: 성장 축 15점 감점
    v_score = _axis_score(v_checks, CFG.AXIS_WEIGHTS["valuation"])
    q_score = _axis_score(q_checks, CFG.AXIS_WEIGHTS["quality"])
    g_score = _axis_score(g_checks, CFG.AXIS_WEIGHTS["growth"])

    rg, eg = m["revenueGrowth"], m["earningsGrowth"]
    if rg is not None and rg < 0 and eg is not None and eg < CFG.T1_EARN_DECLINE:
        g_score = max(0.0, round(g_score - CFG.T1_PENALTY, 1))
        g_checks.append(_chk("T1 감점", False,
                             f"{CFG.T1_FLAG}: 매출 {pct(rg)}·이익 {pct(eg)} → 성장 축 -{CFG.T1_PENALTY}점",
                             0.0, 0.0))
        flags.append(CFG.T1_FLAG)

    # T3 과잉 레버리지: 퀄리티 축 10점 감점 + 등급 B 캡
    de, cr = m["debtToEquity"], m["currentRatio"]
    if de is not None and de > CFG.T3_DE and cr is not None and cr < CFG.T3_CR:
        q_score = max(0.0, round(q_score - CFG.T3_PENALTY, 1))
        q_checks.append(_chk("T3 감점", False,
                             f"{CFG.T3_FLAG}: 부채비율 {fmt(de,0)}%·유동비율 {fmt(cr)} → 퀄리티 축 -{CFG.T3_PENALTY}점·등급 B 상한",
                             0.0, 0.0))
        flags.append(CFG.T3_FLAG)
        grade_cap = "B"

    # T2f 금융 저ROE 함정: 금융인데 ROE가 8% 미만 → B1 점수 무효화
    # (리서치 §4 DGB 기대 판정의 금융 변형 — 한국 금융주는 yfinance에 PBR이 없어
    #  원형 T2(저PBR)가 발동하지 못하므로 ROE 단독 판정)
    if is_financial and m["roe"] is not None and m["roe"] < CFG.T2F_ROE:
        for c in q_checks:
            if c["label"] == "ROE(금융 완화)":
                c["earned"] = 0.0
                c["pass"] = False
                c["detail"] += (f" → {CFG.T2F_FLAG}: ROE {pct(m['roe'])} < {pct(CFG.T2F_ROE,0)}로 B1 무효화"
                                " (구조적 저수익성이 만드는 영구 할인 의심)")
        flags.append(CFG.T2F_FLAG)
        q_score = _axis_score(q_checks, CFG.AXIS_WEIGHTS["quality"])

    flags.extend(v_flags + g_flags)

    total = round(v_score + q_score + g_score, 1)  # 총점 = 축 점수 합과 항상 일치
    if total >= CFG.GRADE_A_MIN:
        grade = "A"
    elif total >= CFG.GRADE_B_MIN:
        grade = "B"
    else:
        grade = "C"
    if grade_cap == "B" and grade == "A":
        grade = "B"

    return {
        "totalScore": total,
        "grade": grade,
        "pillars": {
            "valuation": {"score": v_score, "max": CFG.AXIS_WEIGHTS["valuation"],
                          "checks": _public(v_checks)},
            "quality": {"score": q_score, "max": CFG.AXIS_WEIGHTS["quality"],
                        "checks": _public(q_checks)},
            "growth": {"score": g_score, "max": CFG.AXIS_WEIGHTS["growth"],
                       "checks": _public(g_checks)},
        },
        "trapFlags": flags,
        "missingCount": sum(1 for c in (v_checks + q_checks + g_checks)
                            if c["applicable"] == 0 and c["earned"] == 0
                            and "배점 제외" in c["detail"]),
    }


# ─────────────────────────────────────────────────────────────
# 4단계: 선정 이유·리스크 문장
# ─────────────────────────────────────────────────────────────

def build_reasons(ev: dict) -> list[str]:
    """만점 통과 체크 중 배점 큰 순으로 한국어 한 줄 근거 2~4개."""
    full_checks: list[str] = []
    for axis in ("valuation", "quality", "growth"):
        for c in ev["pillars"][axis]["checks"]:
            if c["pass"]:
                full_checks.append(c["detail"])
    # 배점 정보는 공개 체크에 없으므로 문장 길이 대신 축 순서 유지, 상위 4개
    reasons = [d for d in full_checks][:4]
    if len(reasons) < 2:
        for axis in ("valuation", "quality", "growth"):
            p = ev["pillars"][axis]
            reasons.append(f"{axis} 축 {p['score']}/{p['max']}점")
            if len(reasons) >= 2:
                break
    return reasons[:4]


def build_risks(ev: dict, m: dict) -> list[str]:
    risks = list(ev["trapFlags"])
    if m["fcfPositive"] is False:
        risks.append("잉여현금흐름 적자")
    if m["profitMargin"] is not None and m["profitMargin"] <= 0:
        risks.append("순이익 적자")
    de = m["debtToEquity"]
    if de is not None and de > CFG.DE_PARTIAL and CFG.T3_FLAG not in risks:
        risks.append(f"부채비율 {fmt(de,0)}%로 높은 편")
    g = ev["pillars"]["growth"]
    if g["score"] < g["max"] * 0.4:
        risks.append("성장 지표 약함 — 저평가 함정 여부 주의")
    if ev["missingCount"] > 0:
        risks.append(f"지표 {ev['missingCount']}개 결측 — 배점 제외 후 환산됨")
    # 중복 제거 (순서 유지)
    seen, out = set(), []
    for r in risks:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

def main() -> int:
    print(f"[unicorn_evaluate] 기준일 {AS_OF} / 방법론 v{CFG.UNICORN_METHODOLOGY_VERSION} / 후보 {len(CANDIDATES)}종", flush=True)
    if FORCE_REFRESH:
        print("[unicorn_evaluate] --refresh: 캐시 무시", flush=True)

    passed: list[dict] = []
    evaluated = 0
    excluded: list[str] = []
    near_miss: list[tuple[str, float]] = []

    for i, entry in enumerate(CANDIDATES, 1):
        t = entry["ticker"]
        print(f"  ({i:2d}/{len(CANDIDATES)}) {t} ...", flush=True)
        raw = load_or_fetch(t)
        if raw is None:
            excluded.append(f"{t}(수집 실패)")
            time.sleep(CFG.INTER_TICKER_SLEEP_SEC)
            continue
        try:
            x = extract(entry, raw)
        except Exception as e:  # noqa: BLE001
            print(f"  [추출 실패] {t}: {e}", flush=True)
            excluded.append(f"{t}(추출 실패)")
            continue
        m = x["metrics"]

        reason = exclusion_reason(x, entry)
        if reason:
            print(f"    → {reason} → 평가 제외", flush=True)
            excluded.append(f"{t}({reason})")
            continue

        evaluated += 1
        ev = evaluate(m, x["isFinancial"])
        total = ev["totalScore"]
        marker = "통과" if total >= CFG.PASS_SCORE else "탈락"
        print(f"    → {total}점 ({ev['grade']}) {marker}"
              + (f" [금융보정]" if x["isFinancial"] else "")
              + (f" [{'·'.join(ev['trapFlags'])}]" if ev["trapFlags"] else ""), flush=True)

        if total >= CFG.PASS_SCORE:
            q = x["quote"]
            passed.append({
                "ticker": t,
                "name": entry["name"],
                "nameEn": entry["nameEn"],
                "market": entry["market"],
                "currency": entry["currency"],
                "theme": entry["theme"],
                "description": entry["description"],
                "totalScore": total,
                "grade": ev["grade"],
                "pillars": ev["pillars"],
                "metrics": {
                    "trailingPE": m["trailingPE"],
                    "forwardPE": m["forwardPE"],
                    "priceToBook": m["priceToBook"],
                    "peg": m["peg"],
                    "fcfYield": m["fcfYield"],
                    "roe": m["roe"],
                    "roa": m["roa"],
                    "operatingMargin": m["operatingMargin"],
                    "profitMargin": m["profitMargin"],
                    "debtToEquity": m["debtToEquity"],
                    "currentRatio": m["currentRatio"],
                    "revenueGrowth": m["revenueGrowth"],
                    "earningsGrowth": m["earningsGrowth"],
                    "dividendYield": m["dividendYield"],
                },
                "quote": {
                    "price": q["price"] or 0,
                    "changePct": q["changePct"] or 0,
                    "marketCap": q["marketCap"] or 0,
                },
                "reasons": build_reasons(ev),
                "risks": build_risks(ev, m),
                "sourceNotes": entry["sourceNotes"],
            })
        elif total >= CFG.PASS_SCORE - 10:
            near_miss.append((t, total))
        time.sleep(CFG.INTER_TICKER_SLEEP_SEC)

    if evaluated < CFG.MIN_SUCCESS:
        print(f"[오류] 평가 성공 {evaluated}종 < 최소 {CFG.MIN_SUCCESS}종 → 중단", flush=True)
        return 1

    passed.sort(key=lambda e: -e["totalScore"])
    data = {
        "asOf": AS_OF,
        "methodologyVersion": CFG.UNICORN_METHODOLOGY_VERSION,
        "evaluated": evaluated,
        "passed": passed,
    }
    payload = json.dumps(data, ensure_ascii=False, indent=1)
    for out in OUT_PATHS:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8")
        print(f"[저장] {out} ({out.stat().st_size / 1024:.0f} KB)", flush=True)

    ratio = len(passed) / evaluated if evaluated else 0
    print(f"[결과] 평가 {evaluated}종 / 통과 {len(passed)}종 ({ratio:.0%}) / 제외 {len(excluded)}종", flush=True)
    if excluded:
        print(f"  제외: {', '.join(excluded)}", flush=True)
    if near_miss:
        print(f"  아쉬운 탈락(65-10점 이내): {', '.join(f'{t} {s}점' for t, s in sorted(near_miss, key=lambda x: -x[1]))}", flush=True)
    if ratio >= 0.6:
        print("[경고] 통과 비율 60% 이상 — 리서치 임계값의 엄격 적용 여부 재확인 필요", flush=True)
    for p in passed:
        print(f"  ★ {p['ticker']} {p['name']} {p['totalScore']}점 ({p['grade']})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
