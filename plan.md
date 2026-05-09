# Relevo Hackathon Plan - Claude Agent Project Dashboard

## 0. Product Thesis

Relevo gives Claude-powered local coding agents shared project memory,
coordination, and teammate context through a project dashboard.

For the hackathon, Relevo is not trying to support every coding agent or every
terminal workflow. The live path is:

```text
Relevo UI
  -> local Relevo server/runner
  -> Claude Agent SDK
  -> disposable local worktree
  -> Relevo database, event stream, dashboard, and context retrieval
```

The dashboard is for humans. It shows the project, people, tasks, claims,
agent runs, memories, artifacts, and timeline. The Relevo tool layer is for the
running agent. It lets the agent ask what the project knows, what another user
or agent has been doing, and what work is safe to claim.

The core demo loop is:

```text
User 1 has a prior progress session stored in Relevo
  -> User 2 opens the Relevo project dashboard
  -> User 2 prompts their agent from Relevo UI
  -> Relevo starts a local Claude Agent SDK run in a disposable worktree
  -> the agent asks Relevo what User 1 did
  -> Relevo returns cited project/User 1 context
  -> the agent claims work, edits or proposes an artifact, and publishes progress
  -> Relevo stores raw events, derived memory, tasks, claims, artifacts, and timeline
  -> the dashboard can answer what happened, who owns what, and why
```

Every version after V0 must advance that loop. If live Claude Agent SDK work
stalls during the demo, Relevo must replay deterministic fallback events through
the same run/event/artifact contract.

## 1. Hackathon Scope

In scope:

- Relevo UI as the project dashboard and prompt surface.
- A local Relevo server/runner that can launch Claude Agent SDK.
- One seeded project with multiple users and personal worker agents.
- Seeded User 1 prior context from an earlier progress session.
- One live User 2 Claude Agent SDK run in a disposable worktree.
- Human project-context queries from the dashboard.
- Agent self-query through Relevo tools during a run.
- Durable tasks, claims, raw run events, artifacts, memories, and timeline.

Out of scope:

- Passive ingestion from arbitrary local coding agents.
- Claude Code terminal hooks as the primary demo path.
- Codex/Cursor/GitHub Copilot integration.
- Real multi-laptop sync as a required demo dependency.
- Editing the actual Relevo repo during the live agent demo.

Use a disposable demo repo or disposable git worktree for live code changes.
The main Relevo checkout must not be the agent's live-edit target.

## 2. Product Model

Important concept: a `project` is the dashboard tab and collaboration boundary.
If the database uses `workspace` internally, treat one workspace row as one
project for the hackathon. Do not add a separate workspace-above-project model.

Core objects:

| Object | Purpose |
|---|---|
| `person` | Human teammate using the dashboard. |
| `worker_agent` | The personal coding agent identity associated with one person. |
| `project` | One tracked software project. |
| `project_member` | A person plus their worker agent inside one project. |
| `project_rule` | Project convention or safety rule the agent must follow. |
| `task` | Durable unit of project work with status, owner, and acceptance criteria. |
| `work_claim` | Temporary or durable claim on a task, file, module, or concern. |
| `agent_run` | One seeded, fallback, or live Claude Agent SDK work session. |
| `agent_event` | Raw ordered event from a run: prompt, message, tool call, file change, command, result, or error. |
| `agent_message` | Human-visible message from agent to person, agent to agent, or agent to project. |
| `artifact` | Work product from a run: patch, diff, summary, test result, review, or status report. |
| `memory_entry` | Derived durable knowledge from seeded context, run summaries, decisions, progress, or blockers. |
| `source_ref` | Citation pointer back to a raw event, artifact, memory, task, or timeline event. |
| `memory_edge` | Lightweight relationship between memory, tasks, files, agents, and artifacts. |
| `timeline_event` | Chronological project history derived from tasks, claims, messages, artifacts, memories, and approvals. |

`agent_event` is the raw audit log. `memory_entry` is the queryable project
knowledge extracted from that log. Do not rely on raw transcript stuffing for
normal context bringup.

## 3. Memory And Context

Canonical memory is append-only for the hackathon. Corrections or changed facts
create new entries that supersede old entries. Raw events are also append-only.

Memory layers:

- `worker_agent`: reusable preferences and habits for a person's agent.
- `project`: shared project facts, decisions, rules, architecture, risks, and
  current state.
- `project_agent`: what one worker agent has learned or done inside one project.

Suggested memory entry shape:

