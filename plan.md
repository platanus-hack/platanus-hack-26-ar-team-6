# Relevo Hackathon Plan — Project Agent Workspace MVP

## 0. Product thesis

Relevo is a multi-project workspace for teams whose members each have a
personal coding agent.

The app is organized as project tabs. Each project tab is one workspace: it has
people, each person has their own agent for that project, and those agents do
the real work. The people prompt their agents; the app makes the agents'
coordination visible and durable.

For each project, Relevo helps the team:

- see who is in the project and which agent belongs to each person;
- prompt a personal agent to plan, code, review, or check status;
- let agents communicate with each other in real time;
- track what is being worked on, what is done, and what is blocked;
- prevent agents from overstepping another person's task or files;
- enforce project rules, conventions, and current decisions;
- preserve overall worker-agent memory that travels with a person's agent;
- preserve project memory shared by everyone in the project tab;
- preserve project-agent task memory scoped to one worker agent's work in that project;
- continue project development across many agent runs instead of losing context
  when a chat ends.

For the hackathon, the domain is software engineering. Every agent is primarily
a coder for its person, with planner/reviewer behaviors layered on top when the
project needs coordination.

The core demo loop is:

```text
Person opens a project tab
  -> prompts their own agent
  -> agent checks project rules, task ownership, and retrieved memory
  -> agent claims or updates work
  -> agent communicates with other agents if the task overlaps
  -> agent produces progress, a plan, a review, or an artifact
  -> memory, task state, and timeline append new records
  -> everyone else sees the new project state in real time
```

Every version after V0 must be a working MVP of that loop, not a collection of
independent subsystem milestones.

## 1. Version rule

Each version must answer four questions before it is considered done:

1. What can a teammate do in a running project tab?
2. What task, message, artifact, rule check, timeline event, or memory persists?
3. Which agent behavior is real, stubbed, or fallback-backed?
4. What smoke test proves the previous versions still work?

Every version has tasks for all five lanes:

| Lane | Responsibility |
|---|---|
| Narf | API, deploy, SSE, run lifecycle, real-time project state |
| Sarf | Data model, worker/project/task memory, retrieval, seeds |
| Jorf | Personal agent prompts, project-rule following, handoffs, synthesis |
| Jerf | Routing, overlap detection, eval harness, assignment quality |
| Marf | Project-tab UI, people/agent roster, live progress surface |

If one lane is blocked, that lane ships a deterministic stub with the same
contract so the version can still converge.

## 2. Product model

Important concept: in product language, `project` is the main object. If the
existing database uses `workspace`, treat one `workspace` row as one project tab.
Do not build a separate workspace-above-project hierarchy for the hackathon.

Important product objects:

- `person`: a human teammate who prompts and supervises a personal agent.
- `worker_agent`: the personal agent identity owned by one person. It can carry
  memory across project tabs.
- `project`: one project tab/workspace, such as "Relevo" or a seeded demo app.
- `project_member`: a person plus their worker agent inside one project.
- `project_rule`: conventions and boundaries every agent must follow.
- `task`: durable unit of project work with status, owner, dependencies, and
  optionally claimed files/areas.
- `work_claim`: an agent's temporary or durable claim on a task, file, module,
  or concern so other agents know not to collide.
- `agent_run`: one execution started by a person's prompt or by an agent handoff.
- `agent_message`: agent-to-agent or agent-to-person communication during a run.
- `artifact`: work product from a run, such as a plan, diff, patch, review,
  test result, or status report.
- `memory_entry`: append-only knowledge tagged by memory layer and source.
- `memory_edge`: a derived or explicit relationship between memory entries,
  tasks, files, rules, agents, and artifacts.
- `timeline_event`: chronological project history derived from tasks, claims,
  agent messages, artifacts, memory appends, and approvals.

## 3. Memory architecture

Canonical memory is append-only for the hackathon. Agents do not edit or delete
old memories. If a fact changes, append a new memory that supersedes or corrects
the older one. Indexes, embeddings, summaries, and graph edges can be rebuilt
from the append-only log.

Memory has three layers:

- `worker_agent`: overall memory for a person's agent across all projects. This
  includes owner preferences, coding style, reusable knowledge, tools it knows,
  long-lived strengths/weaknesses, and cross-project lessons.
- `project`: shared memory for one project tab. This includes product brief,
  architecture, rules, decisions, runbooks, known risks, current truths, and
  "what is done."
- `project_agent`: memory for one worker agent inside one project. This includes
  assigned tasks, active context, implementation notes, handoffs, blockers,
  prior run summaries, claimed areas, and what that agent should remember next
  time it works on the project.

