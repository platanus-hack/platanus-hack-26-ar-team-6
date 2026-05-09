# Narf — V1 Task: Deployment (Server, API, Hosting)

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Narf's lane in V1.

## Lane

The whole deployment story — the FastAPI server, the API endpoints, the
hosting target, and getting it reachable from every member's local app.
The shared remote server is the load-bearing piece of the new plan
(see plan.md §4): if the server isn't reachable, nothing else works.
You also own the auth scheme and any cross-cutting plumbing (config,
logging, health, error handling).

You are not building the storage layer (Sarf) or the retrieval routing
(Jerf) or the on-demand agent (Jorf). You are building the surface
those things attach to.

## Starting state

- `apps/server/` — FastAPI scaffold, ~394 lines of Python. Only one
  endpoint: `GET /health` returning `{status, sha, models}`. Config
  loader exists. No real routes beyond health.
- `infra/docker-compose.yml` — single Postgres+pgvector service. Local
  dev only.
- `infra/railway.json` — one-line stub.
- `infra/README.md` — describes the local-only setup from the old
  plan.

## Decisions you own in V1

- **Auth scheme.** Per-user header token (e.g. `X-User-Id` plus a
  shared secret, or per-user bearer token). Pick the simplest thing
  that lets multiple laptops authenticate as different users against
  the same shared server. Document in `apps/server/`.
- **Hosting target.** Railway is already stubbed; confirm or replace.
  The constraint is: a single deployed instance that all members'
  local apps can hit, with Postgres+pgvector available. If Railway
  works for the team, lock it in.

## Decisions you contribute to (joint)

- **API surface (with Sarf, with Marirf as primary consumer).** You
  own the endpoint layer and the request/response shapes. Sarf owns
  what those endpoints read/write underneath. Marirf consumes them.
  Drive the design conversation — the API is yours to ship.
- **`request_context` tool implementation (with Jorf).** Jorf owns
  what the AI sees on the client side; you own the corresponding
  server endpoint. Whether the tool transport is direct SDK tool, MCP,
  or custom HTTP, the *server endpoint* is yours.

## Deliverables

1. **API surface implemented.** At minimum, V1 needs:
   - `GET /health` (kept, augment with build sha + deployed timestamp).
   - `GET /bootstrap?user_id=…` — returns `(user_summary,
     project_context)` including the team roster. Sarf provides the
     data; you provide the route.
   - `POST /context-entries` (or your chosen path) — writes a
     prompt+final-answer entry to the prompting user's DB. Body:
     `{user_id, prompt, final_answer, …}`. Append-only.
   - `POST /request-context` — V1 stub. Returns a deterministic
     placeholder (e.g. `{answer: "[V1 stub] no cross-user retrieval
     yet", source_user_ids: [], citations: []}`) so Marirf and Jorf
     can wire the client side end-to-end. The contract is final in
     V1; only the implementation changes in V2.
2. **Auth wired.** Every endpoint except `/health` rejects requests
   without the chosen auth header. Trivial to set per-user via
   environment / settings on the local app.
3. **Server deployed.** The chosen hosting target has a live URL that
   the team can hit. `/health` works in production. Marirf can point
   the local app at the deployed URL and bootstrap.
4. **`infra/railway.json`** completed (or replaced with your hosting
   target's config), and `infra/README.md` updated to reflect the
   shared-remote-server reality (not "everything on one laptop").
5. **Logging and error handling.** Enough that when something goes
   wrong during the V1 demo, the team can read a log and tell whose
   lane the bug is in. You don't need to ship observability; you do
   need readable error responses.
6. **OpenAPI / contract artifact published.** FastAPI gives you this
   for free at `/docs` and `/openapi.json`; make sure it's accurate
   and reachable in the deployed environment so Marirf can sanity-
   check shapes.

## Scrap

Nothing structural in your lane. Old-plan endpoint sketches in
`plan.md` (the previous V1's API surface in §4 of the old plan) are
gone — don't reach for them. Anything in `apps/server/` referring to
`workspaces`, `agents`, `tasks`, `timeline_events`, `claims`, or
`project_rules` should be removed or refactored as part of your
endpoint implementation work.

## Rework

- `apps/server/` — keep the FastAPI app, the config loader, and
  whatever DB-connection plumbing exists. Replace the route layer
  with the V1 endpoints. The `/health` endpoint stays (extend it).
- `infra/docker-compose.yml` — keep as the local dev story. Members
  who want to develop server-side without hitting the deployed
  instance use this.
- `infra/railway.json` — see deliverable 4.

## Out of scope for V1

- Real `request_context` retrieval/agent logic on the server. V1
  ships only the stub endpoint; V2 makes it real (the endpoint
  itself is yours; the routing-and-agent guts are Jerf+Jorf).
- Cross-user Q&A persistence (V2; the closure invariant write).
- Project-scoped (`target="project"`) endpoints (V3).
- SSE / streaming endpoints. V1 chat streaming runs entirely in the
  local app (Jorf+Marirf own the agent runtime and its native
  streaming). Server endpoints in V1 can be plain request/response.
- Production-grade auth (OAuth, sessions). Header token is enough.

## Converge h10 — your part

1. Fresh deploy from `main` succeeds. `/health` returns 200 with the
   right sha.
2. Marirf's local app, configured with the deployed URL and a
   per-user token, successfully calls `/bootstrap` and gets back a
   roster including User2.
3. After User1 chats with the AI, the local app POSTs to
   `/context-entries` and the server stores it (Sarf's table). A
   curl against the server can confirm the entry exists.
4. The `/request-context` stub responds with the placeholder shape
   when called.

## Coordination notes

- Sarf's schema is your hardest dependency. Agree on the data model
  and table names early; you can scaffold endpoints against fixtures
  while Sarf is finishing migrations.
- Marirf needs the bootstrap and write endpoint shapes early. Publish
  them in writing (in `apps/server/` README or as OpenAPI) before
  you've fully implemented them, so Marirf can build against them.
- Jerf will mount the retrieval routing module inside the server.
  Agree on where it lives and what function signature you call from
  the `/request-context` route (even though V1's body is a stub).
- Jorf will own the on-demand agent in V2; the server endpoint shape
  for `/request-context` is the contract you both agree to in V1.
