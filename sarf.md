# Sarf — V4 Task: Backend Demo Hardening

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Sarf's backend lane for V4. V4 is not new product work; it is the final
> hardening pass that makes the demo survive real laptops, Railway, flaky LLMs,
> and repeated rehearsals.

## Implemented State Audited

I checked the current repo before writing this plan. Do not rebuild these
pieces unless they fail a smoke test.

- V2 user-target flow is implemented in
  `apps/server/src/relevo/api/context.py`: `POST /request-context` accepts a
  user UUID, retrieves `context_entry`, calls `answer_on_demand`, writes
  `context_entry(kind='cross_user_qa')`, writes `qa_ledger`, and returns
  citations/source context ids.
- V3 project-target flow is implemented: `target = "project"` retrieves
  `project_context_entry`, writes `project_context_entry(kind='project_qa')`,
  writes `project_qa_ledger`, and returns `target_project_id`.
- Schema migration tracking exists in `relevo.admin.ensure_schema`.
  `0002_v3_project_context.sql` adds `project_qa`, `project_qa_ledger`, and
  migrates both embedding columns to `vector(1536)`.
- The local DB currently has `project`, `app_user`, `context_entry`,
  `project_context_entry`, `qa_ledger`, `project_qa_ledger`, and
  `schema_migration`; enum values are `seed`, `prompt_answer`,
  `cross_user_qa`, and `project_qa`.
- `seeds/LOCK.md` now contains both the User1 -> User2 demo prompt and the
  project-context prompt.
- Existing smoke scripts: `apps/server/scripts/smoke_closure.py` and
  `apps/server/scripts/smoke_project_context.py`.

Known gaps from inspection:

- User-target LLM failure currently returns 502 and writes no closure row.
  That is correct for normal failure semantics but not enough for V4's
  "pre-recorded answer through the same response shape" demo fallback.
- Project-target requests use the older `relevo.agent.answer_from_context`
  fallback path, while user-target requests use Jorf's structured
  `answer_on_demand`.
- Route tests cannot run from the current server environment because
  `httpx` is missing from `apps/server/pyproject.toml`.
- Local rehearsals without `ANTHROPIC_API_KEY` cannot pass the V2 user-target
  smoke unless V4 fallback is added.
- The seed loader resets tables through `TRUNCATE ... CASCADE`; make
  `project_qa_ledger` explicit so repeated rehearsals are boring.
- `infra/README.md` still describes old V0 tables and seed behavior.

## Lane

Own the backend pieces needed for a reliable final demo:

- deployed schema and seed state;
- deterministic fallback answers when the live on-demand LLM stalls or is not
  configured;
- smoke scripts that prove the complete demo contract;
- backend test dependencies and route coverage;
- SQL snippets and docs the team can use during rehearsal.

You do not own the desktop renderer, visible tool-call trace, or runner IPC.
Coordinate with Marf/Jerf where auth tokens and response fields touch the
client, but keep this lane focused on the shared server.

## Coordination

- Pair with Marf/Jerf on auth before rehearsal. The server requires bearer
  tokens (`dev-token-user1`, `dev-token-user2`); the desktop must pass the
  token, not just `userId`.
- Pair with Jorf on fallback text. The fallback should be acceptable as a
  grounded answer and should not pretend the live model succeeded.
- Pair with Narf before changing deploy variables. Railway should keep
  `AUTO_MIGRATE=1`; `AUTO_SEED=1` is only for fresh DBs unless
  `FORCE_SEED=1` is intentionally used before a rehearsal.

## Deliverables

1. **Demo fallback through the real response shape.**
   - Add a config gate such as `DEMO_FALLBACK_ENABLED=1`.
   - When the user-target `answer_on_demand` path raises
     `OnDemandAgentError` or times out and fallback is enabled, return a
     deterministic answer with the same `RequestContextResponse` shape.
   - Still write the target user's `cross_user_qa` row and `qa_ledger` row
     before returning success.
   - Persist metadata such as `fallback: true`, `fallback_reason`, and the
     retrieved source context ids.
   - Keep fallback disabled or clearly marked outside demo mode.
2. **Fallback fixtures.**
   - Put the pre-recorded answers in a small, reviewable fixture file under
     `seeds/` or `apps/server/`, not as scattered route literals.
   - Cover at least the locked User1 -> User2 deployment prompt and the
     project architecture prompt.
   - If no exact fixture matches, fall back to an extractive answer from the
     retrieved rows rather than returning an empty success.
