#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 주가 예측 자동 실행 + git 커밋/푸시 러너.

predict.py를 실행해 예측·정산·가중치 갱신을 수행한 뒤,
변경이 있으면 git 커밋·푸시한다. 자동화(Blueprint) 런타임에서
호출되는 것을 전제로, 마지막 줄에 결과를 stdout JSON 한 줄로 출력한다.

실행 (프로젝트 루트 또는 scripts/ 어디서나):
    python3 scripts/auto_predict.py            # 예측 + git 커밋/푸시
    python3 scripts/auto_predict.py --no-git   # 예측만 (git 작업 생략)

마지막 줄 출력 스키마:
    {"artifact": {"summary": str, "stocks": int,
                  "hitRate20": number|null, "pushed": bool, "asOf": str}}
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # git 레포 루트
PREDICTIONS_JSON = ROOT / "src" / "data" / "predictions.json"
KST = timezone(timedelta(hours=9))
NO_GIT = "--no-git" in sys.argv

PATHSPECS = [
    "src/data/predictions.json",
    "public/data/predictions.json",
    "scripts/prediction_model.json",
    "scripts/prediction_history.json",
]


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kwargs)


def git_commit_push(message: str) -> bool:
    """pull --rebase → add → 변경 있으면 commit → push. 푸시 성공 여부 반환."""
    pull = run(["git", "pull", "--rebase", "origin", "main"])
    if pull.returncode != 0:
        run(["git", "rebase", "--abort"])
        print(f"[git] pull --rebase 실패 — rebase 중단, 커밋/푸시 생략: "
              f"{pull.stderr.strip()}")
        return False
    run(["git", "add", *PATHSPECS])
    diff = run(["git", "diff", "--cached", "--quiet", "--", *PATHSPECS])
    if diff.returncode == 0:
        print("[git] 변경 없음 — 커밋 생략")
        return False
    commit = run(["git", "commit", "-m", message])
    if commit.returncode != 0:
        print(f"[git] 커밋 실패: {commit.stderr.strip()}")
        return False
    push = run(["git", "push", "origin", "main"])
    if push.returncode != 0:
        print(f"[git] 푸시 실패: {push.stderr.strip()}")
        return False
    print(f"[git] 커밋·푸시 완료: {message}")
    return True


def main() -> int:
    now = datetime.now(KST)
    predict = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "predict.py")],
        cwd=ROOT / "scripts",
        capture_output=True, text=True)
    sys.stdout.write(predict.stdout)
    if predict.returncode != 0:
        sys.stderr.write(predict.stderr)
        print("[오류] predict.py 실행 실패")
        artifact = {"summary": "predict.py 실행 실패", "stocks": 0,
                    "hitRate20": None, "pushed": False,
                    "asOf": now.isoformat(timespec="seconds")}
        print(json.dumps({"artifact": artifact}, ensure_ascii=False))
        return 1

    preds = json.loads(PREDICTIONS_JSON.read_text(encoding="utf-8"))
    stocks = len(preds.get("entries", {}))
    hit_rate20 = (preds.get("model") or {}).get("hitRate20")
    as_of = preds.get("asOf") or now.isoformat(timespec="seconds")

    pushed = False
    if NO_GIT:
        print("[git] --no-git: 커밋/푸시 생략")
    else:
        pushed = git_commit_push(
            f"predict: daily {now.strftime('%Y-%m-%d %H:%M KST')}")

    summary = (f"주가 예측: {stocks}개 종목 (hitRate20={hit_rate20})"
               + (", 푸시 완료" if pushed
                  else (", git 생략" if NO_GIT else ", 변경 없음/푸시 실패")))
    artifact = {"summary": summary, "stocks": stocks,
                "hitRate20": hit_rate20, "pushed": pushed, "asOf": as_of}
    print(json.dumps({"artifact": artifact}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
