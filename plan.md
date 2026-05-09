# Project Memory — Build Spec v1

> **Demo cast TBD** — see end of doc, three options, my pick is hybrid (recursive + scripted). Read the doc first, then choose, then I'll pin the cast and finalize seed-data scope.

---

## 0. Repo, infra, names to pick

Everything lives in one monorepo. Pick a project codename now (suggestion: **`relevo`** — "relay" in Spanish, fits the agent-handoff metaphor; replace if you've got a better one).

```
relevo/
├── apps/
│   ├── desktop/                   # Electron + React + TS — Marf
│   │   ├── electron/              # main process, IPC
│   │   ├── src/
│   │   │   ├── views/             # ChatView, RosterView, PoolView, TimelineView, TasksView
│   │   │   ├── components/        # RoutingVisualizer, CitationChip, AttributionDrawer, AgentCard
│   │   │   ├── stores/            # zustand: chatStore, workspaceStore, attributionStore
│   │   │   └── api/               # typed client generated from packages/contracts
│   │   └── package.json
│   └── server/                    # FastAPI — Narf (api/deploy) + Sarf (data/memory)
│       ├── src/relevo/
│       │   ├── api/               # routes, SSE handlers
│       │   ├── domain/            # pydantic models
│       │   ├── memory/            # store, retrieval, embedding — Sarf
│       │   ├── agents/            # agent runtime — Jorf
│       │   ├── routing/           # router — Jerf
│       │   ├── synthesis/         # multi-agent merge — Jorf
│       │   └── main.py
│       ├── migrations/            # SQL — Sarf
│       ├── tests/
│       └── pyproject.toml
├── packages/
│   └── contracts/                 # shared JSON schemas + generated TS types
├── eval/
│   ├── router_cases.yaml          # Jerf
│   ├── retrieval_cases.yaml       # Jerf
│   └── run_eval.py
├── seeds/
│   ├── personas.yaml              # Jorf
│   ├── memories/<agent>.yaml      # Jorf + Jerf jointly
│   ├── pool.yaml
│   ├── timeline.yaml
│   └── tasks.yaml
├── prompts/
│   ├── agent_system.md            # Jorf
│   ├── router_system.md           # Jerf
│   └── synthesis_system.md        # Jorf
└── infra/
    ├── railway.json
    └── docker-compose.yml         # local Postgres+pgvector for dev
```

Branch protection: `main` requires PR + 1 review for V0–V1, drop to fast-merge after V2.

## 1. Data model — `migrations/0001_init.sql`

Sarf owns this. Land it merged by **h2**.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE workspace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE person (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  domain_summary TEXT NOT NULL
);

CREATE TABLE agent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  persona JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TYPE memory_tier AS ENUM ('personal', 'pool', 'timeline');

CREATE TABLE memory_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  tier memory_tier NOT NULL,
  agent_id UUID REFERENCES agent(id) ON DELETE CASCADE,  -- NULL for pool/timeline
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',  -- {source, tags, occurred_at, links[]}
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((tier = 'personal' AND agent_id IS NOT NULL) OR (tier <> 'personal'))
);

CREATE INDEX memory_embedding_hnsw ON memory_entry USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_tier_ws ON memory_entry (workspace_id, tier);
CREATE INDEX memory_agent ON memory_entry (agent_id) WHERE agent_id IS NOT NULL;

CREATE TYPE task_status AS ENUM ('proposed','open','in_progress','blocked','review','done');

CREATE TABLE task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_agent_id UUID REFERENCES agent(id),
  status task_status NOT NULL DEFAULT 'proposed',
  dependencies UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE timeline_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_agent_id UUID REFERENCES agent(id),
  event_type TEXT NOT NULL,         -- 'task_created','task_state_change','decision_recorded','memory_added'
  subject_type TEXT,
  subject_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX timeline_ws_time ON timeline_event (workspace_id, occurred_at DESC);
```

Triggers (V2): `task` updates emit a `timeline_event` row automatically. Sarf writes the trigger.

## 2. API surface — owned by Narf

All under `/api/v1`. JSON unless SSE.

```
GET    /health                              -> {status, sha, model_versions}
POST   /workspaces                          -> Workspace
GET    /workspaces/{id}                     -> Workspace
GET    /workspaces/{id}/agents              -> Agent[]
GET    /workspaces/{id}/timeline?cursor=    -> {events: TimelineEvent[], next_cursor}
GET    /workspaces/{id}/tasks               -> Task[]
POST   /workspaces/{id}/tasks               -> Task
PATCH  /tasks/{id}                          -> Task

