#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 유니콘 평가 자동 실행 + git 커밋/푸시 러너.

unicorn_evaluate.py를 실행해 unicorns.json(src/data·public/data)을 갱신한 뒤,
변경이 있으면 git 커밋·푸시한다. 자동화(Blueprint) 런타임에서 호출되는 것을
전제로, 마지막 줄에 결과를 stdout JSON 한 줄로 출력한다.

실행 (프로젝트 루트 또는 scripts/ 어디서나):
    python3 scripts/auto_unicorn.py            # 평가 + git 커밋/푸시
    python3 scripts/auto_unicorn.py --no-git   # 평가만 (git 작업 생략)

마지막 줄 출력 스키마:
    {"artifact": {"summary": str, "evaluated": int, "passed": int,
                  "pushed": bool, "asOf": str}}
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # git 레포 루트
UNICORNS_JSON = ROOT / "src" / "data" / "unicorns.json"
KST = timezone(timedelta(hours=9))
NO_GIT = "--no-git" in sys.argv


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kwargs)


def git_commit_push(pathspecs: list[str], message: str) -> bool:
    """변경이 있으면 커밋·푸시. 푸시 성공 여부를 반환."""
    run(["git", "add", *pathspecs])
    diff = run(["git", "diff", "--cached", "--quiet", "--", *pathspecs])
    if diff.returncode == 0:
        print("[git] 변경 없음 — 커밋 생략")
        return False
    commit = run(["git", "commit", "-m", message])
    if commit.returncode != 0:
        print(f"[git] 커밋 실패: {commit.stderr.strip()}")
        return False
    # 다른 경로의 푸시와 충돌 방지: 푸시 전 리베이스
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
    evaluate = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "unicorn_evaluate.py")],
        cwd=ROOT / "scripts",  # unicorn_evaluate.py는 scripts/ 기준 경로 사용
        capture_output=True, text=True)
    sys.stdout.write(evaluate.stdout)
    if evaluate.returncode != 0:
        sys.stderr.write(evaluate.stderr)
        print("[오류] unicorn_evaluate.py 실행 실패")
        artifact = {"summary": "unicorn_evaluate.py 실행 실패", "evaluated": 0,
                    "passed": 0, "pushed": False,
                    "asOf": now.isoformat(timespec="seconds")}
        print(json.dumps({"artifact": artifact}, ensure_ascii=False))
        return 1

    data = json.loads(UNICORNS_JSON.read_text(encoding="utf-8"))
    as_of = data.get("asOf") or now.date().isoformat()
    n_eval, n_pass = data.get("evaluated", 0), len(data.get("passed", []))

    pushed = False
    if NO_GIT:
        print("[git] --no-git: 커밋/푸시 생략")
    else:
        pushed = git_commit_push(
            ["src/data/unicorns.json", "public/data/unicorns.json"],
            f"unicorn: weekly evaluation {now.strftime('%Y-%m-%d %H:%M KST')}")

    summary = (f"유니콘 평가: {n_eval}종 평가, {n_pass}종 통과"
               + (", 푸시 완료" if pushed else (", git 생략" if NO_GIT else ", 변경 없음/푸시 실패")))
    artifact = {"summary": summary, "evaluated": n_eval, "passed": n_pass,
                "pushed": pushed, "asOf": as_of}
    print(json.dumps({"artifact": artifact}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
