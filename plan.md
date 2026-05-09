# Hackathon Plan — Cross-User Context Workflow

> Read [goal.md](goal.md) first. This plan is the implementation strategy for
> the system described there. When this plan and goal.md disagree, goal.md
> wins and this plan is the bug.

## 0. What we are building

A workflow where a user's local AI assistant can transparently borrow context
from teammates' AI assistants. Three components:

1. **Shared remote server** — owns per-user context databases, a shared
   project context, and an on-demand agent grounded in a target user's
   context.
2. **Local app (per user)** — chat UI + local runner. Hosts the user's AI,
   intercepts its `request_context` tool calls, brokers them to the server,
   persists prompt+answer into the prompting user's DB.
3. **The user's AI assistant** — runs inside the local app, has access to
   the user's local codebase via the runner's `cwd`, uses `request_context`
   to reach across to teammates.

## 1. End-to-end flow

1. **Session start.** App pulls (a) user's own context summary and (b) the
   shared project context (with team roster) from the server.
2. **User prompts.**
3. **AI self-assessment.** Answer or detect missing context.
4. **Missing-context call.** AI calls `request_context({target, question})`
   where `target = user_id`. Local app forwards to server; server retrieves
   target's context slice, runs the on-demand agent against it, returns the
   answer.
5. **Final answer.** AI produces its answer.
6. **Persist.** App writes prompt + final answer to the prompting user's DB.
7. **Closure invariant.** Every cross-user `request_context` call writes the
   Q&A to the *queried* user's DB synchronously, before the server returns
   success. Non-negotiable.

## 2. Hackathon scope

**P0 (required for demo):**

- Deployed shared server (Railway).
- Postgres + pgvector storage.
- Seeded users + project + non-overlapping per-user context.
- Bootstrap endpoint returns `(user_summary, project_context)` with roster.
- `request_context(user_id, question)` end-to-end.
- Stateless on-demand LLM call over retrieved slice.
- Synchronous closure write to the queried user's DB inside the request
  handler.
- Prompt+final-answer write to the asking user's DB.
- Local app: chat UI + runner with `cwd = user's repo`, visible tool-call
  trace.
- Two laptops/sessions during the demo.

**P1:**

- Roster/dashboard panel.
- Demo fallback (pre-recorded answer) if live LLM stalls.
- Smoke tests (see §8).

**Stretch (only after P0 is green):**

- `target = "project"`.
- Multi-target single call.
- Multi-hop (AI calls the tool more than once per turn).
- Richer retrieval, graph-RAG.
- Real-time UI sync between teammates.

**Out of scope:**

- Wrapping third-party coding agents (Cursor, Copilot).
- Generic terminal hooks.
- Native packaging polish, installers, menus.
- Safety layer around codebase edits beyond what the runtime provides.

## 3. Locked decisions

These are not TBD. Treat as fixed unless the team votes to change.

```text
Storage:           Postgres + pgvector
Partitioning:      one context_entries table with owner_user_id/project_id
                   columns; one qa_ledger table for cross-user Q&A
Server:            FastAPI (existing scaffold)
Auth:              bearer header token resolves the asking user; single
                   project for the demo, so cross-project access control
                   is out of scope
Local runner:      Claude Agent SDK (cwd = user repo, custom tool registered)
Desktop stack:     Electron + React (existing scaffold from v0/marf)
request_context:   direct custom tool registered with the runner; HTTP POST
                   to server
On-demand agent:   stateless LLM call with retrieved slice inlined
Hosting:           Railway (or equivalent single deployed instance)
Closure write:     synchronous, inside POST /request_context, before return
```

## 4. Server responsibilities

- **Storage.** `users`, `projects`, `context_entries (owner_user_id,
  project_id, content, embedding, metadata, created_at)`, `qa_ledger
  (asking_user_id, target_user_id, question, answer, created_at)`.
- **Retrieval.** Vector search over `context_entries` filtered by
  `owner_user_id` (or `project_id` for project target).
- **On-demand agent.** Stateless LLM call: retrieved slice + question →
  answer.
- **Bootstrap.** `GET /bootstrap?user_id=...` → `{user_summary,
  project_context, roster}`.
- **Writes.** `POST /context_entries` (prompt+answer for asking user),
  `POST /request_context` (cross-user Q&A; writes ledger + materializes the
  Q&A as a `context_entries` row for the target user, then returns the
  answer).

## 5. Local app responsibilities