POST   /workspaces/{id}/memory              -> MemoryEntry            (manual deposit)
GET    /memory/{id}                         -> MemoryEntry             (citation drill-down)

POST   /workspaces/{id}/ask    [SSE]
  body: { question: str, asker_agent_id?: UUID }
  events:
    - routing_decision { agents: [{id, name}], tiers: [...], rationale }
    - agent_started    { agent_id }
    - agent_partial    { agent_id, delta }
    - citation         { agent_id, memory_id, tier, snippet }
    - agent_done       { agent_id }
    - synthesis_partial{ delta }
    - plan_proposal    { task_draft: {title, description, owner_suggestion, deps} }
    - done             { request_id }

# Internal (called by router during fanout, not exposed)
POST   /agents/{id}/answer
  body: { question, retrieved_chunks: [...] }
  -> { answer, citations, confidence, out_of_scope }
```

Auth for the hackathon: single header `X-Workspace-Asker: <person_id>`. No login flow.

## 3. Agent persona — owned by Jorf

`packages/contracts/agent_persona.json`:

```json
{
  "agent_id": "uuid",
  "display_name": "string",
  "voice": {
    "tone": "string",
    "first_person": true,
    "signature_phrases": ["string"]
  },
  "domain": {
    "primary": "string",
    "tags": ["string"],
    "expertise_summary": "string (1-2 sentences, used by router)"
  }
}
```

`prompts/agent_system.md` (skeleton — Jorf iterates, but contract is fixed):

```
You are {display_name}'s personal agent. You speak in their first-person voice.

Voice: {voice.tone}
Use first-person ("I", "we") only for claims grounded in personal-tier memory.
For pool-tier facts, use neutral voice. For timeline, narrate.

Domain: {domain.expertise_summary}

If the question is outside your domain or your memory has no relevant content,
respond with {"out_of_scope": true, "suggest": ["agent_name", ...]} and stop.

Cite every claim with [memory_id|tier]. Output strictly:
{
  "answer": "string",
  "citations": [{"claim": "...", "memory_id": "...", "tier": "personal|pool|timeline"}],
  "confidence": 0.0-1.0
}

Retrieved memory:
{retrieved_chunks}

Question:
{question}
```

## 4. Router & eval — owned by Jerf

`prompts/router_system.md` (skeleton):

```
You route questions across three memory tiers and a roster of personal agents.

Tiers: pool (current truths), personal (individual experiential), timeline (history & state).
Heuristics:
- "what is / how do we" factual    -> [pool, personal-of-domain-owner]
- "why / how did we decide"        -> [personal-of-decider, pool]
- "when / who / status of"         -> [timeline, personal-of-owner]
- cross-cutting ("add X to Y and Z") -> fanout: multiple personals + synthesis

Roster:
{agent_directory}

Output:
{ "tiers": [...], "agents": [agent_id...], "mode": "single"|"fanout", "rationale": "..." }
```

`eval/router_cases.yaml` — **20 cases by h4, 30 by h22**. Format:

```yaml
- id: r_001
  question: "How do we deploy?"
  expected_tiers: [pool, personal]
  expected_agents_any_of: [<infra_owner>]
  forbidden_agents: []
  must_mention_any_of: ["runbook", "migration", "deploy"]
  category: factual

- id: r_007
  question: "Why did we pick Postgres over Mongo?"
  expected_tiers: [personal]
  expected_agents_any_of: [<db_decider>]
  must_mention_any_of: ["relational", "transactions", "vector"]
  category: rationale
```

Pass bar: **router agent-selection precision ≥ 0.80, recall ≥ 0.85** on the eval set. Below that, V3 is not done.

## 5. Frontend structure — owned by Marf

State management: **zustand** (3 stores: chat, workspace, attribution). Server state via **TanStack Query**. Streaming via native `EventSource` wrapped.

Component tree:

```
<App>
  <TopBar />                              {/* asker identity, workspace switcher */}
  <Sidebar>
    <AgentRoster />                       {/* AgentCard × N: name, domain tag, status dot */}
  </Sidebar>
  <MainPane>
    <Tabs>
      <ChatView>                          {/* primary surface */}
        <MessageList />
        <RoutingVisualizer />             {/* animates fanout, lights up agents */}
        <AgentResponsePanels />           {/* parallel cards, stream into them */}
        <SynthesisPanel />
        <PlanProposalCard />              {/* renders if SSE emits plan_proposal */}
        <Composer />
      </ChatView>
      <PoolView />                        {/* memory list, filter by tag/source */}
      <TimelineView />                    {/* chronological, virtualized */}
      <TasksView />                       {/* kanban: 6 columns by status */}
    </Tabs>
  </MainPane>
  <AttributionDrawer />                   {/* slide-in on citation click */}
