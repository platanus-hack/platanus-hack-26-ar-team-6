# Sarf — V1 Task: Database (Schema, Storage, Seeds)

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Sarf's lane in V1.

## Lane

The database. The storage shape, the migration, the seed data, the
data-access layer the server reads/writes through. The new plan demands
per-user context partitions, a shared project context, and an
append-only Q&A ledger that backs the closure invariant (plan.md §7).
You own all of that.

You are not building API endpoints (Narf), retrieval routing logic
(Jerf), or the on-demand agent (Jorf). You are building what they read
from and write to.

## Starting state

- `migrations/0001_init.sql` — Postgres schema written for the *old*
  plan. Tables: `workspace`, `person`, `agent`, `memory_entry` (with a
  pgvector embedding column and a `tier` enum
  `personal/pool/timeline`), `task` (with statuses, dependencies),
  `timeline_event` (event log).
- `infra/docker-compose.yml` — Postgres + pgvector image, configured
  to mount migrations on startup.
- `seeds/personas.yaml` — one persona (Jorf, backend/data owner).
- `seeds/pool.yaml`, `seeds/tasks.yaml`, `seeds/timeline.yaml` — empty.
- `seeds/__fixtures__/` — test fixtures: `ada.yaml` (Ada Lovelace
  persona), more `personas.yaml`, `pool.yaml`, `tasks.yaml`,
  `timeline.yaml`, and a `memories/` subtree.
- `apps/server/` — has some seed/schema loader code (~part of the 394
  lines) that reads these fixtures.

## Decisions you own in V1

- **Storage backend.** Confirm Postgres + pgvector as the sole backend
  for V1, or layer a graph (graph table + edges in Postgres, or
  external graph DB) on top. Recommendation: stay on
  Postgres+pgvector for V1 — graph-RAG is a V2/V3 question, not a
  hackathon-day-one question. Document the decision.
- **Per-user partitioning scheme.** Three options:
  - one schema per user (clean isolation, awkward to query roster);
  - one table with a `user_id` discriminator column (simplest,
    pgvector indexes work fine, recommended);
  - per-user namespaces in a graph (only relevant if you go graph).
  Pick one and write it down.

## Decisions you contribute to (joint)

- **API surface (with Narf, Marirf consumes).** Narf owns the route
  layer; you own what those routes read/write. The endpoint payload
  shapes have to fit the schema you build, so this is genuinely
  joint. Drive the data-shape side; let Narf drive the route shape.

## Deliverables

1. **New migration applied.** Either rewrite `0001_init.sql` in place
   or add `0002_repivot.sql` that drops the old tables and creates
   the new ones — whichever the team prefers. The end state must have
   no old-plan tables.
2. **New schema.** At minimum:
   - **`user`** — id, display name, auth token (or whatever Narf
     decides for auth), domain summary (the salvaged "expertise
     summary" from the old persona contract).
   - **`project`** — V1 has exactly one project; this row exists so
     project context has a foreign key home.
   - **`context_entry`** (per-user context, partitioned by `user_id`)
     — id, user_id, content, embedding (pgvector), kind (e.g.
     `prompt_answer`, `cross_user_qa`, `seed`), source metadata
     (jsonb), created_at. Append-only. This is the table that
     prompt+answer entries (V1) and cross-user Q&A entries (V2's
     closure invariant write) both live in.
   - **`project_context_entry`** — same shape as `context_entry` but
     project-scoped instead of user-scoped. Used by V3
     (`target="project"`); V1 just needs the table to exist with
     seeded rows.
   - **pgvector index** on the embedding columns.
   - Optional: a Q&A *ledger* table linking cross-user calls
     (asker_user_id, target_user_id, question, answer, the
     `context_entry` id it produced on the target side). This makes
     the closure invariant easier to audit. Decide whether the
     ledger is its own table or just a `kind='cross_user_qa'`
     filter on `context_entry`. Document the choice.
3. **Bootstrap data shape.** Define what `(user_summary,
   project_context)` looks like when Narf's `/bootstrap` endpoint
   returns it. Concretely: a small JSON for the user (display name +
   domain summary + recent entries summary?) and the project context
   (project name, roster of users with their domain summaries). This
   is what the AI sees on session start, including the roster that
   tells the AI who exists.
4. **Data-access functions.** Whatever Python functions Narf's routes
   need: `get_bootstrap(user_id)`, `write_context_entry(user_id,
   prompt, final_answer, …)`, `get_user_directory()` for Jerf's
   eval directory. Land these inside `apps/server/` in whatever
   layout Narf has chosen.
5. **Seeds.** Two users with **deliberately non-overlapping**
   context, plus a small shared project context. The non-overlap is
   what forces V2's cross-user query to happen. Suggested split (you
   can change with the team): User1 owns frontend conventions /
   styling decisions; User2 owns deployment / infra / health checks.
   Seeded entries should be specific enough that "what's our deploy
   target?" can only be answered from User2's context.
