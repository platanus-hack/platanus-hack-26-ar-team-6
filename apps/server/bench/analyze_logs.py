"""Parse desktop runner logs and tabulate per-stage latency by turn.

Reads the structured JSON log file written by the desktop logger (default at
~/.relevo/logs/relevo-YYYY-MM-DD.log), groups events by chatSessionId between
graph:start and graph:done, and reports per-stage durations along with summary
percentiles.

Run:
    python apps/server/bench/analyze_logs.py
    python apps/server/bench/analyze_logs.py ~/.relevo/logs/relevo-2026-05-09.log
    python apps/server/bench/analyze_logs.py --csv /tmp/turns.csv

Requires no dependencies beyond stdlib.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

STAGE_EVENTS = {
    "preflightRetriever:done": "preflight_ms",
    "retriever:success": "retriever_ms",
    "userAgent:success": "user_agent_ms",
    "updater:success": "updater_ms",
}


@dataclass
class Turn:
    chat_session_id: str
    started_ts: str
    prompt_preview: str | None = None
    mentioned_agent_count: int = 0
    stages: dict[str, float] = field(default_factory=dict)
    total_ms: float | None = None
    retriever_model: str | None = None
    user_agent_ttft_ms: float | None = None
    user_agent_ttat_ms: float | None = None
    finished: bool = False


def _iter_turns(events: Iterable[dict]) -> list[Turn]:
    turns: list[Turn] = []
    open_turns: dict[str, Turn] = {}
    for ev in events:
        scope = ev.get("scope", "")
        name = ev.get("event", "")
        chat_id = ev.get("chatSessionId")
        if scope == "relevo.agent-network" and name == "graph:start" and chat_id:
            turn = Turn(
                chat_session_id=chat_id,
                started_ts=ev.get("ts", ""),
                prompt_preview=ev.get("promptPreview"),
                mentioned_agent_count=len(ev.get("mentionedAgentIds") or []),
            )
            open_turns[chat_id] = turn
            continue
        if scope == "agent" and name == "retriever-agent:start":
            model = ev.get("model")
            if chat_id and chat_id in open_turns and model:
                open_turns[chat_id].retriever_model = model
            else:
                # retriever-agent:start does not always carry chatSessionId; pin
                # to most recently opened turn as a fallback.
                if open_turns and model:
                    list(open_turns.values())[-1].retriever_model = model
        if scope == "relevo.runner" and name == "user-agent:done":
            ttft = ev.get("timeToFirstSdkMessageMs")
            ttat = ev.get("timeToFirstAssistantTextMs")
            if open_turns:
                last = list(open_turns.values())[-1]
                if ttft is not None:
                    last.user_agent_ttft_ms = float(ttft)
                if ttat is not None:
                    last.user_agent_ttat_ms = float(ttat)
        if name in STAGE_EVENTS and chat_id and chat_id in open_turns:
            duration = ev.get("durationMs")
            if duration is not None:
                open_turns[chat_id].stages[STAGE_EVENTS[name]] = float(duration)
        if scope == "relevo.agent-network" and name == "graph:done" and chat_id and chat_id in open_turns:
            turn = open_turns.pop(chat_id)
            total = ev.get("totalDurationMs")
            if total is not None:
                turn.total_ms = float(total)
            turn.finished = True
            turns.append(turn)
    # Drop any turns left open (interrupted).
    return turns


def _read_events(path: Path) -> list[dict]:
    events: list[dict] = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def _percentiles(samples: list[float]) -> dict[str, float]:
    if not samples:
        return {}
    sorted_samples = sorted(samples)
    n = len(sorted_samples)
    p50 = sorted_samples[n // 2]
    p95 = sorted_samples[max(0, int(n * 0.95) - 1)]
    return {
        "n": float(n),
        "min": float(min(sorted_samples)),
        "p50": float(p50),
        "p95": float(p95),
        "max": float(max(sorted_samples)),
        "mean": statistics.fmean(sorted_samples),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Desktop log latency analyzer")
    default_log = Path(os.path.expanduser("~/.relevo/logs"))
    parser.add_argument(
        "log_path",
        nargs="?",
        help="Path to log file. If a directory is given, the lexicographically last "
        "file in it is used. Defaults to ~/.relevo/logs.",
    )
    parser.add_argument("--csv", help="Optional CSV output path")
    parser.add_argument(
        "--filter-model",
        help="Only count turns whose retriever model matches this prefix",
    )
    args = parser.parse_args()

    target = Path(args.log_path) if args.log_path else default_log
    if target.is_dir():
        candidates = sorted(target.glob("*.log"))
        if not candidates:
            print(f"No .log files in {target}", file=sys.stderr)
            sys.exit(1)
        target = candidates[-1]
    if not target.exists():
        print(f"Log file not found: {target}", file=sys.stderr)
        sys.exit(1)

    events = _read_events(target)
    turns = _iter_turns(events)

    if args.filter_model:
        turns = [
            t for t in turns
            if t.retriever_model and t.retriever_model.startswith(args.filter_model)
        ]

    print(f"Log: {target}")
    print(f"Turns parsed: {len(turns)}\n")

    if not turns:
        return

    print(f"{'#':>3} {'preflight':>10} {'retriever':>10} {'user_agent':>11} {'ttat':>7} {'updater':>9} {'total':>8}  retriever_model  prompt")
    for i, t in enumerate(turns):
        cells = []
        for key in ("preflight_ms", "retriever_ms", "user_agent_ms"):
            cells.append(f"{int(t.stages.get(key, 0)):>10}" if key in t.stages else f"{'-':>10}")
        ttat = f"{int(t.user_agent_ttat_ms):>7}" if t.user_agent_ttat_ms is not None else f"{'-':>7}"
        updater = f"{int(t.stages.get('updater_ms', 0)):>9}" if "updater_ms" in t.stages else f"{'-':>9}"
        total = f"{int(t.total_ms):>8}" if t.total_ms is not None else f"{'-':>8}"
        model = (t.retriever_model or "-")[-20:]
        prompt = (t.prompt_preview or "")[:60]
        print(
            f"{i:>3} {cells[0]} {cells[1]} {cells[2]} {ttat} {updater} {total}  "
            f"{model:<20}  {prompt}"
        )

    print("\nSummary (ms):")
    print(f"{'stage':<14} {'n':>4} {'min':>8} {'p50':>8} {'p95':>8} {'max':>8} {'mean':>8}")
    for key in ("preflight_ms", "retriever_ms", "user_agent_ms", "updater_ms"):
        samples = [t.stages[key] for t in turns if key in t.stages]
        s = _percentiles(samples)
        if not s:
            print(f"{key:<14} (no samples)")
            continue
        print(
            f"{key:<14} {int(s['n']):>4} "
            f"{s['min']:>8.0f} {s['p50']:>8.0f} {s['p95']:>8.0f} {s['max']:>8.0f} {s['mean']:>8.0f}"
        )
    totals = [t.total_ms for t in turns if t.total_ms is not None]
    s = _percentiles(totals)
    if s:
        print(
            f"{'graph_total':<14} {int(s['n']):>4} "
            f"{s['min']:>8.0f} {s['p50']:>8.0f} {s['p95']:>8.0f} {s['max']:>8.0f} {s['mean']:>8.0f}"
        )

    by_model: dict[str, list[float]] = {}
    for t in turns:
        if "retriever_ms" in t.stages and t.retriever_model:
            by_model.setdefault(t.retriever_model, []).append(t.stages["retriever_ms"])
    if by_model:
        print("\nRetriever latency by model:")
        for model, samples in sorted(by_model.items()):
            s = _percentiles(samples)
            print(
                f"  {model:<32} n={int(s['n'])} p50={int(s['p50'])} p95={int(s['p95'])} "
                f"min={int(s['min'])} max={int(s['max'])}"
            )

    if args.csv:
        csv_path = Path(args.csv)
        with csv_path.open("w") as fh:
            fh.write(
                "i,started_ts,prompt_preview,retriever_model,preflight_ms,"
                "retriever_ms,user_agent_ms,user_agent_ttft_ms,user_agent_ttat_ms,"
                "updater_ms,total_ms\n"
            )
            for i, t in enumerate(turns):
                fh.write(
                    f"{i},{t.started_ts},{json.dumps(t.prompt_preview or '')[:120]},"
                    f"{t.retriever_model or ''},"
                    f"{t.stages.get('preflight_ms','')},"
                    f"{t.stages.get('retriever_ms','')},"
                    f"{t.stages.get('user_agent_ms','')},"
                    f"{t.user_agent_ttft_ms or ''},{t.user_agent_ttat_ms or ''},"
                    f"{t.stages.get('updater_ms','')},"
                    f"{t.total_ms or ''}\n"
                )
        print(f"\nCSV written to {csv_path}")


if __name__ == "__main__":
    main()