</App>
```

Citation chip: `[J · personal]` style. Click → drawer with full memory entry, related events, agent.

Tier color tokens (lock these now, do not bikeshed during build):
- personal: `#E8A87C` (warm)
- pool: `#9CA3AF` (neutral)
- timeline: `#6FA8DC` (cool)

## 6. Versions — concrete deliverables per converge

### V0 — Contracts & scaffold (h0–h4)

| Owner | Concrete deliverables |
|---|---|
| Narf | GitHub repo created, Railway project linked, `/health` returns `{status:"ok", sha, models:{agent:"sonnet-4-6", router:"haiku-4-5-20251001"}}` at the public URL by **h3**. URL posted in team chat. |
| Sarf | `migrations/0001_init.sql` merged. Local `docker-compose.yml` runs Postgres+pgvector. `seeds/loader.py` skeleton that loads YAML → DB. |
| Jorf | `prompts/agent_system.md` v1 + `packages/contracts/agent_persona.json` schema. One reference persona file: `seeds/personas.yaml` with one fully-specified persona. |
| Jerf | `eval/router_cases.yaml` with 20 cases, `eval/run_eval.py` skeleton (loads cases, calls a stub router, computes precision/recall, outputs report). |
| Marf | Electron app builds locally on each dev's machine. Three-pane layout shell. Hits Railway `/health`. Renders fixtures from `apps/desktop/src/fixtures/`. |

**Converge h4:** PRs merged, `pnpm dev` launches the app, app shows fixture data, `/health` is green. Smoke #1 = app boots + backend reachable + migration applied.

### V1 — Single-agent end-to-end (h4–h12)

| Owner | Concrete deliverables |
|---|---|
| Narf | `POST /workspaces/{id}/ask` with single-agent path. SSE handler emits `routing_decision`, `agent_partial`, `citation`, `done`. Request logging by `request_id`. |
| Sarf | `MemoryEntry` repository: insert, hybrid retrieval (`SELECT … ORDER BY embedding <=> $1` joined with BM25 via `tsvector`), top-k=5. Embedding writes async. Loader populates **one agent's 30 personal memories**. |
| Jorf | Single-agent answer pipeline working: persona + retrieved chunks → Claude Sonnet 4.6 → JSON parsed → SSE events. Citations validated (every cited id must exist). |
| Jerf | Retrieval eval: 20 `(question, expected_memory_ids)` cases. Tune chunking + hybrid weight until top-5 recall ≥ 0.7. |
| Marf | Live chat, streaming render, citation chips clickable, AttributionDrawer pulls from `GET /memory/{id}`. Loading & error states. |

**Converge h12:** Smoke #2 — ask one rationale-style question, get a streaming first-person answer with at least one valid citation, drawer renders the source. V0 still passes.

### V2 — Three-tier memory (h12–h22)

| Owner | Concrete deliverables |
|---|---|
| Narf | Tasks CRUD endpoints. Trigger-driven `timeline_event` insertion. `GET /timeline` paginated. SSE event subscription endpoint for live timeline. |
| Sarf | Pool & timeline storage. Cross-tier retrieval API: `retrieve(workspace_id, query, tiers=[…], agent_ids=[…], k_per_tier=5) -> [chunks]`. Seeded pool (~40 entries) + timeline (~60 events) + tasks (~14 across statuses). |
| Jorf | Agent prompt v2: voice differentiation per tier (first-person personal, neutral pool, narrative timeline). Citation-by-tier required. |
| Jerf | Router heuristic v1 (single-agent mode): tier prioritization. Eval expanded to 30 cases covering all three tiers. Pass bar: 0.80 precision. |
| Marf | PoolView, TimelineView, TasksView. Tier-color-coded citations. Tab navigation. Timeline virtualization (`react-virtuoso`). |

**Converge h22:** Smoke #3 — three test questions, one per tier-priority, all return cited answers with correct dominant tier. V0+V1 still pass.

### V3 — Multi-agent fanout & synthesis (h22–h30)

