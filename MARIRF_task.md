# Marirf — V1 Task: Frontend (Local App)

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Marirf's lane in V1.

## Lane

Frontend / local app. The local app is the user's coding assistant — a
chat surface plus a local runner that points at the user's real codebase
(see plan.md §5). The runner itself is split with Jorf (Agent
infrastructure); your half is everything the user sees and the wiring
into the server.

## Starting state

`apps/desktop/` currently contains only a `package.json` stub. There is
no UI, no IPC layer, no chat surface. You are building from zero, but
the directory tree, the gitignore rules, and the monorepo layout are in
place.

## Decisions you own in V1

- **Desktop app stack.** Electron, Tauri, or browser-only. Pick what
  ships fastest given the team's familiarity. Document the choice in a
  short note inside `apps/desktop/`.

## Decisions you contribute to (joint)

- **API surface (with Narf and Sarf).** You will be a primary consumer
  of the bootstrap endpoint and the prompt+answer write endpoint. Push
  back on payload shapes that are awkward for the UI. Final call rests
  with Narf+Sarf.
- **Local-runner runtime (with Jorf).** You don't choose the runtime,
  but you own the embed/IPC story for whatever Jorf picks (e.g. Claude
  Agent SDK invoked from the Electron main process and streamed to the
  renderer). Coordinate early.

## Deliverables

1. **App shell.** `apps/desktop/` boots into a chat surface. Single
   window, minimal chrome.
2. **Bootstrap on session start.** On launch, the app calls Narf's
   bootstrap endpoint with the configured user id, receives
   `(user_summary, project_context)` (project context includes the team
   roster), and feeds both into the runner's initial agent context.
   Show a small roster panel in the UI so the user can see who is on
   the project. The roster is the visible proof that bootstrap worked.
3. **Chat surface.** User types → message goes to the runner → streamed
   tokens render in the UI → final answer settles. Standard chat UX.
   No history search / threading needed in V1.
4. **Runner integration (your half).** Coordinate with Jorf to embed
   the local runner. You handle: starting the runner process with the
   correct working directory (the user's real repo path, configured via
   env or a settings panel), wiring its stdout/stream into the UI,
   surfacing tool calls visibly when they happen.
5. **Persistence trigger.** When the AI produces a final answer, the
   app POSTs `{prompt, final_answer}` to the prompting user's DB via
   Narf's write endpoint. UI must reflect a successful save (some small
   confirmation or absence-of-error indicator).
6. **`request_context` visibility (V1 stub).** Narf is providing a
   stub `request_context` endpoint that returns a deterministic
   placeholder. When the AI calls the tool, render *something* in the
   UI ("querying <target>…", or similar) so the affordance is visible
   even before V2 makes it real. This is what Jorf will plug into in
   V2.
7. **Settings.** A trivial way to set: server URL, the user id this
   instance represents, and the local repo path. A flat config file is
   fine; a settings panel is fine.

## Scrap

Nothing in your lane to scrap — the desktop tree was empty.

## Rework

- `apps/desktop/package.json` — currently a one-line stub naming
  `@relevo/desktop`. Replace with the real manifest for whatever stack
  you pick. The "Relevo" name is from the old plan; don't preserve it.

## Out of scope for V1

- Live streaming UI for cross-user calls (V2 will make
  `request_context` real; V4 polishes the visualization).
- Multi-session / multi-window.
- Real authentication UX. Use whatever Narf ships (likely a header
  token from settings).
- A full project dashboard. Roster + chat is enough for V1.

## Converge h10 — your part

When User1 launches the app, they see the roster (including User2),
type a prompt, get a streamed answer, and see confirmation that the
exchange was saved. Closing and re-opening the app and querying the
server confirms the entry persisted.

## Coordination notes

- Narf publishes the bootstrap and write endpoint shapes early; build
  against them as soon as they exist, with a fixture-mode fallback so
  you are not blocked.
- Jorf publishes the runner invocation contract early; the IPC plan
  follows from that.
- Keep the UI deliberately plain. V4 is when polish matters.