Timeline remains factual history rather than a fourth editable memory layer:
who/which agent did what, when, and why it changed project state. Timeline
events can be retrieved as context, but they are generated from tasks, claims,
messages, artifacts, approvals, and memory appends.

Suggested memory entry shape:

```json
{
  "id": "uuid",
  "layer": "worker_agent|project|project_agent",
  "project_id": "uuid|null",
  "agent_id": "uuid|null",
  "task_id": "uuid|null",
  "content": "string",
  "kind": "fact|decision|rule|preference|progress|blocker|handoff|artifact_summary",
  "source": {
    "type": "prompt|agent_message|artifact|review|manual|timeline",
    "id": "uuid|null"
  },
  "tags": ["string"],
  "subjects": ["settings", "api-key", "security"],
  "valid_from": "timestamp",
  "supersedes": ["memory_id"],
  "created_at": "timestamp"
}
```

Graph shape: do not start with a graph database. Store memory in Postgres and
add a small `memory_edge` table for graph-like retrieval. Useful edge types:
`supersedes`, `supports`, `contradicts`, `belongs_to_task`, `about_file`,
`mentions_agent`, `handoff_to`, `caused_by`, `depends_on`, `conflicts_with`.

Context bringup should use retrieval, not manual stuffing:

1. Build a query from the prompt, selected project, current member/agent, task,
   active claims, and recent messages.
2. Retrieve top candidates from all three memory layers using keyword + vector
   search, filtered by project/agent/task scope.
3. Expand one hop through `memory_edge` for closely related decisions, claims,
   files, and superseding facts.
4. Rerank and budget the context by importance: project rules and active claims
   first, then task-specific memory, then project memory, then worker-agent
   global memory.
5. Pass citations into the agent run and require any project-changing claim to
   cite the memory/rule/task it relied on.

The old `pool` tier maps to project memory. If keeping the existing enum is
faster, use `pool` internally in V0/V1 and label it "Project Memory" in the UI.

## 4. API surface

Use `/api/v1/projects` in the product contract. If the existing code already
has `/workspaces`, keep it as an alias or internal naming shortcut, but the app
copy should say project.

```text
GET    /health

POST   /projects
GET    /projects
GET    /projects/{id}
GET    /projects/{id}/members
GET    /projects/{id}/agents
GET    /projects/{id}/rules
POST   /projects/{id}/rules

GET    /projects/{id}/tasks
POST   /projects/{id}/tasks
PATCH  /tasks/{id}
POST   /tasks/{id}/claim
DELETE /claims/{id}

POST   /worker-agents/{id}/memory                 # worker-agent memory
POST   /projects/{id}/memory                      # project memory
POST   /projects/{id}/agents/{agent_id}/memory    # project-agent memory
GET    /memory/{id}
GET    /projects/{id}/memory/graph?seed_id=
GET    /projects/{id}/timeline?cursor=

POST   /projects/{id}/prompt
  body: { member_id, prompt, target_agent_id?, target_task_id? }
  creates an agent_run for that member's agent unless target_agent_id is set

GET    /runs/{id}
GET    /runs/{id}/messages
GET    /runs/{id}/artifacts

POST   /runs/{id}/message                 # agent/person message into a run
POST   /runs/{id}/approve-artifact
POST   /runs/{id}/stage-as-task
```

Primary SSE events:

```text
project_selected
routing_decision
rule_check
claim_created
claim_conflict
task_created
task_updated
agent_started
agent_message
memory_used
artifact_created
review_requested
review_result
timeline_event
run_done
run_failed
```

Hackathon auth stays simple: a single header such as
`X-Project-Member: <member_id>`.

## 5. Coordination contract

This is the product's center of gravity. Agents are useful because they work,
but Relevo is useful because it keeps multiple agents from turning a group
project into chaos.

Every agent run must receive:

- the current project rules;
- the task backlog and current statuses;
- active work claims by other agents;
- relevant worker-agent memory for that personal agent;
- relevant project memory;
- relevant project-agent memory for that agent in this project;
- recent timeline events;
- any direct messages from other agents.

Before producing an artifact, an agent should:

1. say what task or project area it is acting on;
2. check whether another agent already owns or claims that area;
3. ask or notify the other agent when work overlaps;
4. cite the project rule or memory it is following;
5. append what changed, what remains, and what future agents should know.

For V1/V2 this can be deterministic and schema-driven. For V3 it becomes the
visible multi-agent coordination demo.

## 6. Version plan

### V0 — Contracts and scaffold (h0-h4)