```json
{
  "id": "uuid",
  "layer": "worker_agent|project|project_agent",
  "project_id": "uuid|null",
  "agent_id": "uuid|null",
  "person_id": "uuid|null",
  "task_id": "uuid|null",
  "run_id": "uuid|null",
  "content": "string",
  "kind": "fact|decision|rule|progress|blocker|handoff|artifact_summary|session_summary",
  "tags": ["api-key", "settings", "security"],
  "subjects": ["files/settings", "api-key-storage"],
  "source_refs": [
    {"type": "agent_event|artifact|task|timeline_event|manual_seed", "id": "uuid"}
  ],
  "supersedes": ["memory_id"],
  "created_at": "timestamp"
}
```

Context bringup:

1. Start from the current project, member, worker agent, task, active claims,
   prompt, and recent run events.
2. Retrieve relevant project, worker-agent, and project-agent memory.
3. Include current project rules and active claims before general memory.
4. Expand one hop through `memory_edge` for related files, tasks, decisions,
   artifacts, and superseding facts.
5. Return compact cited context to the human query or to the running agent tool.

Both humans and agents can query context:

- humans use the Relevo dashboard query UI;
- the live Claude Agent SDK run uses Relevo agent tools during work.

## 4. Runtime Architecture

For the hackathon, run everything on one laptop unless the team chooses to add a
remote deploy for health checks or backup data.

```text
Desktop/Web UI
  calls local FastAPI server over HTTP/SSE

Local FastAPI server
  owns API, persistence, retrieval, SSE, and run orchestration

Runner module
  starts Claude Agent SDK with cwd set to a disposable worktree
  configures allowed file/command/edit tools
  exposes Relevo context tools to the agent
  streams SDK messages and tool activity into agent_event rows

Disposable worktree
  contains the small demo codebase the live agent can edit safely
```

The server can later be deployed, but the live coding runner needs local file
access. For the hackathon, keep the runner local and make the UI talk to that
local server.

Claude Agent SDK is the live runtime because it can run a coding agent from an
app, use a working directory, call file/edit/command tools, stream output, and
call custom/MCP-style tools exposed by Relevo.

## 5. Agent Context Tools

Expose these tools to the live Claude Agent SDK run. They are product-level
contracts; implementation can be direct Python functions or MCP tools,
whichever is fastest.

```text
query_project_context(question, task_id?)
  -> cited context from project rules, tasks, memories, artifacts, claims, and timeline

query_teammate_context(person_id?, agent_id?, question)
  -> cited context about another user's prior work and run summaries

claim_work(task_id, files_or_areas, reason)
  -> creates work_claim or returns claim_conflict

publish_progress(task_id, summary, files_changed?, blockers?)
  -> appends agent_message, memory_entry, and timeline_event

append_memory(layer, content, tags?, subjects?, source_refs?)
  -> appends worker_agent, project, or project_agent memory

report_blocker(task_id, reason, needs_context_from?)
  -> marks the run/task blocked and emits timeline_event
```

Tool rules:

- Every context response must include source refs.
- The agent must call `query_teammate_context` before making claims about User
  1's prior work.
- The agent must call `claim_work` before editing or producing an artifact for a
  specific file/module/task.
- The agent must call `publish_progress` or `report_blocker` before the run
  finishes.

## 6. API Surface

Use `/api/v1/projects` in product-facing contracts. Keep `/workspaces` only as
an internal alias if needed for speed.

Human/dashboard endpoints:

```text
GET    /api/v1/health

GET    /api/v1/projects
GET    /api/v1/projects/{project_id}
GET    /api/v1/projects/{project_id}/members
GET    /api/v1/projects/{project_id}/rules
GET    /api/v1/projects/{project_id}/tasks
POST   /api/v1/projects/{project_id}/tasks
PATCH  /api/v1/tasks/{task_id}

GET    /api/v1/projects/{project_id}/timeline?cursor=&limit=
GET    /api/v1/projects/{project_id}/context?query=&member_id=&task_id=

POST   /api/v1/projects/{project_id}/prompt
       body: { member_id, prompt, target_task_id? }
       starts a local Claude Agent SDK run when live mode is enabled

GET    /api/v1/runs/{run_id}
GET    /api/v1/runs/{run_id}/events
GET    /api/v1/runs/{run_id}/messages
GET    /api/v1/runs/{run_id}/artifacts

GET    /api/v1/memory/{memory_id}
```

Runner/internal endpoints:

