#!/usr/bin/env python3
"""스페이스AI 스톡랩 — '기타 종목 검색' 탭용 검색 유니버스 데이터 생성.

기존 stocks.json 26종목을 제외한 AI·우주·방위·반도체·우주통신 테마의
미국/한국/중국 주요 종목을 yfinance로 조회해 universe.json을 만든다.

출력 (두 곳 모두 씀 — public/data가 없으면 배포 사이트에서 fetch되지 않음):
    src/data/universe.json        (번들 fallback)
    public/data/universe.json     (런타임 라이브 조회)

실행 (scripts/ 디렉터리 기준):
    python3 build_universe.py            # 당일 캐시 재사용, 전체 후보 조회
    python3 build_universe.py --max 60   # 앞에서부터 N개만 조회 (속도 제한)
    python3 build_universe.py --refresh  # 캐시 무시하고 재수집

출력 구조:
    {
      "asOf": "YYYY-MM-DD",
      "entries": [
        {"ticker", "name", "nameEn", "market", "currency",
         "theme": [...], "quote": {"price", "changePct", "marketCap"}}
      ]
    }
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent
OUT_SRC = ROOT.parent / "src" / "data" / "universe.json"
OUT_PUBLIC = ROOT.parent / "public" / "data" / "universe.json"
STOCKS_PATH = ROOT.parent / "src" / "data" / "stocks.json"
CACHE_DIR = ROOT / ".cache" / "universe"
KST = timezone(timedelta(hours=9))
AS_OF = datetime.now(KST).date().isoformat()

# ─────────────────────────────────────────────────────────────
# 검색 유니버스 후보 (큐레이션)
#   기존 stocks.json 26종목은 아래에서 제외한 뒤에도 코드에서 한 번 더 걸러낸다.
#   ticker 접미사 관례: 코스피 .KS / 코스닥 .KQ / 홍콩 .HK / 상하이 .SS / 선전 .SZ
# ─────────────────────────────────────────────────────────────

CANDIDATES: list[dict] = [
    # ── 미국: AI 반도체 (9) ──────────────────────────────────
    {"ticker": "AMD", "name": "AMD", "nameEn": "Advanced Micro Devices",
     "market": "US", "currency": "USD", "theme": ["AI반도체"]},
    {"ticker": "AVGO", "name": "브로드컴", "nameEn": "Broadcom",
     "market": "US", "currency": "USD", "theme": ["AI반도체"]},
    {"ticker": "MRVL", "name": "마벨테크놀로지", "nameEn": "Marvell Technology",
     "market": "US", "currency": "USD", "theme": ["AI반도체"]},
    {"ticker": "MU", "name": "마이크론", "nameEn": "Micron Technology",
     "market": "US", "currency": "USD", "theme": ["AI반도체", "메모리"]},
    {"ticker": "TSM", "name": "TSMC", "nameEn": "TSMC",
     "market": "US", "currency": "USD", "theme": ["AI반도체", "파운드리"]},
    {"ticker": "ASML", "name": "ASML", "nameEn": "ASML Holding",
     "market": "US", "currency": "USD", "theme": ["AI반도체", "장비"]},
    {"ticker": "ARM", "name": "Arm홀딩스", "nameEn": "Arm Holdings",
     "market": "US", "currency": "USD", "theme": ["AI반도체"]},
    {"ticker": "QCOM", "name": "퀄컴", "nameEn": "Qualcomm",
     "market": "US", "currency": "USD", "theme": ["AI반도체", "통신칩"]},
    {"ticker": "INTC", "name": "인텔", "nameEn": "Intel",
     "market": "US", "currency": "USD", "theme": ["AI반도체", "파운드리"]},

    # ── 미국: AI 플랫폼/소프트웨어 (5) ───────────────────────
    {"ticker": "AMZN", "name": "아마존", "nameEn": "Amazon",
     "market": "US", "currency": "USD", "theme": ["AI플랫폼", "클라우드"]},
    {"ticker": "META", "name": "메타", "nameEn": "Meta Platforms",
     "market": "US", "currency": "USD", "theme": ["AI플랫폼"]},
    {"ticker": "ORCL", "name": "오라클", "nameEn": "Oracle",
     "market": "US", "currency": "USD", "theme": ["AI플랫폼", "클라우드"]},
    {"ticker": "CRM", "name": "세일즈포스", "nameEn": "Salesforce",
     "market": "US", "currency": "USD", "theme": ["AI소프트웨어"]},
    {"ticker": "SNOW", "name": "스노우플레이크", "nameEn": "Snowflake",
     "market": "US", "currency": "USD", "theme": ["AI소프트웨어", "데이터"]},

    # ── 미국: 방위 (7) ──────────────────────────────────────
    {"ticker": "LMT", "name": "록히드마틴", "nameEn": "Lockheed Martin",
     "market": "US", "currency": "USD", "theme": ["방위", "우주"]},
    {"ticker": "RTX", "name": "RTX", "nameEn": "RTX Corporation",
     "market": "US", "currency": "USD", "theme": ["방위"]},
    {"ticker": "NOC", "name": "노스롭그루먼", "nameEn": "Northrop Grumman",
     "market": "US", "currency": "USD", "theme": ["방위", "우주"]},
    {"ticker": "GD", "name": "제너럴다이내믹스", "nameEn": "General Dynamics",
     "market": "US", "currency": "USD", "theme": ["방위"]},
    {"ticker": "HII", "name": "헌팅턴잉걸스", "nameEn": "Huntington Ingalls",
     "market": "US", "currency": "USD", "theme": ["방위", "함정"]},
    {"ticker": "KTOS", "name": "크라토스", "nameEn": "Kratos Defense",
     "market": "US", "currency": "USD", "theme": ["방위", "드론"]},
    {"ticker": "AVAV", "name": "에어로바이런먼트", "nameEn": "AeroVironment",
     "market": "US", "currency": "USD", "theme": ["방위", "드론"]},

    # ── 미국: 우주/위성통신 (7) ──────────────────────────────
    {"ticker": "BA", "name": "보잉", "nameEn": "Boeing",
     "market": "US", "currency": "USD", "theme": ["방위", "우주"]},
    {"ticker": "IRDM", "name": "이리듐", "nameEn": "Iridium Communications",
     "market": "US", "currency": "USD", "theme": ["우주-위성통신"]},
    {"ticker": "VSAT", "name": "비아샛", "nameEn": "Viasat",
     "market": "US", "currency": "USD", "theme": ["우주-위성통신"]},
    {"ticker": "GSAT", "name": "글로벌스타", "nameEn": "Globalstar",
     "market": "US", "currency": "USD", "theme": ["우주-위성통신"]},
    {"ticker": "SPCE", "name": "버진갤럭틱", "nameEn": "Virgin Galactic",
     "market": "US", "currency": "USD", "theme": ["우주-관광"]},
    {"ticker": "PL", "name": "플래닛랩스", "nameEn": "Planet Labs",
     "market": "US", "currency": "USD", "theme": ["우주-위성응용"]},
    {"ticker": "BKSY", "name": "블랙스카이", "nameEn": "BlackSky Technology",
     "market": "US", "currency": "USD", "theme": ["우주-위성응용"]},

    # ── 한국: 반도체 (12) ────────────────────────────────────
    {"ticker": "042700.KQ", "name": "한미반도체", "nameEn": "Hanmi Semiconductor",
     "market": "KR", "currency": "KRW", "theme": ["AI반도체", "장비"]},
    {"ticker": "039030.KQ", "name": "이오테크닉스", "nameEn": "EO Technics",
     "market": "KR", "currency": "KRW", "theme": ["반도체장비"]},
    {"ticker": "000990.KS", "name": "DB하이텍", "nameEn": "DB HiTek",
     "market": "KR", "currency": "KRW", "theme": ["반도체", "파운드리"]},
    {"ticker": "036930.KQ", "name": "주성엔지니어링", "nameEn": "Jusung Engineering",
     "market": "KR", "currency": "KRW", "theme": ["반도체장비"]},
    {"ticker": "058470.KQ", "name": "리노공업", "nameEn": "Leeno Industrial",
     "market": "KR", "currency": "KRW", "theme": ["반도체", "테스트"]},
    {"ticker": "095340.KQ", "name": "ISC", "nameEn": "ISC",
     "market": "KR", "currency": "KRW", "theme": ["반도체", "테스트"]},
    {"ticker": "084370.KQ", "name": "유진테크", "nameEn": "Eugene Technology",
     "market": "KR", "currency": "KRW", "theme": ["반도체장비"]},
    {"ticker": "403870.KQ", "name": "HPSP", "nameEn": "HPSP",
     "market": "KR", "currency": "KRW", "theme": ["반도체장비"]},
    {"ticker": "240810.KQ", "name": "원익IPS", "nameEn": "Wonik IPS",
     "market": "KR", "currency": "KRW", "theme": ["반도체장비"]},
    {"ticker": "166090.KQ", "name": "하나머티리얼즈", "nameEn": "Hana Materials",
     "market": "KR", "currency": "KRW", "theme": ["반도체소재"]},
    {"ticker": "067310.KQ", "name": "하나마이크론", "nameEn": "Hana Micron",
     "market": "KR", "currency": "KRW", "theme": ["반도체", "후공정"]},
    {"ticker": "083450.KQ", "name": "GST", "nameEn": "GST",
     "market": "KR", "currency": "KRW", "theme": ["반도체장비"]},

    # ── 한국: 방위 (5) ──────────────────────────────────────
    {"ticker": "064350.KS", "name": "현대로템", "nameEn": "Hyundai Rotem",
     "market": "KR", "currency": "KRW", "theme": ["방위"]},
    {"ticker": "000880.KS", "name": "한화", "nameEn": "Hanwha",
     "market": "KR", "currency": "KRW", "theme": ["방위", "지주"]},
    {"ticker": "103140.KQ", "name": "풍산", "nameEn": "Poongsan",
     "market": "KR", "currency": "KRW", "theme": ["방위", "탄약"]},
    {"ticker": "003570.KS", "name": "SNT중공업", "nameEn": "SNT Heavy Industries",
     "market": "KR", "currency": "KRW", "theme": ["방위"]},
    {"ticker": "042660.KS", "name": "한화오션", "nameEn": "Hanwha Ocean",
     "market": "KR", "currency": "KRW", "theme": ["방위", "함정"]},

    # ── 한국: 우주/위성통신 (4) ──────────────────────────────
    {"ticker": "189300.KQ", "name": "인텔리안테크", "nameEn": "Intellian Technologies",
     "market": "KR", "currency": "KRW", "theme": ["우주-위성통신"]},
    {"ticker": "211270.KQ", "name": "AP위성", "nameEn": "AP Satellite",
     "market": "KR", "currency": "KRW", "theme": ["우주-위성통신"]},
    {"ticker": "462350.KQ", "name": "이노스페이스", "nameEn": "Innospace",
     "market": "KR", "currency": "KRW", "theme": ["우주-발사체"]},
    {"ticker": "274090.KQ", "name": "켄코아에어로스페이스", "nameEn": "Kencoa Aerospace",
     "market": "KR", "currency": "KRW", "theme": ["우주", "항공부품"]},

    # ── 한국: AI 플랫폼/소프트웨어 (2) ───────────────────────
    {"ticker": "035720.KS", "name": "카카오", "nameEn": "Kakao",
     "market": "KR", "currency": "KRW", "theme": ["AI플랫폼"]},
    {"ticker": "304100.KQ", "name": "솔트룩스", "nameEn": "Saltlux",
     "market": "KR", "currency": "KRW", "theme": ["AI소프트웨어"]},

    # ── 중국: AI 반도체/서버 (7) ─────────────────────────────
    {"ticker": "601138.SS", "name": "폭스콘산업인터넷(FII)", "nameEn": "Foxconn Industrial Internet",
     "market": "CN", "currency": "CNY", "theme": ["AI서버"]},
    {"ticker": "300308.SZ", "name": "중지쉬촹", "nameEn": "Zhongji Innolight",
     "market": "CN", "currency": "CNY", "theme": ["AI광모듈"]},
    {"ticker": "300502.SZ", "name": "신이성(이옵토링크)", "nameEn": "Eoptolink",
     "market": "CN", "currency": "CNY", "theme": ["AI광모듈"]},
    {"ticker": "688008.SS", "name": "몬타주테크놀로지", "nameEn": "Montage Technology",
     "market": "CN", "currency": "CNY", "theme": ["AI반도체"]},
    {"ticker": "603501.SS", "name": "윌반도체(옴니비전)", "nameEn": "Will Semiconductor",
     "market": "CN", "currency": "CNY", "theme": ["반도체"]},
    {"ticker": "688012.SS", "name": "중미반도체(AMEC)", "nameEn": "AMEC",
     "market": "CN", "currency": "CNY", "theme": ["반도체장비"]},
    {"ticker": "688041.SS", "name": "하이곤정보기술", "nameEn": "Hygon Information",
     "market": "CN", "currency": "CNY", "theme": ["AI반도체"]},

    # ── 중국: AI 플랫폼/응용 (6) ─────────────────────────────
    {"ticker": "002415.SZ", "name": "하이크비전", "nameEn": "Hikvision",
     "market": "CN", "currency": "CNY", "theme": ["AI응용", "보안"]},
    {"ticker": "9618.HK", "name": "징둥", "nameEn": "JD.com",
     "market": "CN", "currency": "HKD", "theme": ["AI응용", "전자상거래"]},
    {"ticker": "9999.HK", "name": "넷이즈", "nameEn": "NetEase",
     "market": "CN", "currency": "HKD", "theme": ["AI응용", "게임"]},
    {"ticker": "3690.HK", "name": "메이투안", "nameEn": "Meituan",
     "market": "CN", "currency": "HKD", "theme": ["AI응용", "플랫폼"]},
    {"ticker": "1024.HK", "name": "콰이쇼우", "nameEn": "Kuaishou",
     "market": "CN", "currency": "HKD", "theme": ["AI응용", "영상"]},
    {"ticker": "PDD", "name": "PDD홀딩스", "nameEn": "PDD Holdings",
     "market": "CN", "currency": "USD", "theme": ["AI응용", "전자상거래"]},

    # ── 중국: 방위 (8) ──────────────────────────────────────
    {"ticker": "600760.SS", "name": "중항심비(심양비기)", "nameEn": "AVIC Shenyang Aircraft",
     "market": "CN", "currency": "CNY", "theme": ["방위", "전투기"]},
    {"ticker": "000768.SZ", "name": "중항서비(서안비기)", "nameEn": "AVIC Xi'an Aircraft",
     "market": "CN", "currency": "CNY", "theme": ["방위", "수송기"]},
    {"ticker": "600150.SS", "name": "중국선박(CSSC)", "nameEn": "CSSC Holdings",
     "market": "CN", "currency": "CNY", "theme": ["방위", "조선"]},
    # 참고: 601989.SS 중국중공업은 CSSC와 합병으로 시세 조회 불가 — 유니버스에서 제외
    {"ticker": "600893.SS", "name": "항발동력(AECC)", "nameEn": "AECC Aviation Power",
     "market": "CN", "currency": "CNY", "theme": ["방위", "엔진"]},
    {"ticker": "002179.SZ", "name": "중항광전", "nameEn": "AVIC Jonhon Optronic",
     "market": "CN", "currency": "CNY", "theme": ["방위", "커넥터"]},
    {"ticker": "600038.SS", "name": "중직고펀(중국헬기)", "nameEn": "AVIC Helicopter",
     "market": "CN", "currency": "CNY", "theme": ["방위", "헬기"]},
    {"ticker": "688297.SS", "name": "중무인기(AVIC드론)", "nameEn": "AVIC UAV",
     "market": "CN", "currency": "CNY", "theme": ["방위", "드론"]},

    # ── 중국: 우주/위성통신 (2) ──────────────────────────────
    {"ticker": "601698.SS", "name": "중국위퉁(중국위성통신)", "nameEn": "China Satellite Communications",
     "market": "CN", "currency": "CNY", "theme": ["우주-위성통신"]},
    {"ticker": "600118.SS", "name": "중국위성", "nameEn": "China Spacesat",
     "market": "CN", "currency": "CNY", "theme": ["우주-위성제조"]},
]


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


def load_existing_tickers() -> set[str]:
    """stocks.json에 이미 있는 26종목 티커 (대문자) — 유니버스에서 제외."""
    try:
        data = json.loads(STOCKS_PATH.read_text(encoding="utf-8"))
        return {str(e.get("ticker", "")).upper() for e in data}
    except Exception:
        return set()


def fetch_quote(ticker: str, force_refresh: bool) -> dict | None:
    """yfinance info에서 이름/통화/현재가/등락률/시가총액만 가져온다 (당일 캐시)."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{ticker.replace('.', '_')}_{AS_OF}.json"

    if cache_file.exists() and not force_refresh:
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    info: dict = {}
    for _ in range(2):  # 네트워크 일시 오류 대비 재시도 1회
        try:
            info = yf.Ticker(ticker).info or {}
            if info:
                break
        except Exception:
            time.sleep(1)

    if not info:
        return None

    # 등락률: regularMarketChangePercent는 퍼센트 단위 (예: 1.23 = +1.23%)
    change_pct = clean(info.get("regularMarketChangePercent"))
    price = clean(info.get("regularMarketPrice")) or clean(info.get("currentPrice"))
    if change_pct is None:
        prev = clean(info.get("regularMarketPreviousClose"))
        if isinstance(price, (int, float)) and isinstance(prev, (int, float)) and prev:
            change_pct = (float(price) / float(prev) - 1) * 100

    out = {
        "nameEn": info.get("longName") or info.get("shortName"),
        "currency": info.get("currency"),
        "price": num(price),
        "changePct": num(change_pct),
        "marketCap": clean(info.get("marketCap")),
    }
    try:
        cache_file.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="검색 유니버스 universe.json 생성")
    parser.add_argument("--max", type=int, default=len(CANDIDATES),
                        help="앞에서부터 조회할 최대 종목 수 (기본: 전체)")
    parser.add_argument("--refresh", action="store_true", help="당일 캐시 무시")
    args = parser.parse_args()

    existing = load_existing_tickers()
    candidates = [
        c for c in CANDIDATES if c["ticker"].upper() not in existing
    ][: args.max]

    print(f"[build_universe] 기준일 {AS_OF} / 후보 {len(candidates)}종목 조회 "
          f"(stocks.json 중복 {len(existing)}종목 자동 제외)")

    entries: list[dict] = []
    failed: list[str] = []
    for i, c in enumerate(candidates, 1):
        q = fetch_quote(c["ticker"], args.refresh)
        if q is None:
            failed.append(c["ticker"])
            print(f"  [{i}/{len(candidates)}] {c['ticker']} 조회 실패 — 건너뜀")
            continue
        entries.append({
            "ticker": c["ticker"],
            # 한국어 표기는 큐레이션 값 유지 (초성검색 품질), 영문명은 yfinance 우선
            "name": c["name"],
            "nameEn": q["nameEn"] or c["nameEn"],
            "market": c["market"],
            "currency": q["currency"] or c["currency"],
            "theme": c["theme"],
            "quote": {
                "price": q["price"],
                "changePct": q["changePct"],
                "marketCap": q["marketCap"],
            },
        })
        print(f"  [{i}/{len(candidates)}] {c['ticker']} {c['name']} OK "
              f"(price={q['price']}, changePct={q['changePct']})")

    payload = {"asOf": AS_OF, "entries": entries}
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    for path in (OUT_SRC, OUT_PUBLIC):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
        print(f"[build_universe] 저장: {path}")

    by_market: dict[str, int] = {}
    for e in entries:
        by_market[e["market"]] = by_market.get(e["market"], 0) + 1
    print(f"[build_universe] 완료: 총 {len(entries)}종목 "
          f"(US {by_market.get('US', 0)} / KR {by_market.get('KR', 0)} / CN {by_market.get('CN', 0)})"
          + (f", 실패 {len(failed)}종목: {', '.join(failed)}" if failed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