V0 proves that the repo, deploy, contracts, seeds, eval harness, and desktop
shell exist.

| Lane | Concrete deliverables |
|---|---|
| Narf | FastAPI app deployed. `/health` returns status, sha, and model versions. Railway URL posted. |
| Sarf | Initial migration merged. Local Postgres/pgvector compose works. Seed loader skeleton exists. |
| Jorf | Personal-agent contract and `agent_system.md` v1. One complete seeded project member + agent. |
| Jerf | Router eval harness with 20 cases and a deliberately failing stub router. |
| Marf | Electron shell boots, shows project tabs, people/agents, task fixture data, and hits `/health`. |

Converge h4:

- App boots.
- Backend is reachable.
- Migration applies locally.
- Eval harness runs.
- Everyone can develop from the same contracts.

### V1 — Project tab command center MVP (h4-h10)

Working product at V1: a teammate opens a project tab, sees people and their
agents, prompts their own agent, and watches the prompt become a durable task,
run, agent message, timeline event, and project memory entry. The agent may
still return a structured stub, but the project loop is real.

| Lane | Concrete deliverables |
|---|---|
| Narf | Design and implement the full V1 endpoint contract below. `POST /projects/{id}/prompt` creates `agent_run`, emits SSE, and writes task/run/message/timeline records. Deterministic fallback response if agent runtime is unavailable. |
| Sarf | Persist `person`, `worker_agent`, `project`, `project_member`, `project_rule`, `task`, `agent_run`, `agent_message`, `memory_entry`, and `timeline_event`. Seed one project, three members, and three personal agents. |
| Jorf | Prompt-to-task contract: from a member prompt produce `{title, description, acceptance_criteria, suggested_owner_agent, project_memory_to_append, project_agent_memory_to_append}`. Stub and LLM paths share the same schema. |
| Jerf | Router v1 selects the prompting member's agent by default and can suggest another agent when the prompt clearly belongs to someone else's domain. Eval covers at least 20 project prompts. |
| Marf | Project-tab UI: tab list, selected project header, member/agent roster, prompt box scoped to current member, task list, run stream, and timeline feed. |

V1 Narf endpoint design:

```text
GET /api/v1/projects
  -> { projects: [{id, name, description, status, updated_at}] }
  Used by Marf to render project tabs.

GET /api/v1/projects/{project_id}
  -> { id, name, description, status, created_at, updated_at,
       counts: {members, agents, open_tasks, timeline_events} }
  Used by the selected project header.

GET /api/v1/projects/{project_id}/members
  -> { members: [{id, display_name, role, agent: {id, name, status, summary}}] }
  This is the V1 people/agent roster. One member has one personal agent.

GET /api/v1/projects/{project_id}/rules
  -> { rules: [{id, title, content, severity, created_at}] }
  Read-only in V1 unless Sarf finishes rule writes early.

GET /api/v1/projects/{project_id}/tasks?status=&owner_agent_id=
  -> { tasks: [{id, title, description, status, owner_agent_id,
                acceptance_criteria, created_at, updated_at}] }

POST /api/v1/projects/{project_id}/tasks
  body: { title, description?, owner_agent_id?, acceptance_criteria? }
  -> Task
  Appends timeline_event: task_created.

PATCH /api/v1/tasks/{task_id}
  body: { title?, description?, status?, owner_agent_id?,
          acceptance_criteria? }
  -> Task
  Appends timeline_event: task_updated.

GET /api/v1/projects/{project_id}/timeline?cursor=&limit=
  -> { events: [{id, event_type, actor_agent_id, subject_type, subject_id,
                 payload, occurred_at}], next_cursor }

POST /api/v1/projects/{project_id}/memory
  body: { content, kind, tags?, subjects?, source? }
  -> MemoryEntry(layer="project")
  Appends timeline_event: memory_appended.

POST /api/v1/projects/{project_id}/agents/{agent_id}/memory
  body: { content, kind, task_id?, tags?, subjects?, source? }
  -> MemoryEntry(layer="project_agent")
  Appends timeline_event: memory_appended.

GET /api/v1/memory/{memory_id}
  -> MemoryEntry

POST /api/v1/projects/{project_id}/prompt
  headers: X-Project-Member: <member_id>
  body: { prompt, target_agent_id?, target_task_id? }
  -> text/event-stream
  Creates an agent_run for the member's agent unless target_agent_id is set.
  V1 events, in order when possible:
    routing_decision {run_id, selected_agent_id, rationale}
    task_created {task}
    agent_started {run_id, agent_id}
    agent_message {message}
    memory_used {memory_ids}
    timeline_event {event}
    run_done {run_id, task_id}
    run_failed {run_id, error_code, message}

GET /api/v1/runs/{run_id}
  -> { id, project_id, prompt, status, started_by_member_id,
       primary_agent_id, task_id, created_at, completed_at }

GET /api/v1/runs/{run_id}/messages
  -> { messages: [{id, run_id, from_agent_id, to_agent_id,
                   audience, content, created_at}] }
```

