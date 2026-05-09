# V0 — Jerf: Router eval cases + eval runner skeleton

**Owner:** Jerf
**Branch:** `v0/jerf-router-eval`
**Deadline:** h4 converge
**Depends on:** nothing — this branch is self-contained

## Goal

Set up the eval harness that will gate every later router change. Author 20 router test cases now (more by h22) and a runner that loads them, calls a stub router, and prints precision/recall. The router itself doesn't exist yet — the stub returns a fixed/random selection so we can confirm the harness works end-to-end.

## Deliverables

1. **`eval/router_cases.yaml`** with **20 cases** following the format in `plan.md` §4:
   ```yaml
   - id: r_001
     question: "How do we deploy?"
     expected_tiers: [pool, personal]
     expected_agents_any_of: [<infra_owner>]
     forbidden_agents: []
     must_mention_any_of: ["runbook", "migration", "deploy"]
     category: factual
   ```
   - Categories to cover: `factual`, `rationale`, `status`, `cross_cutting`, `out_of_scope`.
   - Use **placeholder agent identifiers** (e.g. `<infra_owner>`, `<db_decider>`) — Jorf hasn't authored the full cast yet, so don't hard-code names. Document that the runner resolves placeholders via a lookup map (see #3).
   - Spread: ~6 factual, ~5 rationale, ~4 status, ~3 cross-cutting, ~2 out-of-scope.

2. **`eval/run_eval.py`** skeleton:
   - Loads `router_cases.yaml`.
   - Calls a `route(question: str) -> RouterDecision` function. For V0, import a **stub** from `eval/_stub_router.py` that just returns a hardcoded decision (e.g. always `{tiers: [pool], agents: ["<infra_owner>"], mode: "single"}`). The real router lands in V2/V3.
   - Computes per-case pass/fail using the rules:
     - **agent precision** = correct_agents / predicted_agents
     - **agent recall** = correct_agents / expected_agents
     - **tier match** = predicted tiers ⊇ at least one of expected tiers
     - **forbidden** = no predicted agent appears in `forbidden_agents`
   - Aggregates: prints macro-precision, macro-recall, per-category breakdown.
   - Emits a markdown report at `eval/reports/<timestamp>.md` and a non-zero exit if precision < 0.80 or recall < 0.85 (the V3 pass bar — for V0 it'll fail loudly, that's fine).

3. **`eval/agent_directory.yaml`** — the placeholder→real-agent-id lookup map. For V0, populate it with the placeholder names referenced in `router_cases.yaml` mapped to `null` (Jorf will fill these once personas are seeded). The runner should warn-but-not-fail when a placeholder is unresolved during V0.

4. **`eval/README.md`**:
   - How to run: `python eval/run_eval.py`
   - How to add a case (the YAML schema, with a comment per field)
   - The pass bars and what they mean
   - Where reports land

## Out of scope for this branch

- No real router implementation (lives at `apps/server/src/relevo/routing/` — V2/V3, not Jerf's V0 problem).
- No retrieval eval (`retrieval_cases.yaml` is V1).
- No CI integration yet (manual runs are fine for V0).

## Definition of done

- [ ] `eval/router_cases.yaml` has 20 cases spanning all five categories.
- [ ] `python eval/run_eval.py` runs against the stub router and produces a markdown report.
- [ ] The runner correctly reports precision/recall (test with the stub: it should fail most cases — that's expected and proves the harness discriminates).
- [ ] `eval/README.md` written.
- [ ] PR opened against `main`.

## Notes

- This branch only creates files under `eval/`. No collisions with any other V0 branch.
- Coordinate with Jorf on agent placeholder names so they match what shows up in `seeds/personas.yaml` later. Use the same string keys (e.g. `<infra_owner>`) — Jerf's eval map and Jorf's personas resolve via that key.
- The pass bar for V3 is **precision ≥ 0.80, recall ≥ 0.85** on the full 30-case set. Build the runner so it enforces those numbers as exit codes — future-you will appreciate it.