```text
POST   /api/v1/runs/{run_id}/events
POST   /api/v1/runs/{run_id}/messages
POST   /api/v1/runs/{run_id}/artifacts
POST   /api/v1/runs/{run_id}/summarize

POST   /api/v1/tasks/{task_id}/claims
DELETE /api/v1/claims/{claim_id}

POST   /api/v1/projects/{project_id}/memory
POST   /api/v1/projects/{project_id}/agents/{agent_id}/memory
POST   /api/v1/worker-agents/{agent_id}/memory
```

Primary SSE events:

```text
project_selected
context_retrieved
run_started
agent_started
agent_event_received
agent_message
tool_call
claim_created
claim_conflict
file_change
command_result
artifact_created
memory_appended
task_created
task_updated
timeline_event
run_done
run_failed
```

Hackathon auth stays simple: use a header such as
`X-Project-Member: <member_id>`.

## 7. Version Plan

### V0 - Contracts And Scaffold (h0-h4)

V0 proves the repo, local API, dashboard shell, seed files, and contracts exist.

| Lane | Concrete deliverables |
|---|---|
| Narf | FastAPI app runs locally. `/health` returns status, sha, model versions, and live/fallback mode. Stub endpoints for projects, context, prompt, runs, and events. |
| Sarf | Initial schema covers projects, members, worker agents, rules, tasks, runs, raw events, memories, claims, artifacts, and timeline. Seed loader skeleton exists. |
| Jorf | Agent run contract, agent context tool contract, and prompt skeleton for Claude Agent SDK. |
| Jerf | Eval harness with fixture prompts for context retrieval, teammate context, and claim overlap. |
| Marf | Dashboard shell shows project, people/agents, tasks, timeline, memories, and a prompt box using fixtures. |

Converge h4:

- Local server boots.
- Dashboard boots.
- Seeded project appears.
- User 1 seeded memory appears.
- Context query fixture returns cited memory.

### V1 - Seeded Project Context Dashboard (h4-h10)

Working product at V1: a teammate can open the dashboard, inspect seeded User 1
work, ask what happened, and see cited project context from persisted data.

| Lane | Concrete deliverables |
|---|---|
| Narf | Implement project, member, task, memory, run, event, timeline, and context endpoints against the local database or deterministic in-memory store. |
| Sarf | Seed one project, three members, three worker agents, User 1 prior session events, tasks, memory entries, project rules, and timeline. |
| Jorf | Context-answer prompt: answer human questions from retrieved memory/source refs. Stub and live LLM paths share the same response shape. |
| Jerf | Retrieval/eval cases prove User 1 context is returned for API-key/settings questions. |
| Marf | Dashboard query UI renders cited answers, User 1 prior run summary, tasks, memory source drawer, and timeline. |

Converge h10 smoke:

1. Open Relevo dashboard.
2. Show User 1's prior session, task, memory, and timeline.
3. Ask: "What did User 1 do on API keys?"
4. Relevo answers from seeded User 1 memory with source refs.
5. Refresh and confirm the same project state persists.

### V2 - Live Claude Agent SDK Run (h10-h18)

Working product at V2: User 2 starts a live agent run from Relevo UI. Claude
Agent SDK runs locally in a disposable worktree, streams events, and produces
an artifact or progress report.

| Lane | Concrete deliverables |
|---|---|
| Narf | Local runner starts Claude Agent SDK with `cwd` set to disposable worktree. `POST /prompt` creates `agent_run`, streams SSE events, records raw `agent_event` rows, and handles fallback replay. |
| Sarf | Store run status, raw events, messages, artifacts, summaries, and source refs. Seed or create the disposable demo worktree. |
| Jorf | Claude Agent SDK system prompt and tool instructions for safe local work: read context, claim work, produce artifact, publish progress. |
| Jerf | Eval verifies live/fallback run selects the right task/member context and emits required events in order. |
| Marf | Run detail panel shows live stream, agent messages, tool calls, artifact/diff, status, and fallback indicator. |

Converge h18 smoke:

1. User 2 prompts: "Check the API-key settings work and add the missing validation."
2. Relevo starts a live or fallback Claude Agent SDK run in a disposable worktree.
3. Dashboard streams run events.
4. The run produces an artifact or progress report.
5. The artifact and raw events are visible after refresh.

### V3 - Agent Self-Query And Coordination (h18-h28)

Working product at V3: the live agent uses Relevo tools during the run to query
User 1 context, claim work, publish progress, and leave memory for the next
teammate or agent.

