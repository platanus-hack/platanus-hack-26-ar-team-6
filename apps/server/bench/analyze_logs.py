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
    "preflightRetrieval:done": "preflight_ms",
    "retriever:success": "retrieval_client_ms",
    "retrievalClient:success": "retrieval_client_ms",
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
    retrieval_client_model: str | None = None
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
        if name in {"retrieval-client:start", "retriever-agent:start"}:
            model = ev.get("client") or ev.get("model")
            if chat_id and chat_id in open_turns and model:
                open_turns[chat_id].retrieval_client_model = model
            else:
                # Older runner logs did not always carry chatSessionId; pin to
                # the most recently opened turn as a fallback.
                if open_turns and model:
                    list(open_turns.values())[-1].retrieval_client_model = model
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
        help="Only count turns whose retrieval client model/name matches this prefix",
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
            if t.retrieval_client_model
            and t.retrieval_client_model.startswith(args.filter_model)
        ]

    print(f"Log: {target}")
    print(f"Turns parsed: {len(turns)}\n")

    if not turns:
        return

    print(f"{'#':>3} {'preflight':>10} {'retrieval':>10} {'user_agent':>11} {'ttat':>7} {'updater':>9} {'total':>8}  retrieval_client  prompt")
    for i, t in enumerate(turns):
        cells = []
        for key in ("preflight_ms", "retrieval_client_ms", "user_agent_ms"):
            cells.append(f"{int(t.stages.get(key, 0)):>10}" if key in t.stages else f"{'-':>10}")
        ttat = f"{int(t.user_agent_ttat_ms):>7}" if t.user_agent_ttat_ms is not None else f"{'-':>7}"
        updater = f"{int(t.stages.get('updater_ms', 0)):>9}" if "updater_ms" in t.stages else f"{'-':>9}"
        total = f"{int(t.total_ms):>8}" if t.total_ms is not None else f"{'-':>8}"
        model = (t.retrieval_client_model or "-")[-20:]
        prompt = (t.prompt_preview or "")[:60]
        print(
            f"{i:>3} {cells[0]} {cells[1]} {cells[2]} {ttat} {updater} {total}  "
            f"{model:<20}  {prompt}"
        )

    print("\nSummary (ms):")
    print(f"{'stage':<14} {'n':>4} {'min':>8} {'p50':>8} {'p95':>8} {'max':>8} {'mean':>8}")
    for key in ("preflight_ms", "retrieval_client_ms", "user_agent_ms", "updater_ms"):
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
        if "retrieval_client_ms" in t.stages and t.retrieval_client_model:
            by_model.setdefault(t.retrieval_client_model, []).append(t.stages["retrieval_client_ms"])
    if by_model:
        print("\nRetrieval client latency by model/name:")
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
                "i,started_ts,prompt_preview,retrieval_client_model,preflight_ms,"
                "retrieval_client_ms,user_agent_ms,user_agent_ttft_ms,user_agent_ttat_ms,"
                "updater_ms,total_ms\n"
            )
            for i, t in enumerate(turns):
                fh.write(
                    f"{i},{t.started_ts},{json.dumps(t.prompt_preview or '')[:120]},"
                    f"{t.retrieval_client_model or ''},"
                    f"{t.stages.get('preflight_ms','')},"
                    f"{t.stages.get('retrieval_client_ms','')},"
                    f"{t.stages.get('user_agent_ms','')},"
                    f"{t.user_agent_ttft_ms or ''},{t.user_agent_ttat_ms or ''},"
                    f"{t.stages.get('updater_ms','')},"
                    f"{t.total_ms or ''}\n"
                )
        print(f"\nCSV written to {csv_path}")


if __name__ == "__main__":
    main()
