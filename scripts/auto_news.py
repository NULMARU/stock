#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 뉴스 자동 수집 + git 커밋/푸시 러너.

fetch_news.py를 실행해 src/data/news.json을 갱신한 뒤,
변경이 있으면 git 커밋·푸시한다. 자동화(Blueprint) 런타임에서
호출되는 것을 전제로, 마지막 줄에 결과를 stdout JSON 한 줄로 출력한다.

실행 (프로젝트 루트 또는 scripts/ 어디서나):
    python3 scripts/auto_news.py            # 수집 + git 커밋/푸시
    python3 scripts/auto_news.py --no-git   # 수집만 (git 작업 생략)

마지막 줄 출력 스키마:
    {"artifact": {"summary": str, "tickers": int, "articles": int,
                  "pushed": bool, "asOf": str}}
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # git 레포 루트
NEWS_JSON = ROOT / "src" / "data" / "news.json"
KST = timezone(timedelta(hours=9))
NO_GIT = "--no-git" in sys.argv


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kwargs)


def git_commit_push(pathspec: str, message: str) -> bool:
    """변경이 있으면 커밋·푸시. 푸시 성공 여부를 반환."""
    run(["git", "add", pathspec])
    diff = run(["git", "diff", "--cached", "--quiet", "--", pathspec])
    if diff.returncode == 0:
        print("[git] 변경 없음 — 커밋 생략")
        return False
    commit = run(["git", "commit", "-m", message])
    if commit.returncode != 0:
        print(f"[git] 커밋 실패: {commit.stderr.strip()}")
        return False
    # GitHub Actions 등 다른 경로의 푸시와 충돌 방지: 푸시 전 리베이스
    pull = run(["git", "pull", "--rebase", "origin", "main"])
    if pull.returncode != 0:
        run(["git", "rebase", "--abort"])
        print(f"[git] pull --rebase 실패 — rebase 중단, 푸시 생략: {pull.stderr.strip()}")
        return False
    push = run(["git", "push", "origin", "main"])
    if push.returncode != 0:
        print(f"[git] 푸시 실패: {push.stderr.strip()}")
        return False
    print(f"[git] 커밋·푸시 완료: {message}")
    return True


def main() -> int:
    now = datetime.now(KST)
    fetch = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "fetch_news.py")],
        cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(fetch.stdout)
    if fetch.returncode != 0:
        sys.stderr.write(fetch.stderr)
        print("[오류] fetch_news.py 실행 실패")
        artifact = {"summary": "fetch_news.py 실행 실패", "tickers": 0,
                    "articles": 0, "pushed": False,
                    "asOf": now.isoformat(timespec="seconds")}
        print(json.dumps({"artifact": artifact}, ensure_ascii=False))
        return 1

    data = json.loads(NEWS_JSON.read_text(encoding="utf-8"))
    entries = data.get("entries") or {}
    as_of = data.get("asOf") or now.isoformat(timespec="seconds")
    tickers = sum(1 for v in entries.values() if v)
    articles = sum(len(v) for v in entries.values())

    pushed = False
    if NO_GIT:
        print("[git] --no-git: 커밋/푸시 생략")
    else:
        pushed = git_commit_push(
            "src/data/news.json",
            f"news: auto update {now.strftime('%Y-%m-%d %H:%M KST')}")

    summary = (f"뉴스 갱신: {tickers}개 종목 {articles}건 수집"
               + (", 푸시 완료" if pushed else (", git 생략" if NO_GIT else ", 변경 없음/푸시 실패")))
    artifact = {"summary": summary, "tickers": tickers,
                "articles": articles, "pushed": pushed, "asOf": as_of}
    print(json.dumps({"artifact": artifact}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