| Lane | Concrete deliverables |
|---|---|
| Narf | Agent-callable tools are wired to retrieval, claims, memory append, progress publishing, and blocker reporting. Tool calls are streamed and stored. |
| Sarf | Claims, memory appends, event source refs, and timeline updates are transactional enough for the demo. |
| Jorf | Agent prompt requires querying teammate context before claims about User 1 work, claiming before edits/artifacts, and publishing progress before completion. |
| Jerf | Overlap detector flags prompts that touch seeded User 1 tasks or active claims. Eval covers teammate-context and claim-conflict cases. |
| Marf | Dashboard highlights agent self-query, cited teammate context, claims, progress updates, artifacts, and timeline in one flow. |

Converge h28 smoke:

1. User 2 starts the API-key validation run.
2. The agent calls `query_teammate_context` for User 1's prior API-key work.
3. Relevo returns cited context.
4. The agent calls `claim_work` for validation files/area.
5. The agent produces an artifact and calls `publish_progress`.
6. Dashboard shows task status, claim, artifact, memory, and timeline after refresh.

### V4 - Demo Hardening (h28-h36)

Working product at V4: the single-laptop demo is reliable, readable, and has a
fallback path that proves the same product contract even if live Claude SDK work
times out.

| Lane | Concrete deliverables |
|---|---|
| Narf | Timeouts, graceful run failure, fallback replay, clear live/fallback state, and deploy/local startup verification. |
| Sarf | Final seeds and `seeds/LOCK.md` documenting project, members, rules, User 1 prior session, tasks, memories, artifacts, claims, and demo questions. |
| Jorf | Demo-safe fallback events for exact prompts and compact final-answer prompt for "what happened?" questions. |
| Jerf | Final eval pass on exact demo prompts plus two unscripted-style context questions. |
| Marf | Demo mode, readable activity stream, source drawer, artifact view, empty/loading/error states, and no layout breaks on projector dimensions. |
| All | h28-h30 dataset jam. h30-h32 integration hardening. h32-h34 rehearsal. h34-h36 buffer/submission. |

Converge h36 smoke:

- Start from a clean local launch.
- Show seeded User 1 context.
- Run or replay User 2 Claude Agent SDK flow.
- Ask: "What did User 1 do, what did User 2 change, and what remains?"
- Answer cites User 1 memory, User 2 run events/artifact, task state, and timeline.

## 8. Demo Narrative

Primary demo: one laptop, one Relevo dashboard, one seeded prior session, and
one live or fallback-backed Claude Agent SDK run.

1. Open the Relevo project dashboard.
2. Show members and worker agents: User 1, User 2, and reviewer/security owner.
3. Show project rules: cite memory, protect API keys, claim work before edits,
   use disposable worktree, publish progress.
4. Show User 1's prior session: task, memory summary, artifact, and timeline.
5. User 2 prompts their agent from Relevo UI:
   "Check what happened with API keys and add the missing validation."
6. Relevo starts Claude Agent SDK locally in a disposable worktree.
7. The agent asks Relevo what User 1 did.
8. Relevo returns cited project/User 1 context.
9. The agent claims validation work, produces patch/artifact, and publishes progress.
10. Dashboard shows run stream, context query, claim, artifact, task update,
    memory append, and timeline.
11. Human asks:
    "What did User 1 do, what did User 2 change, and what remains?"
12. Relevo answers with citations to User 1 memory, User 2 run events/artifact,
    task state, and timeline.

## 9. Build Discipline

- The hackathon product is Relevo UI plus local Claude Agent SDK runner.
- Do not build generic Codex/Cursor/Claude Code terminal support for the MVP.
- The live agent edits a disposable worktree, not the Relevo repo checkout.
- Store raw run events and derived memory; use retrieval for context bringup.
- Every important answer must cite memory, event, artifact, task, or timeline
  source refs.
- Every live run should show coordination: context retrieved, work claimed,
  progress published, artifact created, and timeline updated.
- Stubs and fallbacks are acceptable only when they preserve the real contract.
- Smoke tests cumulate. A V3 change that breaks V1 context questions or V2 run
  replay is a stop-the-room bug.
- Feature freeze at h28. After that, only demo data, bug fixes, fallbacks, and
  polish.

## 10. Immediate Next Decisions

1. Confirm the disposable demo repo/worktree content.
2. Choose the exact User 1 seeded prior session.
3. Choose the exact User 2 live prompt.
4. Decide whether agent context tools are implemented as direct SDK tools or MCP
   tools; pick the fastest path for the current SDK/runtime.
5. Pick the final project rules shown in the demo.
6. Choose the exact fallback event script for the live run.