- Hit bootstrap on session start, load into AI context.
- Run AI against user prompts via Claude Agent SDK with `cwd` = user repo.
- Register `request_context` as a custom tool; broker to server; return
  answer as tool result.
- After final answer: display, then POST prompt+final-answer.
- Roster/dashboard panel for demo legibility (P1).
- Browser- or Electron-based; Electron scaffold already exists. Don't spend
  time on packaging, installers, native menus.

## 6. `request_context` tool contract

```text
request_context(target, question)
  target:   user_id            (P0)
  target:   "project"          (stretch)
  target:   list of either     (stretch)
  question: free-form natural language
  returns:  {
              answer: string,
              source_user_ids: [user_id],
              source_context_entry_ids: [context_entry_id]
            }
```

Server behavior on `POST /request_context`:

0. Validate bearer token, resolve asking user, validate target user exists,
   reject self-targeting.
1. Retrieve relevant slice of target's `context_entries`.
2. Run on-demand LLM call against the slice + question.
3. Write `qa_ledger` row.
4. Insert a `context_entries` row owned by `target_user_id` containing the
   Q&A.
5. Return `{ answer, source_user_ids, source_context_entry_ids }`.

Both persistence writes (steps 3 and 4) happen before the response. If
either fails, the request fails and no Q&A is durable.

`source_context_entry_ids` are the `context_entries.id` values from the
retrieved slice that grounded the answer. They prove the answer came
from the target user's stored context. Surface them in HTTP responses
and Q&A row metadata; do not require them in the MCP tool result the
client AI sees.

## 7. Closure invariant

> Every cross-user query enriches the queried user's context.

Implemented by step 4 above. Testable by issuing a cross-user query as
User1, then issuing a retrieval query as User2 on the same topic and
seeing the Q&A entry surface.

## 8. Version plan

~36-hour block. Each version keeps prior smoke tests green. Stub anything
blocked, but stubs must preserve the real contract.

### V0 — current state

Existing on `main`:

- FastAPI scaffold (`/health`).
- Postgres + pgvector via `infra/docker-compose.yml`.
- One migration `0001_init.sql` with old-plan tables.
- Old-plan prompts (router/synthesis), persona contract, eval harness
  skeleton, persona/seed fixtures.
- Electron desktop shell with health-check IPC.

V1 deletes/reworks the old-plan artifacts. Specifics live in a separate
implementation issue; the main plan keeps the directive short:

```text
Remove old Relevo/router/task/synthesis artifacts.
Keep FastAPI scaffold, pgvector infra, persona/seed shape, Electron shell.
Rebuild schema around users, projects, context_entries, qa_ledger.
```

### V1 — single-user loop (h0–h10)

End state: one user can prompt, the AI answers using bootstrap context +
local code, the prompt+answer persists. No cross-user calls yet.

Deliverables:

- New migration: `users`, `projects`, `context_entries`, `qa_ledger`. Old
  tables dropped.
- Server endpoints: `/health`, `/bootstrap`, `POST /context_entries`,
  `POST /request_context` (stub returning a deterministic placeholder).
- Local app: chat UI works, hits bootstrap, runs Claude Agent SDK with
  `cwd` = configured repo path, streams output.
- After every answer, app POSTs prompt+answer.
- Two users seeded with deliberately non-overlapping context.
- Server deployed and reachable.
- **Deployment gate by h4:** `GET /health` on the deployed URL must return
  200 from a teammate's laptop by h4. Other endpoints can still be stubs
  at h4. Late deployment is the most common hackathon failure; this gate
  forces the issue early.

Converge h10:

1. `/health` works on deployed server.
2. App launches for User1, bootstrap fires, roster shows User2.
3. User1 prompts something answerable from local code or bootstrap.
4. AI answers; UI shows it; entry appears in User1's DB.

### V2 — cross-user `request_context` (h10–h20)

The defining feature.

Deliverables:

- `request_context` tool registered with the runner, replaces the V1 stub
  on the client side.
- `POST /request_context` does retrieval → LLM call → ledger write →
  context_entries write → return. All synchronous.
- AI system prompt updated so it knows when/how to call the tool.

Converge h20:

1. User1 prompts something only User2's context can answer.
2. AI calls `request_context({target: user2_id, question})`.
3. Server returns an answer grounded in User2's slice.
4. Final answer shown to User1; User1's DB has prompt+answer.
5. **User2's DB has the Q&A entry** (via `context_entries` + `qa_ledger`).
6. A retrieval as User2 on the same topic surfaces the Q&A entry.

