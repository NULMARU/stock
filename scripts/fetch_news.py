#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 종목별 Google 뉴스 RSS 수집 파이프라인.

universe.py의 26개 종목에 대해 Google 뉴스 RSS를 수집해
../src/data/news.json 으로 저장한다.

- 한국 종목:  쿼리 '{한국어이름} 주가', hl=ko&gl=KR&ceid=KR:ko
- 미국/중국:  쿼리 '{영문이름} stock', hl=en&gl=US&ceid=US:en
- 종목당 최신 최대 5개 기사 (title, link, source, publishedAt)
- 실패한 종목은 기존 news.json의 해당 종목 데이터를 유지한다.

실행 (scripts/ 디렉터리 기준):
    python3 fetch_news.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from universe import UNIVERSE

ROOT = Path(__file__).resolve().parent
OUT_PATH = ROOT.parent / "src" / "data" / "news.json"
KST = timezone(timedelta(hours=9))
MAX_ARTICLES = 5
INTER_TICKER_SLEEP_SEC = 0.4
REQUEST_TIMEOUT_SEC = 20
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0 Safari/537.36")


def build_rss_url(entry: dict) -> str:
    """시장에 맞는 Google 뉴스 RSS 검색 URL을 만든다."""
    if entry["market"] == "KR":
        query = f"{entry['name']} 주가"
        locale = "hl=ko&gl=KR&ceid=KR:ko"
    else:
        query = f"{entry['nameEn']} stock"
        locale = "hl=en&gl=US&ceid=US:en"
    q = urllib.parse.quote(query)
    return f"https://news.google.com/rss/search?q={q}&{locale}"


def to_kst_iso(pub_date: str | None) -> str | None:
    """RSS pubDate(RFC 822)를 ISO 8601 Asia/Seoul 시각으로 변환."""
    if not pub_date:
        return None
    try:
        dt = parsedate_to_datetime(pub_date)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(KST).isoformat(timespec="seconds")
    except Exception:
        return None


def fetch_ticker_news(entry: dict) -> list[dict]:
    """한 종목의 RSS를 수집·파싱해 최신 최대 5개 기사를 반환."""
    url = build_rss_url(entry)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
        xml_bytes = resp.read()

    root = ET.fromstring(xml_bytes)
    articles: list[dict] = []
    for item in root.iter("item"):
        title = item.findtext("title")
        link = item.findtext("link")
        if not title or not link:
            continue
        source_el = item.find("source")
        articles.append({
            "title": title.strip(),
            "link": link.strip(),
            "source": (source_el.text or "").strip() if source_el is not None else "",
            "publishedAt": to_kst_iso(item.findtext("pubDate")),
        })
        if len(articles) >= MAX_ARTICLES:
            break
    return articles


def main() -> int:
    # 기존 데이터 로드 (실패 종목 보존용)
    existing: dict[str, list[dict]] = {}
    if OUT_PATH.exists():
        try:
            prev = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            existing = prev.get("entries") or {}
        except Exception as e:  # noqa: BLE001
            print(f"[주의] 기존 news.json 파싱 실패, 새로 생성합니다: {e}")

    entries: dict[str, list[dict]] = {}
    ok: list[str] = []
    kept: list[str] = []
    empty: list[str] = []

    for i, entry in enumerate(UNIVERSE, 1):
        t = entry["ticker"]
        print(f"  ({i:2d}/{len(UNIVERSE)}) {t} {entry['name']} ...", flush=True)
        try:
            articles = fetch_ticker_news(entry)
            if articles:
                entries[t] = articles
                ok.append(t)
            elif t in existing:
                entries[t] = existing[t]
                kept.append(t)
                print(f"    [기사 없음] 기존 데이터 유지 ({len(existing[t])}건)")
            else:
                entries[t] = []
                empty.append(t)
        except Exception as e:  # noqa: BLE001
            if t in existing:
                entries[t] = existing[t]
                kept.append(t)
                print(f"    [실패] {e} → 기존 데이터 유지 ({len(existing[t])}건)")
            else:
                entries[t] = []
                empty.append(t)
                print(f"    [실패] {e} → 기존 데이터 없음, 빈 목록")
        time.sleep(INTER_TICKER_SLEEP_SEC)

    as_of = datetime.now(KST).isoformat(timespec="seconds")
    payload = {"asOf": as_of, "entries": entries}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                        encoding="utf-8")

    total_articles = sum(len(v) for v in entries.values())
    print(f"[완료] {OUT_PATH}")
    print(f"[수집 결과] 성공 {len(ok)}개 / 기존유지 {len(kept)}개 / "
          f"비어있음 {len(empty)}개 — 총 기사 {total_articles}건")
    if kept:
        print(f"[기존 유지] {', '.join(kept)}")
    if empty:
        print(f"[기사 없음] {', '.join(empty)}")
    # 직전 수집 성공 수가 너무 적으면 경고 (종목 추가·삭제 편집 기능 대비)
    if len(ok) + len(kept) < 20:
        print(f"[경고] 데이터 확보 종목 {len(ok) + len(kept)}개 < 20개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