6. **Seed loader.** A script (or CLI command) that resets the DB and
   loads the seeds cleanly. Used by every member to get into a known
   state.
7. **Embeddings for seeded entries.** Seeded `context_entry` rows
   need their embedding column populated. Either compute at seed time
   (pick an embedding model — coordinate with Jorf since they're
   handling LLM/model decisions) or leave a `NULL` embedding and
   compute lazily; the latter is fine for V1 if Jerf's retrieval
   routing accepts it.

## Scrap

These are old-plan tables and seed files in your lane. Delete them.

- The `task` table from `migrations/0001_init.sql`.
- The `timeline_event` table from `migrations/0001_init.sql`.
- The `agent` table — agents are spun up on demand in the new plan,
  not persisted as rows.
- The `tier` enum on `memory_entry` (`personal/pool/timeline` is
  old-plan vocabulary).
- `seeds/tasks.yaml` and `seeds/timeline.yaml` (empty stubs for
  old-plan concepts).
- Anything in `apps/server/` that loads or returns task/timeline
  rows.

`workspace` and `person` should be replaced (rename or recreate as
`project` and `user`); their *concept* survives but their schema is
mostly a fresh build.

## Rework

- `seeds/__fixtures__/personas.yaml` (and `ada.yaml`) — keep the
  display-name + domain-tags + expertise-summary shape. Map onto the
  new `user` table. This is the cleanest piece of seed data in the
  repo.
- `seeds/__fixtures__/memories/` — content shape (text + source
  metadata) is reusable. Re-author the content for the
  non-overlapping V1 seeds. The old tier (`personal/pool/timeline`)
  is gone; replace with the new `kind` column.
- `migrations/0001_init.sql` — keep the pgvector enable, keep the
  *idea* of an embedded entry table. Everything else is being rebuilt.
- `apps/server/` schema/seed loader code — keep the loader skeleton,
  rebind it to the new tables.

## Out of scope for V1

- Cross-user Q&A *write* path (V2). The schema must support it; the
  write itself is V2.
- Project-context retrieval (`target="project"` flow is V3). The
  table exists in V1 with seed data; nobody reads from it yet.
- Graph-RAG, edges, or any graph-shaped storage. V1 is flat
  pgvector unless you and the team explicitly choose otherwise.
- Embedding generation pipeline / re-embedding workflows. Compute at
  seed time and move on.
- Migrations beyond the one repivot migration.

## Converge h10 — your part

1. Fresh DB → run migration → all old-plan tables gone, all new
   tables present.
2. Run seed loader → two users, one project, project context, and
   non-overlapping per-user context entries (with embeddings) in
   place.
3. Narf's `/bootstrap` endpoint can call your data-access function
   and return a sensible payload. The roster includes both users.
4. Narf's `/context-entries` POST writes a new row to the per-user
   context table; a SELECT confirms it.
5. Jerf's retrieval routing module can query a target user's
   partition and get sensible top-k results.

## Coordination notes

- Narf is your closest collaborator — agree on the API
  payload shapes (which determine your function signatures) early.
- Jerf needs the per-user partition and embedding column finalized
  before they can write retrieval routing.
- Jorf needs to know the embedding model choice (or own it
  themselves) so seed-time embeddings match what the on-demand agent
  will use in V2. Sync with Jorf.
- Marirf doesn't talk to the DB directly, but the bootstrap payload
  shape is what their UI renders, so loop them in on what the user
  summary looks like.
