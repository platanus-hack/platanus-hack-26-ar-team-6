# Hackathon Plan — Cross-User Context Workflow

> Read [goal.md](goal.md) first. This plan is the implementation strategy for
> the system described there. When this document and goal.md disagree,
> goal.md wins and this document is the bug.

## 0. What we are building

A workflow where a user's local AI assistant can transparently borrow context
from teammates' AI assistants. Three components:

1. **Shared remote server** — owns per-user context databases, a shared
   project context, and the ability to spin up an *agent built from a given
   user's context* (live LLM + retrieval over that user's DB) on demand.
2. **Local app (per user)** — a coding-agent runner with a chat-style prompt
   surface and a project dashboard. Hosts the user's AI, intercepts its
   missing-context tool calls, brokers them to the server, and persists the
   final prompt+answer into the prompting user's DB.
3. **The user's AI assistant** — runs inside the local app, has access to the
   user's local codebase via a runner that points at a working directory, and
   uses a `request_context` tool to reach across to teammates.

Implementation note (carried over from prior plan, kept by design):
the local app is structured as a UI + local runner, where the runner spins up
the coding-agent runtime (e.g. Claude Agent SDK) with `cwd` set to a working
directory. The user prompts via the app's chat surface; the runner is the
mechanism, not a separate product.

## 1. The end-to-end flow this plan must implement

This is the same flow as goal.md §"The end-to-end flow", restated as the
contract every version converges toward:

1. **Session start.** App pulls (a) the user's own context summary and (b)
   the shared project context (which includes the team roster) from the
   server. Both are loaded into the AI's initial context.
2. **User prompts.** User types in the app's chat UI.
3. **AI self-assessment.** AI either answers, or decides it is missing
   context.
4. **Missing-context loop.** AI calls `request_context({target, question})`
   where `target` is a user id, `"project"`, or both. The local app forwards
   the request to the server; the server retrieves the relevant slice of the
   target's stored context, spins up an agent grounded in that slice, gets an
   answer, returns it. The app feeds the answer back to the user's AI as the
   tool result.
5. **Iterate.** AI may call `request_context` again if the answer surfaces a
   new gap. Loop until the AI is satisfied.
6. **Final answer.** AI produces its answer.
7. **Persist.** App displays the answer, then writes the prompt + final
   answer into the prompting user's DB.
8. **Closure invariant.** Every cross-user `request_context` call — the
   question User1's AI asked, and the answer the queried user's agent gave —
   is also written into the *queried* user's DB. This is non-negotiable: it
   is what makes context compound across the team.

## 2. Hackathon scope

In scope:

- Shared remote server (single deployed instance, e.g. Railway) that all
  users' local apps connect to. Required — the cross-user mechanism cannot
  exist on a single laptop.
- Per-user context DBs and one shared project context, on the server.
- Server-side ability to spin up an agent built from a target user's context.
- Local app (UI + runner) on at least two laptops/sessions during the demo.
- The user's AI assistant has access to the user's real local codebase (the
  runner's `cwd` is the user's working repo). Editing the user's repo is the
  point — the AI is a real coding assistant.
- `request_context` tool exposed to the AI.
- Bootstrap context fetch at session start.
- Persisting prompt + final answer to the prompting user's DB.
- Persisting cross-user Q&A into the queried user's DB.
- Multi-hop missing-context loop (AI can call the tool more than once per
  turn).

Out of scope:

- Wrapping arbitrary third-party coding agents (Cursor, Copilot, etc.).
  The local app *is* the user's coding agent.
- Generic terminal-hook integrations.
- A polished safety layer around codebase edits beyond what the underlying
  agent runtime already provides.
- Real-time UI sync between teammates' dashboards (the cross-user mechanism
  is the AI loop, not a live shared UI).

## 3. Storage shape

