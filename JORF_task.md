# Jorf — V1 Task: Agent Infrastructure & Instructions

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Jorf's lane in V1.

## Lane

The agent layer. Two distinct agents live in this product:

1. **The user's local AI assistant** — runs inside the local app (in
   the runner Marirf is integrating), has access to the user's real
   codebase, decides per turn whether to call `request_context`. This
   is what the user actually talks to. You own its system prompt,
   its tool definitions, and the runner that hosts it.
2. **The on-demand agent** — runs *server-side*, spun up when a
   `request_context` call lands, grounded in retrieval over a target
   user's stored context. You own its prompt template and runtime.

V1 mostly delivers (1). The on-demand agent doesn't run end-to-end
until V2, but the V2 work is dramatically faster if the prompt and
runtime are decided and sketched in V1.

## Starting state

- `prompts/agent_system.md` — full prompt template for an old-plan
  "delegated worker agent." Instructs the agent to ground claims in
  retrieved memory, cite sources, and identify when handoff to a peer
  is needed. Variables: `{display_name}`, `{voice.tone}`,
  `{peer_directory}`, `{retrieved_chunks}`, `{question}`. Output is
  JSON with `answer`, `citations`, `confidence`, optional `handoff`.
  This is the most salvageable single asset in the repo for the new
  plan's on-demand agent.
- `prompts/router_system.md` — empty stub (old-plan concept).
- `prompts/synthesis_system.md` — empty stub (old-plan concept).
- `prompts/validate_personas.py` — validator script for the persona
  contract.
- `packages/contracts/agent_persona.json` — JSON Schema for the
  persona contract: `agent_id`, `person_id`, voice (tone,
  first_person, signature_phrases), domain (primary, tags,
  expertise_summary), collaboration (handoff_triggers,
  suggested_peer_tags).

## Decisions you own in V1

- **Local-runner runtime.** Most likely Claude Agent SDK (cwd,
  file/edit/command tools, streaming, custom tools — good fit). Pick
  it or pick something else, document the decision, and produce a
  "hello world" run that proves the runtime starts with `cwd` set to
  a configurable path and streams output.
- **On-demand agent runtime (preview).** V1 doesn't run it
  end-to-end, but lock the choice now. Two reasonable shapes:
  - **Stateless inlined-context LLM call** — server constructs a
    single LLM request with the retrieved slice in the system prompt;
    receives an answer. Simplest. Recommended unless you have a
    reason to do otherwise.
  - **Sub-agent process** — spin up an agent runtime per call.
    Heavier, more flexible. Probably overkill for V1/V2.
- **Embedding model** (with Sarf, see below).

## Decisions you contribute to (joint)

- **`request_context` tool implementation (with Narf).** Narf owns
  the server endpoint shape; you own how the local AI sees and uses
  the tool (the tool name, its schema, when the prompt tells the AI
  to invoke it). Whether transport is direct SDK tool, MCP tool, or
  custom HTTP follows from the runtime you pick.
- **Embedding model (with Sarf).** Sarf is computing embeddings on
  seeded entries; the on-demand agent in V2 will need retrieval
  results that mean the same thing semantically. Agree on a single
  embedding model with Sarf so V1 seeds and V2 retrieval don't drift.

## Deliverables

1. **Local runner stood up.** Decide the runtime, install it inside
   `apps/desktop/` (coordinate placement with Marirf), wire it so a
   "hello world" prompt streams a response back to Marirf's chat UI.
   `cwd` is configurable via the local app's settings (Marirf's
   responsibility to expose, yours to consume).
2. **Local AI system prompt (V1 version).** A new file in `prompts/`
   (e.g. `prompts/local_assistant_system.md`) that tells the user's
   local AI:
   - it has access to the local codebase via the runtime's
     file/edit/command tools;
   - it received bootstrap context (`{user_summary}` and
     `{project_context}` including the team roster) at session start;
   - it will eventually have a `request_context` tool, but in V1 it
     should answer from local code + bootstrap and only stub the
     tool affordance.
   The V1 prompt does not need the AI to actually invoke
   `request_context` correctly — V2 introduces that. But the prompt
   should already mention the tool so V1 can validate the
   end-to-end "tool stub fires when the AI tries to use it" path.