### V3 — stretch (h20–h28)

Pick from stretch list only after V2 is green:

- `target = "project"` end-to-end.
- Multi-hop loop (AI calls the tool more than once per turn).
- Multi-target single call.
- Retrieval improvements driven by V2 failures.
- **Runner streaming event contract.** Today the renderer's
  `chatStore.mergeAssistantText` carries a text-prefix heuristic
  (V2 workaround) to deduplicate streamed deltas against a final
  full-text snapshot from the SDK loop. Replace it with explicit IPC
  event types (`runner:delta`, `runner:final`, `runner:error`) so the
  store does pure append on deltas and pure replace on final. Drop the
  heuristic. Owner: Marf when wiring real streaming to the chat UI;
  coordinate with Jerf since the IPC channel is shared with
  `request_context` tool-call traces.

If V2 is shaky at h20, skip V3 entirely and start V4.

### V4 — demo hardening (h28–h36)

- Two laptops both pointed at the deployed server, both seeded.
- Fallback path: pre-recorded answer through the same response shape if
  the on-demand LLM stalls.
- Visible tool-call trace in the UI (which teammate is being queried,
  when the answer arrives).
- Final smoke pass on the scripted demo + two unscripted prompts.
- `seeds/LOCK.md` with users, project context, demo prompts.
- h28–h30 seed lock, h30–h32 hardening, h32–h34 rehearsal, h34–h36 buffer.

Converge h36:

- Both laptops launch clean.
- Scripted demo: User1 asks → AI silently queries User2 → answer.
- Show User2's DB updated (a single SQL query against `context_entries`).
- User2 then runs their session and a follow-up query proves the closure
  property.
- Fallback only if the live LLM times out.

## 9. Smoke tests

These cumulate. A change that breaks one is a stop-the-room bug.

```text
- /health returns 200
- /bootstrap returns user_summary + roster
- POST /context_entries persists prompt+answer
- POST /request_context returns answer grounded in target's slice
- After /request_context, target user's DB has the Q&A
- Subsequent retrieval against target user surfaces that Q&A
```

Closure verification = direct SQL query against `context_entries` (e.g.
`apps/server/scripts/smoke_closure.py`). No dedicated retrieval endpoint
for V1; the V2 path through `POST /request_context` plus a SQL row check
is sufficient proof for the demo.

Eval harness ambitions (router cases, multi-hop cases, graded grounding)
are stretch. The harness skeleton survives V1 cleanup; populating it is
P2.

## 10. Build discipline

1. Shared deployed server is required.
2. Closure invariant is P0 — no PR merges without it once V2 starts.
3. Stubs must preserve the real API contract.
4. Feature freeze at h28. After: data, fixes, fallbacks, polish only.
5. Anything that breaks the cross-user demo blocks everything else.

## 11. Lane assignments

Hackathon team of five. The V0 split (Narf/Sarf/Jorf/Jerf/Marf) is
re-mapped against this plan's components. Jorf has effectively delivered
V1-class work already (agent persona + prompt scaffold); his remaining
load is split with Jerf so both have meaningful surface area. The
router-eval lane Jerf owned in V0 is downgraded — eval is stretch, not
blocking.

| Lane | Owner | Scope |
|------|-------|-------|
| Server (FastAPI, endpoints, retrieval) | Narf | `/bootstrap`, `POST /context_entries`, `POST /request_context` skeleton, retrieval over pgvector |
| Schema, migrations, seeds | Sarf | New migration, `context_entries`, `qa_ledger`, seeded non-overlapping users, `seeds/LOCK.md` |
| Local app (Electron + UI + runner) | Marf | Chat UI, bootstrap call on session start, runner integration with Claude Agent SDK, dashboard panel, tool-call trace |
| On-demand agent + prompt + retrieval glue | Jorf | Stateless LLM call wiring, agent system prompt rebind, retrieval-quality tuning |
| `request_context` tool + closure write + ledger | Jerf | Custom tool registered with the runner, client-side broker, server-side ledger + closure write inside `POST /request_context`, smoke tests for closure property |

Eval/router work that Jerf owned in V0 is paused. If a lane finishes
early, the spillover is V3 stretch, not eval cases.

Jorf and Jerf own the seam where the AI's tool call becomes a real
cross-user write. They pair on the contract for `POST /request_context`
at h0 so the server lane (Narf) and the client lane (Jerf) agree on
payloads before either codes.