V1 deliberately excludes claims, artifacts, memory graph expansion, and
approval endpoints. Those start in V2, but the V1 response shapes should leave
room for those IDs to appear later without breaking Marf.

Converge h10 smoke:

1. Open the seeded project tab.
2. Select a member and prompt their agent: "Add a settings page where users can
   update their API key."
3. App creates a task, starts that member's agent run, streams an agent message,
   and appends one timeline event plus one project memory entry.
4. Refresh the app and the task/run/message/memory are still there.

Parallelism goal:

- Frontend can build against project/member/agent fixtures while API lands.
- Router can run against seeded member-agent summaries before real LLM routing.
- Agent prompt can be validated with stored fixture prompts.

### V2 — Single-agent progress and boundaries MVP (h10-h18)

Working product at V2: one member's agent performs a small SWE task while
respecting project rules, current task ownership, and relevant memory. It
returns progress or an artifact and stores what future agents need to know.

| Lane | Concrete deliverables |
|---|---|
| Narf | Run lifecycle states: `queued`, `checking_rules`, `running`, `artifact_ready`, `review`, `done`, `blocked`, `failed`. Endpoints for run details, messages, artifacts, approval, and task/file claims. |
| Sarf | Retrieval API returns worker-agent + project + project-agent memory for a run, plus relevant timeline events. Store work claims, artifacts, memory citations, and rule-check results. Add seeds for project rules and a tiny target codebase/task history. |
| Jorf | Coder agent v1: reads task, project rules, active claims, and retrieved memory; produces structured artifact JSON with summary, files_changed, patch_or_content, tests_to_run, rule_checks, and memory appends. |
| Jerf | Eval checks whether prompts choose the right personal agent, identify overlaps, and select the right memory scopes. Add retrieval cases where expected memory appears in top-k. |
| Marf | Run detail panel with live states, rule checks, active claims, memory citations, artifact/diff viewer, approve button, and blocked/conflict state. |

Converge h18 smoke:

1. A member prompts their agent for a small code change.
2. The agent checks project rules and active claims.
3. The agent creates a claim, retrieves at least one relevant project memory,
   emits an artifact or progress report, and appends project-agent memory.
4. Approving the artifact updates task state and timeline.
5. A follow-up prompt can cite the previous run from memory.

Parallelism goal:

- Jorf can ship coder output against static rule/memory/claim fixtures.
- Sarf can ship retrieval and claims against static prompts.
- Marf can render artifact and conflict fixtures before live runs are wired.

### V3 — Multi-agent communication MVP (h18-h28)

Working product at V3: multiple people have agents working in the same project.
When work overlaps, the agents can see each other's progress, communicate, avoid
overstepping, and produce a shared project update.

| Lane | Concrete deliverables |
|---|---|
| Narf | Multi-agent run orchestration and real-time project stream. Supports agent-to-agent messages, chain/fanout runs, claim conflicts, and handoff messages in one project timeline. |
| Sarf | Worker-agent memory, project memory, and project-agent memory are fully separated. Timeline automatically records task state changes, claims, agent messages, artifacts, approvals, and conflicts. Add `memory_edge` indexing for graph-like context expansion. |
| Jorf | Personal agent prompts for planning, coding, reviewing, and coordination. Handoff format: concern -> message/claim -> response -> artifact/review -> memory update. Synthesis prompt produces project-facing update. |
| Jerf | Router v2 supports default-to-my-agent, ask-another-agent, chain, and fanout modes. Overlap detector flags prompts that touch another agent's active claim. Eval expands to 30 cases with precision >= 0.80 and recall >= 0.85. |
| Marf | Live agent communication view: project activity stream, routing visualizer, active claims board, per-agent messages, synthesis panel, and "stage follow-up task" action. |

Converge h28 smoke:

1. Member A's agent is working on API-key settings and claims the settings files.
2. Member B prompts their agent: "Update API-key storage and make sure we do
   not leak secrets."
3. Router detects overlap and surfaces Member A's agent/claim.
4. Agents exchange visible messages instead of silently duplicating work.
5. Reviewer or second agent creates a comment, approval, or follow-up task.
6. Worker-agent memory, project memory, project-agent memories, claims, task
   state, and timeline show what happened after refresh.