**TO BE DETERMINED IN V0/V1.** goal.md leaves this open: graph DB, Postgres
+ pgvector, hybrid, or other. Leaning toward a graph for graph-RAG, but
the plan must not depend on the choice. V0 picks one and writes it down;
later versions inherit it.

Whatever backend is chosen, it must support:

- per-user context partitions (one logical DB or namespace per user);
- a shared project-context partition;
- retrieval that takes `{target, question}` and returns a relevant slice;
- append-only writes for prompt/answer entries and cross-user Q&A entries.

## 4. Server responsibilities

The shared remote server owns:

- **Storage.** Per-user context DBs and the shared project context.
- **Retrieval.** Given `{target, question}`, return the relevant slice of
  the target's stored context. **Algorithm TO BE DETERMINED IN V1.**
- **On-demand agent.** Given a retrieved slice, spin up an LLM agent
  grounded in that slice and answer the question. **Runtime/model choice
  TO BE DETERMINED IN V1.** (Could be a stateless LLM call with the slice
  inlined; could be a sub-agent process; the contract is what matters.)
- **Bootstrap context.** Endpoint that returns `(user_summary,
  project_context)` for a given user, including the team roster.
- **Write ingest.** Endpoints that accept (a) prompt+answer entries from a
  prompting user's app and (b) cross-user Q&A entries from the queried
  user's perspective.

API surface: **TO BE DETERMINED IN V0.** Concrete endpoint paths, payload
shapes, and auth scheme are designed in V0 alongside the storage choice.
The capability list above is what the API must cover.

## 5. Local app responsibilities

The local app is a UI + runner. The UI is a chat surface (and a small
project dashboard for visibility). The runner hosts the user's AI assistant
with `cwd` set to the user's actual working repo.

Responsibilities:

- **Session start.** Hit the server's bootstrap endpoint, load
  `(user_summary, project_context)` into the AI's initial context. The
  project context must include the team roster so the AI knows who exists
  and roughly what each teammate owns.
- **Conversation loop.** Run the AI against user prompts. Stream output back
  to the chat UI.
- **Tool brokering.** When the AI calls `request_context({target,
  question})`, intercept the call, forward to the server, return the answer
  as the tool result. Allow multiple calls per turn (multi-hop).
- **Codebase access.** The runner's `cwd` is the user's real repo. The AI
  has the runtime's normal file/edit/command tools.
- **Persistence.** After the AI's final answer:
  1. display it,
  2. POST the prompt+final-answer to the server for the prompting user's DB.
- **Roster/dashboard view (optional, for demo legibility).** A small panel
  showing which teammates exist, recent context entries, and the running
  conversation. Implementation **TO BE DETERMINED IN V1**.

Local-runner runtime choice: **TO BE DETERMINED IN V0.** Likely Claude
Agent SDK because it supports `cwd`, file/edit/command tools, streaming,
and custom tool registration — but the plan does not require that
specific SDK.

## 6. The `request_context` tool

The single mechanism by which the AI reaches across to teammates.

```text
request_context(target, question)
  target:   user_id | "project" | list of either
  question: free-form natural language, written by the AI
  returns:  { answer: string, source_user_ids: [user_id], citations?: [...] }
```

Behavior:

- The local app forwards the call to the server.
- The server, for each target user, retrieves the relevant slice of that
  user's context and runs the on-demand agent against it.
- For `"project"` targets, the server uses the shared project context the
  same way.
- The server returns a single consolidated answer to the local app.
- The local app returns it to the AI as the tool result.
- The AI may call the tool again if a new gap appears.

Closure invariant (see §7): every per-user invocation of this tool also
results in a Q&A entry written to that target user's DB.

Tool implementation (direct SDK tool vs MCP vs custom): **TO BE
DETERMINED IN V0.**

## 7. The closure invariant

> When a user's AI queries another user's agent, the queried user's DB must
> be updated with the Q&A the queried user's agent produced.