3. **`request_context` tool definition (V1 stub).** Define the tool
   schema in whatever form the runtime takes (e.g. a tool spec
   passed to Claude Agent SDK). The tool's V1 implementation calls
   Narf's `/request-context` stub endpoint and returns the
   placeholder response to the AI. Marirf renders the call-in-flight
   visually. Net effect: the AI can invoke the tool today; the tool
   doesn't yet do real work, but the wiring is end-to-end.
4. **On-demand agent prompt template (V1 reworked from
   `agent_system.md`).** Strip the `handoff` field and any
   multi-agent-coordination language. Rebind variables: instead of
   addressing "the agent for person X handing off," it now reads as
   "you are answering on behalf of user X based on their stored
   context; here is the retrieved slice, here is the question." Keep
   the citation-required structure. V1 only needs the template
   committed; V2 wires it into the server.
5. **Persona contract reworked.** `packages/contracts/agent_persona.json`
   — strip `agent_id` (no persistent agents in the new plan). Adapt
   it as the **user context profile** schema: what Sarf stores per
   user, what bootstrap returns, what the on-demand agent's prompt
   template binds against. Keep voice + domain shape; drop
   handoff_triggers / suggested_peer_tags (no inter-agent handoff in
   the new plan).
6. **`prompts/validate_personas.py` updated** to validate against the
   reworked contract. Remove old fields, add new ones.
7. **Embedding model documented.** A short note (in `prompts/` or
   `apps/server/`) saying which model is used and where it's invoked
   (server-side at seed time, server-side at query time, client-side
   never).

## Scrap

Old-plan agent assets in your lane. Delete them.

- `prompts/router_system.md` — empty stub for an old-plan router
  that no longer exists.
- `prompts/synthesis_system.md` — empty stub for an old-plan
  synthesis step that no longer exists.
- The `handoff` field in `prompts/agent_system.md` and any text
  about peer handoffs / coordination.
- The `collaboration` block in `agent_persona.json`
  (handoff_triggers, suggested_peer_tags).
- The `agent_id` field in `agent_persona.json` (agents are
  ephemeral; users persist).

## Rework

- `prompts/agent_system.md` → reshape into the on-demand agent
  prompt template (deliverable 4). Keep the citation-required
  scaffold; that's the part you want.
- `packages/contracts/agent_persona.json` → user context profile
  schema (deliverable 5).
- `prompts/validate_personas.py` → validator for the new schema
  (deliverable 6).

## Out of scope for V1

- The on-demand agent actually running end-to-end. That's V2.
- The closure-invariant write (V2; Sarf and Narf own the storage
  and endpoint, you own the agent that produces the answer being
  written).
- Multi-hop / iterate-until-satisfied prompt logic (V3).
- Project-scoped queries (`target="project"` — V3).
- Fallback replay (V4).

## Converge h10 — your part

1. Marirf's chat UI streams a response from your local runner. The
   runner's `cwd` is a real local repo (any will do for V1).
2. The user's local AI can answer trivial questions using the
   runtime's file/edit/command tools.
3. The local AI invokes the `request_context` tool stub; Narf's
   stub endpoint responds with the placeholder; the AI sees the
   placeholder and continues.
4. The reworked on-demand agent prompt template is committed,
   validates against fixtures, and is ready for V2 to wire in.
5. The persona contract / validator are updated and don't reference
   `agent_id`, `handoff`, or peer coordination anywhere.

## Coordination notes

- Marirf is your tightest dependency in V1: the runtime needs to
  embed/IPC into whatever desktop stack Marirf picks. Sync as soon
  as Marirf's choice is locked.
- Narf owns the `/request-context` server endpoint shape; you own
  the AI's tool schema. These two have to match. Agree early on
  the request/response payload.
- Sarf owns embeddings at seed time; you own the embedding model
  choice. Agree on the model so seed-time embeddings and V2
  retrieval-time embeddings are compatible.
- Jerf owns retrieval routing — they will feed the retrieved slice
  into your on-demand agent prompt template in V2. The template's
  `{retrieved_chunks}` variable shape is your contract with Jerf.
