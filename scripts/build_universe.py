#!/usr/bin/env python3
"""스페이스AI 스톡랩 — '검색' 탭용 검색 유니버스 데이터 생성 (전체 상장종목 확장판).

검색 대상을 실제 상장된 미국·한국·중국 전체 주식으로 확장한다.

소스:
    미국  nasdaqtrader 공개 심볼 디렉터리
          - https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt
          - https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt
          (마지막 'File Creation Time' 구분행 제외, Test Issue='N', ETF='N'만)
    한국  KRX KIND 상장법인 목록 (유가증권 .KS / 코스닥 .KQ 분리 수신)
          - http://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13
          (Referer 헤더 필요, EUC-KR 인코딩)
    중국  SSE/SZSE 공개 API (A주 전체)
          - SSE: http://query.sse.com.cn/sseQuery/commonQuery.do (sqlId=...GPLB_GP_L)
          - SZSE: https://www.szse.cn/api/report/ShowReport/data (CATALOGID=1110, 페이지네이션)
          ※ 실패 시: 기존 CN 큐레이션(73종목 중 CN분)만 유지하고 경고 출력

병합 규칙:
    - 기존 universe.json의 큐레이션 73종목(quote 포함)은 맨 앞에 그대로 유지
    - stocks.json 26종목 및 큐레이션과 겹치는 티커는 대량 목록에서 제외
    - 대량 종목은 {ticker, name, market}(+ 한글 별칭 시 nameEn)만 저장해 용량 절약
    - 미국/중국 주요 종목은 KO_ALIAS 한글 별칭을 name으로 사용 (한글/초성 검색용)

출력 (두 곳 모두 씀 — public/data가 없으면 배포 사이트에서 fetch되지 않음):
    src/data/universe.json        (번들 fallback)
    public/data/universe.json     (런타임 라이브 조회)

실행 (관리형 python3 — 표준라이브러리 + bs4만 사용):
    python3 build_universe.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_SRC = ROOT.parent / "src" / "data" / "universe.json"
OUT_PUBLIC = ROOT.parent / "public" / "data" / "universe.json"
STOCKS_PATH = ROOT.parent / "src" / "data" / "stocks.json"
KST = timezone(timedelta(hours=9))
AS_OF = datetime.now(KST).date().isoformat()

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


# ─────────────────────────────────────────────────────────────
# 한글 별칭 — 미국/중국 주요 종목 (한국 사용자의 한글·초성 검색용)
# 별칭이 있으면 name=한글, nameEn=원어 명칭으로 저장한다.
# ─────────────────────────────────────────────────────────────

KO_ALIAS: dict[str, str] = {
    # ── 미국 빅테크/AI ──
    "AAPL": "애플", "MSFT": "마이크로소프트", "NVDA": "엔비디아",
    "GOOGL": "알파벳(구글)", "GOOG": "알파벳(구글)", "AMZN": "아마존",
    "META": "메타", "TSLA": "테슬라", "AVGO": "브로드컴", "ORCL": "오라클",
    "NFLX": "넷플릭스", "AMD": "AMD", "INTC": "인텔", "QCOM": "퀄컴",
    "MU": "마이크론", "TSM": "TSMC", "ASML": "ASML", "ARM": "Arm홀딩스",
    "CRM": "세일즈포스", "ADBE": "어도비", "PLTR": "팔란티어",
    "SNOW": "스노우플레이크", "SMCI": "슈퍼마이크로", "DELL": "델테크놀로지",
    "ANET": "아리스타네트웍스", "CSCO": "시스코", "IBM": "IBM",
    "AMAT": "어플라이드머티어리얼즈", "LRCX": "램리서치", "KLAC": "KLA",
    "TXN": "텍사스인스트루먼트", "ADI": "아날로그디바이스",
    "NOW": "서비스나우", "PANW": "팔로알토네트웍스", "CRWD": "크라우드스트라이크",
    "DDOG": "데이터독", "NET": "클라우드플레어", "MDB": "몽고DB",
    "INTU": "인튜이트", "SHOP": "쇼피파이", "UBER": "우버",
    "ABNB": "에어비앤비", "COIN": "코인베이스", "HOOD": "로빈후드",
    "SOFI": "소파이", "PYPL": "페이팔", "RBLX": "로블록스",
    "U": "유니티소프트웨어", "RKLB": "로켓랩",
    "SPCE": "버진갤럭틱", "IRDM": "이리듐", "PL": "플래닛랩스",
    # ── 미국 금융/소비/헬스케어/산업 ──
    "JPM": "JP모건체이스", "V": "비자", "MA": "마스터카드",
    "BAC": "뱅크오브아메리카", "GS": "골드만삭스", "MS": "모건스탠리",
    "C": "씨티그룹", "AXP": "아메리칸익스프레스", "SCHW": "찰스슈왑",
    "BLK": "블랙록", "WMT": "월마트", "COST": "코스트코", "HD": "홈디포",
    "MCD": "맥도널드", "SBUX": "스타벅스", "NKE": "나이키", "DIS": "디즈니",
    "KO": "코카콜라", "PEP": "펩시코", "PG": "프록터앤갬블(P&G)",
    "JNJ": "존슨앤존슨", "LLY": "일라이릴리", "UNH": "유나이티드헬스",
    "PFE": "화이자", "MRK": "머크", "ABBV": "애브비", "XOM": "엑슨모빌",
    "CVX": "셰브론", "BA": "보잉", "LMT": "록히드마틴", "RTX": "RTX",
    "NOC": "노스롭그루먼", "GD": "제너럴다이내믹스", "CAT": "캐터필러",
    "HON": "하니웰", "UPS": "UPS", "FDX": "페덱스", "F": "포드",
    "GM": "제너럴모터스(GM)", "RIVN": "리비안", "LCID": "루시드모터스",
    # ── 미국 상장 중국 ADR ──
    "BABA": "알리바바", "JD": "징둥", "PDD": "PDD홀딩스", "BIDU": "바이두",
    "NTES": "넷이즈", "NIO": "니오", "XPEV": "샤오펑", "LI": "리오토",
    "TCOM": "트립닷컴", "TME": "텐센트뮤직",
    # ── 중국 A주 (SSE .SS / SZSE .SZ) ──
    "600519.SS": "구이저우마오타이", "601318.SS": "중국평안보험",
    "600036.SS": "초상은행", "601398.SS": "공상은행(ICBC)",
    "601288.SS": "농업은행", "601988.SS": "중국은행",
    "601857.SS": "페트로차이나", "600028.SS": "시노펙",
    "601899.SS": "쯔진광업", "300750.SZ": "CATL(닝더스다이)",
    "002594.SZ": "비야디(BYD)", "000858.SZ": "우량예",
    "000651.SZ": "거리전기", "000333.SZ": "메이디그룹",
    "600276.SS": "헝루이제약", "300760.SZ": "마인드레이",
    "688981.SS": "SMIC(중신국제)", "601012.SS": "론지(LONGi)",
    "300274.SZ": "선그로우", "002475.SZ": "럭스쉐어",
    "000063.SZ": "ZTE", "601138.SS": "폭스콘산업인터넷(FII)",
    "300308.SZ": "중지쉬촹", "688008.SS": "몬타주테크놀로지",
    "603501.SS": "윌반도체(옴니비전)", "688012.SS": "중미반도체(AMEC)",
    "002415.SZ": "하이크비전", "600760.SS": "중항심비(심양비기)",
    "600150.SS": "중국선박(CSSC)", "601698.SS": "중국위퉁(중국위성통신)",
    "600118.SS": "중국위성", "300059.SZ": "이스트머니",
    "600030.SS": "중신증권", "601688.SS": "화타이증권",
    "601766.SS": "중국중차(CRRC)", "601390.SS": "중국중철",
    "600104.SS": "상하이자동차(SAIC)", "601633.SS": "창청자동차",
    "000625.SZ": "창안자동차", "002230.SZ": "아이플라이텍(커다쉰페이)",
    "000725.SZ": "BOE", "002352.SZ": "순펑익스프레스(SF)",
    "601111.SS": "에어차이나", "600029.SS": "중국남방항공",
    "600115.SS": "중국동방항공", "601601.SS": "중국태평양보험",
    "601628.SS": "중국인수보험",
}


# ─────────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────────

def http_get(url: str, headers: dict | None = None, timeout: int = 30,
             retries: int = 2) -> bytes | None:
    """urllib GET (재시도 포함). 실패 시 None."""
    hdrs = dict(UA)
    if headers:
        hdrs.update(headers)
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except Exception as e:
            if attempt == retries:
                print(f"  [http_get] 실패: {url} ({e})")
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


# 미국 종목명 뒤의 주식 유형 접미사 정리 (표시용 이름 간결화)
_US_SUFFIX_RE = re.compile(
    r"(?:\s*-\s*|\s+)(?:Common Stock|Common Shares|Ordinary Shares|"
    r"American Depositary Shares|Class [A-Z](?:\s+Common Stock|\s+Common Shares)?|"
    r"Capital Stock|Common Share)\.?$"
)


def clean_us_name(name: str) -> str:
    prev = None
    out = name.strip()
    # ' - Common Stock' 등이 중첩된 경우를 대비해 반복 제거
    while prev != out:
        prev = out
        out = _US_SUFFIX_RE.sub("", out).strip()
    return out


def load_stock_tickers() -> set[str]:
    """stocks.json 기본 26종목 티커 (대문자) — 유니버스에서 제외."""
    try:
        data = json.loads(STOCKS_PATH.read_text(encoding="utf-8"))
        return {str(e.get("ticker", "")).upper() for e in data}
    except Exception:
        return set()


def load_curated() -> list[dict]:
    """기존 universe.json에서 큐레이션 종목(quote 포함)만 추출 — 맨 앞에 유지."""
    try:
        data = json.loads(OUT_SRC.read_text(encoding="utf-8"))
        return [e for e in data.get("entries", []) if isinstance(e.get("quote"), dict)]
    except Exception as e:
        print(f"[build_universe] 경고: 기존 큐레이션 로드 실패 ({e}) — 큐레이션 없이 진행")
        return []


def with_alias(ticker: str, original_name: str, market: str) -> dict:
    """한글 별칭 적용. 별칭이 있으면 name=한글/nameEn=원어, 없으면 name=원어만."""
    ko = KO_ALIAS.get(ticker)
    entry: dict = {"ticker": ticker, "name": ko or original_name, "market": market}
    if ko and ko != original_name:
        entry["nameEn"] = original_name
    return entry


# ─────────────────────────────────────────────────────────────
# 미국 — nasdaqtrader 심볼 디렉터리
# ─────────────────────────────────────────────────────────────

def fetch_us() -> list[dict]:
    entries: list[dict] = []
    seen: set[str] = set()

    # NASDAQ 상장 (Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares)
    raw = http_get("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt")
    if raw:
        for line in raw.decode("utf-8", errors="replace").splitlines()[1:]:
            if line.startswith("File Creation Time"):
                break  # 마지막 구분행 제외
            cols = line.split("|")
            if len(cols) < 8:
                continue
            symbol, name, test_issue, etf = cols[0].strip(), cols[1], cols[3], cols[6]
            if test_issue != "N" or etf != "N" or not symbol or symbol in seen:
                continue
            seen.add(symbol)
            entries.append(with_alias(symbol, clean_us_name(name), "US"))
    else:
        print("[build_universe] 경고: nasdaqlisted.txt 수신 실패")

    # NYSE/AMEX 등 기타 상장 (ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol)
    raw = http_get("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt")
    if raw:
        for line in raw.decode("utf-8", errors="replace").splitlines()[1:]:
            if line.startswith("File Creation Time"):
                break
            cols = line.split("|")
            if len(cols) < 8:
                continue
            symbol, name, etf, test_issue = cols[0].strip(), cols[1], cols[4], cols[6]
            # 우선주 등 특수 심볼($, ~) 및 테스트 이슈/ETF 제외
            if (test_issue != "N" or etf != "N" or not symbol or symbol in seen
                    or "$" in symbol or "~" in symbol):
                continue
            seen.add(symbol)
            entries.append(with_alias(symbol, clean_us_name(name), "US"))
    else:
        print("[build_universe] 경고: otherlisted.txt 수신 실패")

    print(f"[build_universe] 미국 수집: {len(entries)}종목")
    return entries


# ─────────────────────────────────────────────────────────────
# 한국 — KRX KIND 상장법인 목록 (EUC-KR HTML 테이블)
# ─────────────────────────────────────────────────────────────

_KRX_URL = ("http://kind.krx.co.kr/corpgeneral/corpList.do"
            "?method=download&searchType=13&marketType={market_type}")
_KRX_REFERER = {"Referer": "http://kind.krx.co.kr/corpgeneral/corpList.do"
                           "?method=loadInitPage&searchType=13"}
_TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def _fetch_krx_market(market_type: str, suffix: str) -> list[dict]:
    raw = http_get(_KRX_URL.format(market_type=market_type), headers=_KRX_REFERER)
    if not raw:
        return []
    html = raw.decode("euc-kr", errors="replace")
    entries: list[dict] = []
    for tr in _TR_RE.findall(html):
        cells = [_TAG_RE.sub("", c).strip() for c in _TD_RE.findall(tr)]
        # 헤더 행은 <th>라 <td> 매칭 없음. 컬럼: 회사명|시장구분|종목코드|업종|...
        if len(cells) < 3 or not re.fullmatch(r"\d{6}", cells[2]):
            continue
        name, code = cells[0], cells[2]
        entries.append({"ticker": f"{code}{suffix}", "name": name, "market": "KR"})
    return entries


def fetch_kr() -> list[dict]:
    kospi = _fetch_krx_market("stockMkt", ".KS")
    kosdaq = _fetch_krx_market("kosdaqMkt", ".KQ")
    entries = kospi + kosdaq
    print(f"[build_universe] 한국 수집: {len(entries)}종목 "
          f"(코스피 {len(kospi)} / 코스닥 {len(kosdaq)})")
    return entries


# ─────────────────────────────────────────────────────────────
# 중국 — SSE / SZSE 공개 API (A주)
# ─────────────────────────────────────────────────────────────

def fetch_cn_sse() -> list[dict]:
    url = ("http://query.sse.com.cn/sseQuery/commonQuery.do"
           "?STOCK_TYPE=1&sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L"
           "&COMPANY_STATUS=2%2C4%2C5%2C7%2C8&type=inParams&isPagination=true"
           "&pageHelp.cacheSize=1&pageHelp.beginPage=1"
           "&pageHelp.pageSize=3000&pageHelp.pageNo=1")
    raw = http_get(url, headers={"Referer": "http://www.sse.com.cn/"})
    if not raw:
        return []
    try:
        data = json.loads(raw.decode("utf-8"))
        rows = data["pageHelp"]["data"]
    except Exception as e:
        print(f"  [sse] 응답 파싱 실패: {e}")
        return []
    entries = []
    for r in rows:
        code = str(r.get("A_STOCK_CODE", "")).strip()
        name = (r.get("SEC_NAME_CN") or r.get("COMPANY_ABBR") or "").strip()
        if re.fullmatch(r"\d{6}", code) and name:
            entries.append(with_alias(f"{code}.SS", name, "CN"))
    print(f"[build_universe] 중국 SSE 수집: {len(entries)}종목")
    return entries


def fetch_cn_szse() -> list[dict]:
    """SZSE A股列表 — 페이지 크기 고정(20)이라 recordcount까지 페이지네이션."""
    base = ("https://www.szse.cn/api/report/ShowReport/data"
            "?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO={page}&random={rnd}")
    referer = {"Referer": "http://www.szse.cn/market/product/stock/list/index.html"}
    entries: list[dict] = []
    page = 1
    page_count = None
    while True:
        raw = http_get(base.format(page=page, rnd=round(time.time() % 1, 6)),
                       headers=referer, timeout=20, retries=1)
        if not raw:
            if page == 1:
                return []
            break  # 중간 페이지 실패 — 수집분까지 사용
        try:
            payload = json.loads(raw.decode("utf-8"))[0]
            rows = payload["data"]
            if page_count is None:
                page_count = int(payload["metadata"]["pagecount"])
                print(f"[build_universe] 중국 SZSE: 전체 {page_count}페이지 수집 시작")
        except Exception as e:
            print(f"  [szse] {page}페이지 파싱 실패: {e}")
            break
        for r in rows:
            code = str(r.get("agdm", "")).strip()
            name = _TAG_RE.sub("", str(r.get("agjc", ""))).strip()
            if re.fullmatch(r"\d{6}", code) and name:
                entries.append(with_alias(f"{code}.SZ", name, "CN"))
        if page_count is None or page >= page_count:
            break
        page += 1
        time.sleep(0.05)
    print(f"[build_universe] 중국 SZSE 수집: {len(entries)}종목")
    return entries


def fetch_cn() -> list[dict]:
    sse = fetch_cn_sse()
    szse = fetch_cn_szse()
    if not sse and not szse:
        # ※ 실패 시 대안 소스도 모두 불가 — 기존 CN 큐레이션(앞쪽 병합분)만 유지
        print("[build_universe] 경고: 중국 SSE/SZSE 수집 모두 실패 — "
              "기존 CN 큐레이션 종목만 유지합니다")
    return sse + szse


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

def main() -> int:
    stock_tickers = load_stock_tickers()
    curated = load_curated()
    curated_tickers = {str(e["ticker"]).upper() for e in curated}
    exclude = stock_tickers | curated_tickers
    print(f"[build_universe] 기준일 {AS_OF} / 큐레이션 {len(curated)}종목 유지, "
          f"stocks.json 중복 {len(stock_tickers)}종목 제외")

    us = fetch_us()
    kr = fetch_kr()
    cn = fetch_cn()

    mass: list[dict] = []
    skipped = 0
    for e in us + kr + cn:
        if e["ticker"].upper() in exclude:
            skipped += 1
            continue
        mass.append(e)

    entries = curated + mass
    payload = {"asOf": AS_OF, "entries": entries}
    # 대량 종목 대응 — 압축 직렬화 (indent 없음)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    for path in (OUT_SRC, OUT_PUBLIC):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
        size_kb = path.stat().st_size / 1024
        print(f"[build_universe] 저장: {path} ({size_kb:,.0f} KB)")

    by_market: dict[str, int] = {}
    for e in entries:
        by_market[e["market"]] = by_market.get(e["market"], 0) + 1
    print(f"[build_universe] 완료: 총 {len(entries)}종목 "
          f"(US {by_market.get('US', 0)} / KR {by_market.get('KR', 0)} / "
          f"CN {by_market.get('CN', 0)}), 중복 제외 {skipped}종목")
    return 0


if __name__ == "__main__":
    sys.exit(main())