Parallelism goal:

- Prompt/handoff schemas can be developed independently from orchestration.
- UI can use fixture event streams while backend orchestration lands.
- Eval can advance independently from the actual LLM runtime.

### V4 — Demo-ready continuous project MVP (h28-h36)

Working product at V4: the app survives demo conditions and tells a coherent
story about a group project where each person has an agent. It has one scripted
software project, one real or fallback-backed agent work loop, and enough
worker/project/task memory to answer "what happened, who owns it, and why?"
questions.

| Lane | Concrete deliverables |
|---|---|
| Narf | Stability sweep: retries, timeouts, graceful run failure, deploy verification, backup fallback endpoint/data. |
| Sarf | Final seed dataset and DB snapshot. `seeds/LOCK.md` documents demo project, members, agents, rules, three-layer memories, graph edges, tasks, claims, runs, and which prompts hit them. |
| Jorf | Demo-safe fallbacks for 4-5 exact prompts. Live path preferred; fallback plays the same SSE/artifact/message contract if live agent stalls. |
| Jerf | Final eval pass on exact demo prompts and two unscripted-style coordination prompts. Commit report. |
| Marf | Demo mode, visual polish, empty/loading/error states, readable live project activity, and no layout breaks on projector dimensions. |
| All | h28-h30 dataset jam. h30-h32 integration hardening. h32-h34 rehearse. h34-h36 buffer/submission. |

Converge h36 smoke:

- Run the scripted demo from a clean app launch.
- Switch between project tabs or show the selected project tab clearly.
- Ask one follow-up question that depends on previous worker-agent, project, and
  project-agent memory.
- Show people, personal agents, active tasks, claims, messages, timeline, and
  memory source.
- Use fallback only if the live run exceeds the timeout.

## 7. Demo narrative

Primary demo: a small software project with multiple people, where each person
has a personal coding agent inside the project tab.

Suggested flow:

1. Open the "Relevo Demo App" project tab.
2. Show people and their agents: frontend owner, backend owner, security/review
   owner.
3. Show project rules: do not touch claimed files, cite memory, protect API
   keys, update task state after work.
4. Member A prompts their agent to add API-key settings.
5. Agent A claims the relevant task/files and starts work.
6. Member B prompts their agent about API-key storage/security.
7. Agent B sees Agent A's claim, messages Agent A, reviews the risk, and avoids
   overwriting the same work.
8. The app shows live messages, task progress, artifact/review, and timeline.
9. A teammate asks: "What has been done on API keys, who owns the remaining
   work, and why are we storing it this way?"
10. The app answers from project memory, Agent A's project-agent memory, Agent
    B's project-agent memory, relevant worker-agent memory, and the timeline,
    with citations.

Optional closer: use the team's own hackathon project as a second tab. If we
dogfood during converges, the app can answer how we built Relevo and what each
person's agent worked on.

## 8. Build discipline

- A workspace is a project tab. Keep that mental model everywhere.
- Each project has people; each person has one personal agent in that project.
- Memory is append-only. Corrections and changed decisions create new memories
  that supersede old ones.
- Worker-agent memory travels with the personal agent across projects.
- Project memory is shared by everyone in the project tab.
- Project-agent memory is scoped to one worker agent's work inside one project.
- Retrieval, not raw transcript stuffing, is the context bringup mechanism.
- Graph edges are an index over memory, not the canonical source of truth.
- Every run should make coordination visible: rules checked, ownership/claims,
  memory used, messages sent, artifact produced, and state changed.
- Stubs are acceptable only when they preserve the real contract.
- Smoke tests cumulate. A V3 change that breaks the V1 project prompt loop is a
  stop-the-room bug.
- Feature freeze at h28. After that, only demo data, bug fixes, fallbacks, and
  polish.

## 9. Immediate next decisions

1. Confirm codename: keep `Relevo` unless someone has a stronger name.
2. Confirm team lane mapping: Narf/API, Sarf/data, Jorf/agents, Jerf/router,
   Marf/frontend.
3. Pick the demo project and the three people/agents in it.
4. Pick the project rules that make coordination legible in the demo.
5. Pick the first 8-12 memory edge types for graph-like context bringup.
6. Decide how real V2 coding should be:
   - safest: deterministic fallback diff plus optional live LLM;
   - stronger: live LLM generates patch artifacts;
   - riskiest: agent applies patches to a real git worktree during demo.

Recommendation for the hackathon: use live LLM output when available, but always
store and replay fallback artifacts through the same run/artifact/message/SSE
contract.