| Owner | Concrete deliverables |
|---|---|
| Narf | Fanout orchestration: parallel calls to `/agents/{id}/answer`, merged stream. Plan-proposal endpoint emits `task_draft` SSE event when synthesis flags cross-cutting. Timeout per agent: 8s. |
| Sarf | All seed data complete: full cast loaded across personal × pool × timeline × tasks. Dataset lockfile `seeds/LOCK.md` documenting every memory and which demo question hits it. |
| Jorf | `prompts/synthesis_system.md`: takes N agent responses → unified answer with merged citations + optional plan proposal. Synthesis uses Sonnet 4.6. |
| Jerf | Router fanout mode + ask-all fallback. Full eval at 30 cases passing 0.80 precision / 0.85 recall. Eval report committed. |
| Marf | RoutingVisualizer animation. Parallel AgentResponsePanels stream simultaneously. SynthesisPanel. PlanProposalCard with "stage as task" button → calls `POST /tasks`. |

**Converge h30:** Smoke #4 — cross-cutting demo question fans to ≥2 agents, synthesizes, proposes a task, task lands in TasksView. All prior smokes pass. **FEATURE FREEZE.**

### V4 — Polish, dataset, rehearsal (h30–h36)

| Owner | Concrete deliverables |
|---|---|
| Narf | Stability sweep, error boundaries, retry on 5xx for Anthropic. Backup deploy on second Railway service with DB snapshot restored. |
| Sarf | Dataset polish round 2 with the team. `seeds/LOCK.md` finalized. DB snapshot committed for fallback restore. |
| Jorf | Pre-cache the 4–5 demo answers as static JSON in `apps/desktop/src/fallbacks/`. Composer prefers live; if `done` event doesn't fire in 10s, plays fallback transparently. |
| Jerf | Final eval pass against the demo script's exact questions. If any case fails, that's the only thing being fixed. |
| Marf | Visual polish, animation timings, empty states. Demo-mode toggle that disables editing. |
| All | **h30–h32:** dataset jam together. **h32–h34:** rehearse demo 5×. **h34–h36:** sleep/buffer. |

## 7. Build-right discipline (terse reminders)

- **No new feature work during a converge window.** Converges are 30 min, all hands at machines.
- **Smoke tests cumulate.** A V3-era PR that breaks V1's smoke is the highest-priority fix in the room.
- **One owner per contract.** Schema = Sarf. API = Narf. Persona = Jorf. Router = Jerf. UI = Marf. Disagreements escalate to whoever has tiebreak (you, presumably).
- **Mock first, wire at converge.** Marf uses `fixtures/` until h12; switches to live API at the V1 converge. AI side uses synthetic retrieval until h12 too.
- **Feature freeze h30, no exceptions.**

## 8. Demo cast — pick one

Three options. My recommendation is **C**.

**A. Recursive — the team itself.** Agents are Narf/Sarf/Jorf/Jerf/Marf. Personal memory is real entries deposited during the build (each person spends 5 min/converge writing 2-3 memory entries about their work — decisions, blockers, why-X-not-Y). Pool is the project's actual architecture. Timeline is the actual hackathon timeline. **Pro:** authenticity is unfakeable, judges can ask any unscripted question. **Con:** requires dogfooding from h12, less narrative arc, weaker if the system is buggy.

**B. Fictional company.** Replace SocialNet with a different fictional setting. Suggested: **Mate** (fictional Argentine fintech) — relatable to a Buenos Aires audience, broader than pure software (compliance ops, customer support, eng). Cast TBD. **Pro:** scripted, controlled, rehearsable, demonstrates "this isn't just for devs." **Con:** all the SocialNet criticisms apply — judges can smell strawmen.

**C. Hybrid (recommended).** B is the spine of the 90-second demo (controlled, rehearsed). A is the closer: in the last 15 seconds you say *"by the way — this same system has been ingesting our team's own work for the last 36 hours. Ask us anything about how we built it."* Then you take an unscripted judge question and let the team's own agents answer. **Pro:** rehearsable + authenticity moment + dogfooding flex. **Con:** slightly more work (need to seed Mate cast AND deposit team memories during build), but the team-memory deposition is ~3 min per person per converge.

---

**Three things I need from you to pin this down:**

1. Project codename — `relevo` or your pick.
2. Demo cast — A, B, or C (and if B or C, the fictional setting; I propose Mate, change at will).
3. Confirm the role pairings: Narf=API/deploy, Sarf=data/memory, Jorf=agent runtime, Jerf=router/eval. Swap if their actual strengths point differently.

Once those three land, I'll pin every TBD and produce the seed-data spec (exactly which memories, exactly which demo questions hit them).