3. **Project-target consistency.**
   - Keep the existing `target="project"` flow, but annotate project fallback
     responses and persisted `project_qa` rows with the same fallback metadata
     fields used by the user-target path.
   - Confirm project responses include stable `source_context_entry_ids`,
     `target`, `target_project_id`, and `project_context_entry_id`.
4. **Final demo smoke script.**
   - Add `apps/server/scripts/smoke_demo.py` that runs the backend demo path in
     one command:
     `/health`, `/bootstrap` for both users, `POST /context-entries`,
     User1 -> User2 `request_context`, closure SQL check, project
     `request_context`, project closure SQL check, and a follow-up retrieval
     check for each closure row.
   - It must accept `SERVER_URL`, `DATABASE_URL`, `ASKER_TOKEN`, and
     `TARGET_TOKEN`.
   - It must print the exact SQL proof snippets or the row ids the team should
     show during the demo.
5. **Route and fallback tests.**
   - Add `httpx` to the server test/runtime dependency set so
     `fastapi.testclient.TestClient` imports cleanly.
   - Add route tests for `target="project"`.
   - Add tests for user-target fallback enabled, fallback disabled, and
     metadata written through the closure path.
6. **Rehearsal-safe seed reset.**
   - Update `reset_tables` to explicitly truncate `project_qa_ledger` along
     with `qa_ledger`, `context_entry`, `project_context_entry`, `app_user`,
     and `project`.
   - Keep seed content frozen except for fallback fixtures and V4 rehearsal
     notes. Do not keep tweaking demo facts after h30.
7. **Q&A growth guard.**
   - Repeated rehearsals currently add more `cross_user_qa` and `project_qa`
     rows, and retrieval boosts those rows. Cap persisted fallback/live answers
     to a reasonable length and strip nested `QUESTION ... ANSWER` blocks
     before writing materialized Q&A rows.
   - Do not change the closure invariant; every successful request still
     writes the closure row.
8. **Deployment verification docs.**
   - Update `apps/server/README.md`, `apps/server/src/relevo/DATABASE.md`,
     `infra/README.md`, and `seeds/LOCK.md` with the V4 commands that actually
     work.
   - Include the Railway variables: `AUTO_MIGRATE=1`, `DATABASE_URL`,
     `ANTHROPIC_API_KEY` for live mode, and `DEMO_FALLBACK_ENABLED=1` for demo
     fallback mode.

## Decisions You Own

- The fallback fixture shape and match strategy. Keep it simple: exact locked
  prompt match first, then lexical/extractive fallback from retrieved rows.
- Whether fallback mode returns HTTP 200 with `fallback: true` metadata or
  keeps returning 502 when fallback is disabled. Recommended: 200 only when
  `DEMO_FALLBACK_ENABLED=1`.
- The length cap for materialized Q&A rows. Recommended starting point:
  1500-2000 characters for `answer` in stored content and metadata.
- The final smoke script's output format. Prefer boring, copyable row ids and
  SQL over clever summaries.

## Out Of Scope For V4

- Vector retrieval backfill and HNSW indexes. The columns are already
  `vector(1536)`, but embeddings are still null. Do not risk demo stability on
  this unless every P0 smoke is already green.
- Multi-target and graph-RAG. V4 is feature freeze.
- Desktop streaming event semantics and visual polish.
- Changing the auth model beyond documenting and verifying the bearer tokens
  the desktop must send.

## Done When

V4 backend is done when this passes against the deployed Railway server:

1. `GET /health` returns 200 and a real Railway SHA.
2. `schema_migration` shows `0001` and `0002` applied.
3. `apps/server/scripts/smoke_demo.py` passes with live LLM enabled.
4. The same smoke passes with live LLM unavailable and
   `DEMO_FALLBACK_ENABLED=1`.
5. The User1 -> User2 scripted prompt writes `context_entry(kind='cross_user_qa')`
   and `qa_ledger`.
6. The project scripted prompt writes `project_context_entry(kind='project_qa')`
   and `project_qa_ledger`.
7. Follow-up retrieval for both target user and project surfaces the closure
   rows.
8. Backend route tests run from the declared server environment without
   missing-package errors.
