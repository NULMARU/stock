#!/usr/bin/env python3
"""스페이스AI 스톡랩 — 주간 자기개선 리포트 + git 커밋/푸시 러너.

예측 엔진의 자기개선 결과(가중치 조정 이력·적중률 추이)를 주 1회 집계해
improvements.json(src/data·public/data)으로 발행한다. 앱 홈 화면의
'나의 학습 현황' 스트립이 이 파일을 읽는다.

실행:
    python3 scripts/auto_improve.py            # 집계 + git 커밋/푸시
    python3 scripts/auto_improve.py --no-git   # 집계만

마지막 줄 출력 스키마:
    {"artifact": {"summary": str, "hitRate7": float|null,
                  "pushed": bool, "asOf": str}}
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY_JSON = ROOT / "scripts" / "prediction_history.json"
MODEL_JSON = ROOT / "scripts" / "prediction_model.json"
PREDICTIONS_JSON = ROOT / "src" / "data" / "predictions.json"
OUT_SRC = ROOT / "src" / "data" / "improvements.json"
OUT_PUBLIC = ROOT / "public" / "data" / "improvements.json"
IMPROVE_HISTORY = ROOT / "scripts" / "improve_history.json"
KST = timezone(timedelta(hours=9))
NO_GIT = "--no-git" in sys.argv


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kwargs)


def git_commit_push(pathspecs: list[str], message: str) -> bool:
    run(["git", "add", *pathspecs])
    diff = run(["git", "diff", "--cached", "--quiet", "--", *pathspecs])
    if diff.returncode == 0:
        print("[git] 변경 없음 — 커밋 생략")
        return False
    commit = run(["git", "commit", "-m", message])
    if commit.returncode != 0:
        print(f"[git] 커밋 실패: {commit.stderr.strip()}")
        return False
    pull = run(["git", "pull", "--rebase", "origin", "main"])
    if pull.returncode != 0:
        run(["git", "rebase", "--abort"])
        print(f"[git] pull --rebase 실패 — 푸시 생략: {pull.stderr.strip()}")
        return False
    push = run(["git", "push", "origin", "main"])
    if push.returncode != 0:
        print(f"[git] 푸시 실패: {push.stderr.strip()}")
        return False
    print(f"[git] 커밋·푸시 완료: {message}")
    return True


def hit_rate(entries: list[dict], since: str, until: str | None = None) -> float | None:
    """forDate 기준 [since, until) 구간의 적중률. 평가된 표본 없으면 None."""
    hits = [
        e["hit"]
        for e in entries
        if e.get("hit") is not None
        and e.get("forDate", "") >= since
        and (until is None or e.get("forDate", "") < until)
    ]
    if not hits:
        return None
    return sum(1 for h in hits if h) / len(hits)


def main() -> int:
    now = datetime.now(KST)
    today = now.date()
    week_ago = (today - timedelta(days=7)).isoformat()
    two_weeks_ago = (today - timedelta(days=14)).isoformat()

    history = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
    model = json.loads(MODEL_JSON.read_text(encoding="utf-8"))
    predictions = json.loads(PREDICTIONS_JSON.read_text(encoding="utf-8"))

    all_entries: list[dict] = []
    per_ticker: dict[str, list[dict]] = {}
    for ticker, payload in history.items():
        daily = payload.get("daily", [])
        per_ticker[ticker] = daily
        all_entries.extend(daily)

    rate7 = hit_rate(all_entries, week_ago)
    rate_prev7 = hit_rate(all_entries, two_weeks_ago, week_ago)
    delta = (rate7 - rate_prev7) if (rate7 is not None and rate_prev7 is not None) else None

    # 주간 가중치 조정 이력 요약
    updates = [
        u for u in model.get("updateHistory", []) if u.get("date", "") >= week_ago
    ]
    weight_changes: list[str] = []
    if updates:
        first_w = updates[0].get("weights", {})
        last_w = model.get("weights", {})
        for comp in ("reversal", "trend", "drift"):
            a, b = first_w.get(comp), last_w.get(comp)
            if a is not None and b is not None and abs(b - a) >= 0.005:
                weight_changes.append(f"{comp} {a:.0%}→{b:.0%}")
    latest_rates = updates[-1].get("componentHitRates", {}) if updates else {}

    # 종목별 주간 적중률 상·하위
    ticker_rates = {
        t: r for t, e in per_ticker.items() if (r := hit_rate(e, week_ago)) is not None
    }
    ranked = sorted(ticker_rates.items(), key=lambda kv: kv[1], reverse=True)
    best = ranked[0] if ranked else None
    worst = ranked[-1] if len(ranked) > 1 else None

    notes: list[str] = []
    if weight_changes:
        notes.append(
            "신호별 적중률을 반영해 가중치 자동 조정: " + ", ".join(weight_changes)
        )
    if latest_rates:
        weak = min(latest_rates, key=latest_rates.get)
        notes.append(f"이번 주 가장 약한 신호: {weak} (적중률 {latest_rates[weak]:.0%})")
    if best:
        notes.append(f"적중률 최고 종목: {best[0]} ({best[1]:.0%})")
    if worst:
        notes.append(f"개선 필요 종목: {worst[0]} ({worst[1]:.0%})")
    if delta is not None:
        notes.append(
            f"주간 적중률 {rate7:.0%} (전주 대비 {'+' if delta >= 0 else ''}{delta:.0%}p)"
        )

    pm = predictions.get("model", {})
    report = {
        "asOf": now.isoformat(timespec="seconds"),
        "weekStart": week_ago,
        "hitRate7": rate7,
        "hitRatePrev7": rate_prev7,
        "hitRateDeltaWoW": delta,
        "hitRate20": pm.get("hitRate20"),
        "hitRateAll": pm.get("hitRateAll"),
        "evaluated": pm.get("evaluated", 0),
        "weights": model.get("weights", {}),
        "weightChanges": weight_changes,
        "notes": notes,
    }

    OUT_SRC.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUT_SRC, OUT_PUBLIC)
    print(f"[완료] improvements.json — 주간 적중률 {rate7 if rate7 is None else f'{rate7:.0%}'}")

    # 장기 추이용 스냅샷 적립 (스크립트 자기개선의 원재료)
    try:
        hist = json.loads(IMPROVE_HISTORY.read_text(encoding="utf-8"))
    except Exception:
        hist = []
    hist.append({"asOf": report["asOf"], "hitRate7": rate7, "evaluated": report["evaluated"]})
    IMPROVE_HISTORY.write_text(
        json.dumps(hist[-52:], ensure_ascii=False, indent=2), encoding="utf-8"
    )

    pushed = False
    if NO_GIT:
        print("[git] --no-git: 커밋/푸시 생략")
    else:
        pushed = git_commit_push(
            ["src/data/improvements.json", "public/data/improvements.json",
             "scripts/improve_history.json"],
            f"improve: weekly self-improvement report {now.strftime('%Y-%m-%d')}",
        )

    summary = (
        f"주간 자기개선 리포트: 적중률 "
        f"{'표본 없음' if rate7 is None else f'{rate7:.0%}'}"
        + (", 푸시 완료" if pushed else (", git 생략" if NO_GIT else ", 변경 없음/푸시 실패"))
    )
    artifact = {"summary": summary, "hitRate7": rate7, "pushed": pushed,
                "asOf": report["asOf"]}
    print(json.dumps({"artifact": artifact}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
