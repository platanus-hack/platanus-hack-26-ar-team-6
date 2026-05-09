# Project Goal

## One-line pitch

A workflow where every user on a project can transparently borrow each other's
context. When your AI assistant doesn't know something, it silently asks a
teammate's AI (built from that teammate's stored context) and folds the answer
back into your conversation — without you ever switching tools or pinging
anyone on Slack.

## The problem we are solving

On real projects, knowledge is scattered across people. User1 knows the
frontend conventions, User2 owns the data model, User3 has the deploy quirks
in their head. When User1's coding assistant tries to help User1 with
something that touches User2's domain, it either:

- guesses (and gets it wrong),
- asks User1 to go ask User2 (which breaks flow), or
- demands that all context be manually centralized (which never actually
  happens).

We want the assistant itself to know that it is missing context, fetch it
from the right teammate's accumulated context automatically, and use it.
The cross-team knowledge handoff becomes an under-the-hood detail of a single
prompt, not a human coordination problem.

## The shape of the system

There are three components.

### 1. Server (shared, remote)

Exposes endpoints used by every user's local app.

It owns:

- a database that stores per-user context and a shared "project" context;
- the ability to spin up an **agent built from a given user's context** on
  demand (live LLM + retrieval over that user's DB), so it can answer queries
  *as that user would*, given what they have stored;
- the routing/retrieval logic that decides what stored context to feed the
  agent when answering a cross-user query.

The exact storage shape is an implementation detail. We are leaning toward a
graph for graph-RAG, but the goal does not depend on that choice.

### 2. Local app (per user)

A standalone chat app that lives on each user's machine. It is the user's
coding assistant: it has its own chat UI, has access to the local codebase,
and is the thing the user prompts. It is not a wrapper around an existing
coding agent — it is the coding agent.

The app is responsible for:

- starting a session and loading bootstrap context;
- running the conversation loop with the AI;
- intercepting the AI's "I am missing context" tool calls;
- talking to the server on the AI's behalf;
- displaying the final answer to the user;
- writing the prompt/answer back to the prompting user's DB.

### 3. The user's AI assistant (inside the local app)

The AI the user actually talks to. It has:

- access to the local codebase,
- bootstrap context loaded at session start,
- a tool that lets it explicitly request more context from a named teammate,
  the project, or both.

It decides, per turn, whether it can answer or whether it needs more context
before answering.

## The end-to-end flow

1. **Session start.** User opens the app and begins a new session. A bootstrap
   skill runs immediately: it hits the server and pulls down (a) a summary of
   the user's own stored context and (b) the general project context. Both get
   loaded into the AI's initial context window. The general project context
   includes the project roster, so the AI knows which teammates exist and
   roughly what each one owns.

2. **User prompts.** The user asks a question or requests a change.

3. **AI self-assessment.** The AI considers: "Do I have what I need?" Three
   possible outcomes:

   - **Yes** → answer.
   - **No, and I know who can help** → call the missing-context tool, naming
     the teammate(s) and/or the project, with a question.
   - **No, but I don't know who** → ask the user, or fall back to a project-
     scoped query.

4. **Missing-context loop (under the hood).** When the AI invokes the tool:

   1. The local app receives the tool call with `{target: user_id|"project",
      question: "..."}`.
   2. The app hits the server: "I need this from this user/project."
   3. The server retrieves the relevant slice of that user's stored context
      (using whatever method best matches the question — graph-RAG, vector
      search, etc.) and spins up an agent built from that context (live LLM
      grounded in the retrieved slice).
   4. That agent answers the question.
   5. The server returns the answer to the local app.
   6. The local app feeds the answer back to the user's AI as the tool result.

5. **Iterate if needed.** The AI may decide, after seeing the answer, that it
   now has a new gap (a teammate's answer mentioned a third teammate's
   decision, etc.). It calls the tool again. This loops until the AI judges
   it has enough.

6. **AI answers the user.** Once the AI is satisfied, it produces its final
   answer.

7. **Persist.** The local app does two things, in order:

   - displays the final answer to the user;
   - writes the **prompt + final answer** to the prompting user's DB as a new
     context entry.

## The invariant that makes this work

> When User1's AI queries User2's agent, User2's DB must be updated with the
> Q&A that User2's agent produced.

This is the closure property that keeps everyone's context growing.

- "User2's agent" = the live LLM + retrieval-over-User2's-DB construct that
  the server built to answer the cross-user query.
- The full Q&A exchange — the question User1's AI asked, and the answer
  User2's agent gave — is persisted into User2's DB.
- Effectively, User2's stored context now contains a record of "I (well, my
  agent) was asked X and answered Y on behalf of User1." Next time anyone —
  including User2 themselves — queries User2's context for related material,
  that exchange is part of the available context.

This is what turns the system from "everyone's notes in one place" into a
genuinely compounding shared brain: every cross-user query enriches the
queried user's context, not just the asking user's.

## What success looks like

A working demo where:

1. Two or more users have populated context in the system.
2. User1 prompts their local app with a question that genuinely requires
   knowledge User2 has and User1 does not.
3. The app produces a correct, grounded answer without User1 ever leaving
   their session — and without User2 being interrupted.
4. After the answer, both User1's DB (prompt + answer) and User2's DB
   (the Q&A exchange that User2's agent produced) are updated.
5. A subsequent query from User2 about the same topic can pick up what
   User2's agent told User1 earlier — proving the closure property.

## Out of scope for this document

This file describes **what** we are building and **why**. It deliberately
does not specify:

- the exact storage backend (graph DB, Postgres + pgvector, hybrid, …);
- the retrieval algorithm;
- the agent runtime / model choices;
- the API surface;
- the local app's tech stack;
- versioned milestones.

Those go in `plan.md`, which we will rewrite together once this goal is
locked in.
