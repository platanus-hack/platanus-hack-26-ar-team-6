# Latency benches

Two complementary tools.

## `server_bench.py` — synthetic server-tier bench

Drives FastAPI endpoints (`/agent-ctx`, `/global-ctx`, `/memory-updates`) with
no LLM in the loop. Measures Python handler + DB tier latency under a warm
psycopg pool.

```sh
cd apps/server
DATABASE_URL=postgresql://relevo:relevo@localhost:5432/relevo \
  uv run python bench/server_bench.py --iters 50 --warmup 5 --csv /tmp/bench.csv
```

The script spawns its own `uvicorn` on a free port unless you pass
`--external-server <url>` to point at an existing instance (e.g. Railway).

Output (example, localhost):

```
endpoint              n   min   p50   p95   max  mean
agent_ctx            30  1.96  4.53  7.29  7.67  4.49
global_ctx           30  1.77  3.49  4.22  4.71  3.17
memory_updates_1op   30  1.79  2.61  3.88  4.09  2.68
memory_updates_5ops  30  3.96  4.69  6.04 10.02  4.98
```

## `analyze_logs.py` — desktop log analyzer

Parses the structured log (default `~/.relevo/logs/relevo-YYYY-MM-DD.log`)
into per-turn, per-stage durations and prints a summary plus a per-model
breakdown of retriever latency. Stdlib only.

```sh
python3 apps/server/bench/analyze_logs.py
python3 apps/server/bench/analyze_logs.py --csv /tmp/turns.csv
python3 apps/server/bench/analyze_logs.py --filter-model claude-haiku
```

Stages captured per turn (between `graph:start` and `graph:done`):
- `preflight_ms`, `retriever_ms`, `user_agent_ms`, `updater_ms`, `graph_total`
- Plus `user_agent_ttft_ms`, `user_agent_ttat_ms` for the user-agent SDK call.

Use it after running the desktop app against a fixed prompt set to compare
configurations (model swaps, async updater, etc.) without re-instrumenting
anything.

## What's NOT covered yet

- End-to-end desktop bench harness that drives `runLocalAssistant` directly
  with a fixed prompt set. Would need real LLM calls (cost, variance) or a
  mocked SDK; see `apps/desktop/src/runner.ts` for the entry point.
- Comparison runs against Railway prod from `server_bench.py` (auth uses
  legacy seed token `dev-token-user1`; Railway requires a real account
  session token from the Google login flow).