This is the load-bearing property of the whole system. It is what makes the
shared brain compound: every cross-user query enriches the queried user's
context, not just the asking user's.

Implementation details — when in the request lifecycle the write happens
(synchronously inside the server's request handler vs queued), what exact
shape the Q&A entry takes, how it is tagged so it surfaces in later
retrievals — **TO BE DETERMINED IN V1.** The plan only requires that the
write is durable and visible to subsequent retrievals on the queried user's
context.

Persisting the prompting user's prompt+answer is the symmetric write and
follows the same "TO BE DETERMINED IN V1" note for entry shape.

## 8. Version plan

The hackathon block is roughly 36 hours. Each version must keep the previous
versions' smoke tests passing. If a lane is blocked, ship a deterministic
stub that preserves the contract so the version can still converge.

### V0 — Decisions and scaffold (h0–h4)

V0 is when we lock the implementation choices that the rest of the plan
deferred. Nothing fancy gets built; everything else gets unblocked.

Deliverables:

- **Storage backend chosen and a migration applied** (graph DB, Postgres+
  pgvector, or hybrid). Per-user partitioning scheme written down.
- **API surface drafted.** Concrete endpoints for: bootstrap, request
  context, write prompt+answer, write cross-user Q&A. Payloads sketched.
- **Local-runner runtime chosen.** A "hello world" run where the local app
  starts the runtime with `cwd=<demo repo>` and streams a trivial response
  to the chat UI.
- **Server deployed** (single shared instance, simple auth like a per-user
  header token).
- **Eval harness skeleton** — at minimum, fixture cases for "AI correctly
  decides it is missing context" and "server returns sensible answer for a
  cross-user query".
- **Seed loader skeleton** — can populate two users' DBs and the project
  context with fixture data.

Converge h4: server reachable; local app boots; trivial end-to-end "user
prompts, AI answers without needing teammates" works.

### V1 — Single-user happy path with persistence (h4–h10)

The first real loop: one user prompts, AI answers using only its bootstrap
context and local codebase, and the prompt+answer is persisted to that
user's DB. No cross-user calls yet.

Deliverables:

- Bootstrap endpoint returns `(user_summary, project_context)` with roster.
- Local app loads bootstrap into the AI on session start.
- AI can answer prompts using local codebase tools.
- Persistence: prompt+final-answer written to the prompting user's DB.
- Retrieval algorithm v1 implemented (well enough to support V2's
  cross-user queries). **Specific algorithm TBD here.**
- Seed two users with distinct, non-overlapping context.
- UI: chat surface + a minimal roster/recent-entries panel.

Converge h10:

1. User1 starts a session — bootstrap loads.
2. User1 asks a question answerable from local code + their own context.
3. AI answers. UI displays it.
4. The prompt+answer appears in User1's DB on the server.
5. Refresh the app: history is still there.

### V2 — Cross-user `request_context` (h10–h18)

The defining feature lights up: the AI realizes it is missing teammate
context, calls `request_context`, the server spins up an agent grounded in
the targeted teammate's context, returns an answer, and the AI uses it.

Deliverables:

- `request_context` tool exposed to the AI inside the runner.
- Server endpoint accepts `{target, question}`, runs retrieval over the
  target user's DB, runs the on-demand agent, returns an answer.
- On-demand agent runtime/prompt template implemented. **Model and exact
  prompt TBD here.**
- AI prompt/system updated so the AI knows when and how to call the tool,
  using roster info from bootstrap.
- Closure invariant: the cross-user Q&A is written to the queried user's
  DB as part of the request lifecycle.
- Eval cases: queries that should trigger `request_context`, queries that
  should not, and check that the answer is grounded in the target user's
  seeded context.

Converge h18:

1. User1 prompts something User1's context cannot answer but User2's can.
2. AI calls `request_context({target: user2, question: ...})`.
3. Server retrieves User2 slice → spins up User2-grounded agent → answers.
4. AI uses the answer, produces final answer to User1.
5. User1's DB has the prompt+final-answer.
6. **User2's DB has the cross-user Q&A entry.**
7. A subsequent prompt from User2 retrieving on the same topic surfaces
   the Q&A entry — closure property demonstrated.

### V3 — Multi-hop and project-scoped queries (h18–h28)

The AI can iterate: a teammate's answer reveals a new gap, AI calls the
tool again, possibly against a different teammate or `"project"`. Also
firms up the project-context path.

Deliverables:

- AI prompt allows multiple `request_context` calls per turn, with a
  reasonable termination signal.
- `target = "project"` works: server retrieves over the shared project
  context and runs the on-demand agent against that.
- Multi-target single-call (`target = [user2, "project"]`) consolidated
  server-side. **Consolidation strategy TBD here** — single agent over
  combined slice vs parallel agents + merge.
- Retrieval improvements informed by V2 eval failures. **Specific
  improvements TBD here.**
- Eval: at least one case requiring two hops (User1 → User2 → User3 or
  User1 → User2 → project).

Converge h28:

1. User1 prompts a question requiring info from User2 *and* User3.
2. AI calls `request_context` once, sees a gap, calls again.
3. Final answer integrates both teammates' contributions.
4. User1's DB has prompt+answer; User2's and User3's DBs each have their
   own cross-user Q&A entries.

### V4 — Demo hardening (h28–h36)

Make the multi-laptop demo reliable and readable.

Deliverables:

- Two laptops (or two sessions) running the local app, both pointed at the
  shared server. Demo seeded with two distinct users.
- Fallback path for the on-demand agent if the live LLM stalls — replay a
  pre-recorded answer through the same response shape.
- Visual cues in the UI: when `request_context` is firing, which teammate
  is being queried, when an answer comes back. Optional but high-leverage.
- Final eval pass on the exact demo prompts plus two unscripted prompts.
- Seed lockfile (`seeds/LOCK.md`) documenting users, project context, and
  demo prompts.
- h28–h30 dataset jam, h30–h32 integration hardening, h32–h34 rehearsal,
  h34–h36 buffer/submission.

Converge h36:

- Clean app launch on both laptops.
- Run the scripted demo: User1 asks → AI silently queries User2 → answer.
- Show User2's DB updated.
- User2 then runs their own session and a follow-up query proves the
  closure property.
- Use fallback only if the live agent times out.

## 9. Build discipline

- goal.md is the source of truth. If this plan and goal.md drift, fix the
  plan.
- The shared server is required, not optional. The cross-user mechanism is
  the product.
- The local app's runner points at the user's real codebase. Disposable
  worktrees are not used — that contradicts the goal.
- Closure invariant (queried user's DB gets the Q&A) is a P0. Skipping it
  breaks the demo's success criterion.
- Wherever this plan says "TO BE DETERMINED IN THIS VERSION", treat that
  as a real V0/V1 deliverable: the choice must be made and written down,
  not deferred indefinitely.
- Stubs are acceptable only when they preserve the real contract end-to-end.
- Smoke tests cumulate. A V3 change that breaks V2's cross-user demo is a
  stop-the-room bug.
- Feature freeze at h28. After that: only demo data, bug fixes, fallbacks,
  and polish.

## 10. Immediate next decisions

1. Storage backend (graph vs Postgres+pgvector vs hybrid).
2. Local-runner runtime (Claude Agent SDK vs alternative).
3. Hosting target for the shared server.
4. On-demand agent runtime: stateless inlined-context LLM call vs
   sub-agent process.
5. The two seeded users and the deliberately non-overlapping context for
   each, plus the demo prompt that forces a cross-user query.
6. Lane assignments — the prior plan's role split (Narf/Sarf/Jorf/Jerf/
   Marf) was written for a different product and should be re-mapped
   against this plan's components: server, local app, on-demand agent,
   eval, UI.
