#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 시세 데이터 자동 갱신 + git 커밋/푸시 러너.

refresh_data.py를 실행해 src/data/stocks.json을 갱신한 뒤,
변경이 있으면 git 커밋·푸시한다. 자동화(Blueprint) 런타임에서
호출되는 것을 전제로, 마지막 줄에 결과를 stdout JSON 한 줄로 출력한다.

실행 (프로젝트 루트 또는 scripts/ 어디서나):
    python3 scripts/auto_refresh.py            # 갱신 + git 커밋/푸시
    python3 scripts/auto_refresh.py --no-git   # 갱신만 (git 작업 생략)

마지막 줄 출력 스키마:
    {"artifact": {"summary": str, "stocks": int, "pushed": bool, "asOf": str}}
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # git 레포 루트
STOCKS_JSON = ROOT / "src" / "data" / "stocks.json"
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
    refresh = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "refresh_data.py")],
        cwd=ROOT / "scripts",  # refresh_data.py는 scripts/ 기준 상대경로 사용
        capture_output=True, text=True)
    sys.stdout.write(refresh.stdout)
    if refresh.returncode != 0:
        sys.stderr.write(refresh.stderr)
        print("[오류] refresh_data.py 실행 실패")
        artifact = {"summary": "refresh_data.py 실행 실패", "stocks": 0,
                    "pushed": False, "asOf": now.isoformat(timespec="seconds")}
        print(json.dumps({"artifact": artifact}, ensure_ascii=False))
        return 1

    stocks = json.loads(STOCKS_JSON.read_text(encoding="utf-8"))
    as_of = (stocks[0].get("asOf") if stocks else None) \
        or now.date().isoformat()

    pushed = False
    if NO_GIT:
        print("[git] --no-git: 커밋/푸시 생략")
    else:
        pushed = git_commit_push(
            "src/data/stocks.json",
            f"data: auto refresh {now.strftime('%Y-%m-%d %H:%M KST')}")

    summary = (f"시세 갱신: {len(stocks)}개 종목"
               + (", 푸시 완료" if pushed else (", git 생략" if NO_GIT else ", 변경 없음/푸시 실패")))
    artifact = {"summary": summary, "stocks": len(stocks),
                "pushed": pushed, "asOf": as_of}
    print(json.dumps({"artifact": artifact}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
