# Sarf — V3 Task: Backend Project Context + Retrieval Hardening

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Sarf's lane in V3. V3 only starts if V2 is green at h20; if V2 is shaky,
> skip this and help V4 hardening.

## Lane

Backend implementation for the V3 stretch items that touch server storage,
retrieval, and HTTP contracts.

The main V3 backend goal is `target = "project"` end-to-end: a local AI can
ask for shared project context, the server retrieves from
`project_context_entry`, the on-demand agent answers from that slice, and the
answer is persisted somewhere project-scoped so later project retrieval can
surface it.

You also own the retrieval hardening that is already called out in
`apps/server/src/relevo/DATABASE.md`: move embeddings to the locked
`text-embedding-3-small` dimension, add pgvector indexes only after the
dimension is correct, and keep the lexical fallback working.

You do not own the desktop streaming event contract (Marf), the local
`request_context` tool UI/SDK shape (Jerf), or the on-demand prompt internals
(Jorf). You do own the backend contract they call.

## Coordination

- Pair with Jerf before changing the request body. The desktop client
  currently posts `{target_user_id, question}` from
  `apps/desktop/src/main/tools/request_context.ts`; V3 needs it to preserve
  that path while also accepting `{target: "project", question}`.
- Pair with Jorf before project answers ship. The live route currently imports
  `relevo.agent.answer_from_context`, while Jorf's newer contract is
  `relevo.agents.answer_on_demand`. Decide whether project context uses a
  project-shaped target in that contract or a separate project answer helper.
- Pair with whoever owns deploy before changing migrations on Railway. The
  V2 closure smoke test must stay green after every schema change.

## Starting State

- `project_context_entry` already exists in
  `migrations/0001_init.sql` and is seeded by `seeds/project.yaml`.
- `/bootstrap` already returns `project_context`.
- `/request-context` and `/request_context` reject `target = "project"` in
  `apps/server/src/relevo/api/context.py`.
- User retrieval lives in `retrieve_user_context` in
  `apps/server/src/relevo/db.py`; there is no matching project retrieval
  function yet.
- `context_entry.embedding` and `project_context_entry.embedding` are still
  `vector(1024)`, while the locked embedding model needs `vector(1536)`.

## Deliverables

1. **V2 gate stays green.** Before V3 work, run the closure smoke path and
   confirm user-targeted `request_context` still writes `context_entry` +
   `qa_ledger`. After every backend contract change, rerun it.
2. **Project target API.** Update `RequestContextRequest` and target
   resolution so `POST /request-context` accepts both:
   - existing V2 form: `{ "target_user_id": "<uuid>", "question": "..." }`
   - V3 form: `{ "target": "project", "question": "..." }`
3. **Project retrieval.** Add `retrieve_project_context(conn, project_id,
   question, limit)` beside `retrieve_user_context`. Use the same lexical
   ranking fallback first, over `project_context_entry.content` and metadata.
   Keep the function isolated so vector ranking can replace it later.
4. **Project answer path.** Route `target = "project"` through the on-demand
   answerer with project-scoped entries only. The response should preserve the
   useful V2 fields and add project-specific fields without breaking older
   clients:
   - `answer`
   - `source_user_ids: []`
   - `source_context_entry_ids`
   - `target: "project"`
   - `target_project_id`
   - `retrieved_context_entries`
5. **Project closure write.** Persist project-target Q&A into
   `project_context_entry` so future project queries can retrieve it. Add a
   schema-safe audit path for the demo. Prefer a small additive table
   (`project_qa_ledger`) over weakening V2's `qa_ledger` constraints unless
   the team explicitly wants one generalized ledger.
6. **Seed lock for project context.** Expand `seeds/project.yaml` and
   `seeds/LOCK.md` with one scripted prompt that should route to
   `target = "project"` instead of User1 or User2. Keep it different from the
   V2 deployment prompt so routing is visibly distinct.
7. **Embedding migration prep.** Add the migration/admin change that moves both
   embedding columns to `vector(1536)`. Do not enable vector ranking until
   there is a real backfill path or a deterministic fallback.
8. **Pgvector index only after backfill.** Once embeddings are populated, add
   HNSW indexes for user and project context retrieval. Until then, do not add
   dead indexes over all-null columns.
9. **Smoke tests.** Add `apps/server/scripts/smoke_project_context.py` or
   extend the existing smoke script to prove:
   - `target = "project"` returns 200.
   - retrieved rows come from `project_context_entry`.
   - the project Q&A is materialized back into `project_context_entry`.
   - existing user-target closure still passes.

## Decisions You Own

- The exact project-Q&A persistence shape, as long as it is additive and does
  not break V2's user-targeted closure invariant.
- The `kind` value for project materialized Q&A. Recommended:
  `project_qa`, added to `context_entry_kind`, because
  `project_context_entry` currently reuses that enum.
- The backend response additions for project targets. Keep older fields
  stable so Jerf can merge client support without blocking V2 behavior.
- The retrieval ranking fallback for project entries before vector search is
  ready.
- The migration order for `vector(1536)`, backfill, and HNSW indexes.

## Out Of Scope For V3

- Desktop renderer streaming semantics (`runner:delta`, `runner:final`,
  `runner:error`). Coordinate if the server response shape affects traces, but
  Marf owns the UI/IPC fix.
- General graph-RAG unless V2 retrieval is failing badly enough that the team
  explicitly trades off project target work for it.
- Full multi-target consolidation across users and project. If time remains,
  support it as a thin loop over the single-target backend path, not as a new
  schema.
- Multi-hop policy in the local AI. The backend should tolerate repeated calls,
  but Jerf/Jorf own when the assistant decides to call again.

## Done When

V3 is done for Sarf when these pass on the deployed server:

1. V2 scripted User1 -> User2 request still passes and writes the target user's
   `cross_user_qa` row.
2. User1 can ask a project-level question and the local AI can call
   `request_context({target: "project", question})`.
3. The server retrieves only `project_context_entry` rows, returns a grounded
   answer, and includes source context entry ids.
4. A SQL query shows the project Q&A materialized into
   `project_context_entry`.
5. A second `target = "project"` query on the same topic can surface the prior
   project Q&A row.
