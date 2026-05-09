# Marirf — V2 Task: Cross-User Demo UI + Runner Trace

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Marirf's frontend lane in V2. V1 is already implemented: the desktop shell,
> chat loop, runner IPC, and basic `request_context` plumbing exist.

## Lane

The local Electron/React app surface that makes the V2 cross-user flow usable
and demoable.

V2's product moment is: User1 asks a question only User2 can answer, the local
assistant calls `request_context`, the UI shows that cross-user lookup
happening, then the final answer appears and the asking user's prompt+answer is
persisted to the server.

You do not own the backend route internals (Jerf/Narf), the on-demand agent
(Jorf), or the schema/seeds (Sarf). You own the desktop UX, renderer state, IPC
event handling, and the client-side persistence call after the assistant
finishes.

## Coordination

- Pair with Jerf at h0 on the MCP tool event shape. The frontend needs enough
  event data to show `request_context` target, question, running state, and
  result/error in the trace.
- Pair with Sarf on seeded user names/tokens from `seeds/LOCK.md` so the UI
  labels the queried teammate correctly during the demo.
- Pair with Narf on bootstrap and prompt-answer persistence endpoints:
  `/bootstrap` and `/context-entries` require the authenticated user's bearer
  token.
- Pair with Jorf if the local assistant prompt needs stronger instructions
  about when to use `request_context`.

## Starting State

- `apps/desktop/src/renderer/src/views/ChatView.tsx` sends prompts through
  `window.api.startAssistantRun(...)` and renders streamed assistant text.
- `ChatView.tsx` still passes `fixtureBootstrap` and fixture roster data
  instead of calling server bootstrap on session start.
- `apps/desktop/src/runner.ts` emits `assistant_text`, `tool_call`,
  `tool_status`, `result`, and `error` events from the Claude Agent SDK.
- `apps/desktop/src/requestContextTool.ts` can POST `request_context` to the
  server and returns `{answer, source_user_ids, citations}` to the model.
- The renderer currently collapses tool activity into one string:
  `tool: <name>` / `running <name>`.
- There is a V2 workaround in `apps/desktop/src/runner.ts`: when streaming
  deltas exist, final assistant text events are stripped to avoid duplicates.
  Keep this for V2; the explicit streaming contract is V3.
- `TopBar.tsx` expects `workspaceName` and `onBack`, while `App.tsx` currently
  renders it without props. Fix this if it blocks typecheck/build.

## Deliverables

1. **Real bootstrap on session start.** Add a desktop client path that calls
   `GET /bootstrap` with the selected user's bearer token and stores the
   result in renderer state. Use it for:
   - the local assistant's `bootstrap` payload,
   - roster/sidebar rendering,
   - teammate labels in the tool trace.
2. **Environment/config cleanup.** Replace hardcoded demo identity values in
   `ChatView.tsx` with a small typed config read from Vite env:
   - `VITE_API_BASE_URL`
   - `VITE_AUTH_TOKEN`
   - `VITE_LOCAL_REPO_PATH`
   - optional `VITE_MODEL` / `VITE_MAX_TURNS`
   Default only to safe local/demo values documented in `apps/desktop/README.md`.
3. **Visible `request_context` trace.** Replace the single
   `toolStatusByWorkspace` string with structured trace state. For each tool
   call, show:
   - tool name,
   - target teammate display name when resolvable from roster,
   - question,
   - running/succeeded/failed status,
   - elapsed seconds when available,
   - a short answer preview after the tool result is available.
4. **Tool result visibility.** If the SDK event stream does not expose tool
   results directly, coordinate with Jerf to add a runner event from
   `requestContextTool.ts` or `runner.ts`. Do not parse assistant prose to
   infer whether the tool ran.
5. **Prompt+answer persistence.** After a successful `result` event, POST the
   user's original prompt and final answer to `/context-entries` with the same
   bearer token. This is required by plan.md's persist step and should happen
   after the answer is displayed.
6. **Failure states.** Show concise UI states for bootstrap failure,
   server/request-context failure, invalid repo path, and runner error. A failed
   tool call should be visible in the trace and should not leave the input
   permanently disabled.
7. **Roster/dashboard panel.** Replace fixture-driven sidebar data with
   bootstrap roster data. Keep it simple: display teammate name, domain
   summary, and current user marker. This is P1 but directly improves demo
   legibility.
8. **Frontend smoke path.** Add or document a manual smoke in
   `apps/desktop/README.md`:
   - launch with User1 token,
   - bootstrap loads roster with User2,
   - ask the scripted V2 prompt from `seeds/LOCK.md`,
   - trace shows `request_context` targeting User2,
   - final answer displays,
   - `/context-entries` persistence succeeds.

## Decisions You Own

- Renderer state shape for bootstrap data and tool-call trace entries.
- How much of the trace appears inline versus in a compact side/status panel.
  Keep it readable during a live demo; one visible ordered trace is enough.
- Exact copy for frontend statuses. Keep it factual and short.
- Whether to use the existing fixture files as fallback demo data. If used,
  make fallback mode explicit so the live demo is not accidentally running
  against stale fixture users.

## Out Of Scope For V2

- The V3 streaming event contract (`runner:delta`, `runner:final`,
  `runner:error`). Keep the current duplicate-avoidance workaround unless it
  breaks V2.
- `target = "project"`, multi-target UI, and multi-hop-specific UI. The trace
  can support multiple calls naturally, but V2 only needs one User1 -> User2
  query.
- Native packaging polish, menus, installers, or a settings window. Use env
  config for the hackathon.
- Backend closure proof SQL. Surface the tool call in UI, but Sarf/Jerf own
  database proof.

## Done When

V2 is done for Marirf when this passes on a laptop pointed at the deployed
server:

1. App launches and bootstrap loads the authenticated user's roster from the
   server, not fixtures.
2. User1 asks the locked V2 prompt from `seeds/LOCK.md`.
3. The assistant calls `request_context` for User2.
4. The UI visibly shows the tool trace while the lookup is running and after it
   completes.
5. The final assistant answer is shown without duplicated streamed text.
6. The renderer posts User1's prompt+answer to `/context-entries`.
7. The input recovers cleanly after success or failure, and the run can be
   repeated without reloading the app.
