# Marirf — V3 Task: Project Target + Streaming Contract

> Read [goal.md](goal.md) and [plan.md](plan.md) first. This file scopes
> Marirf's frontend lane in V3. V3 only happens if V2 is green; if the
> cross-user demo is shaky, skip this and help V4 hardening.

## Implemented State Audited

I checked the current desktop app before writing this plan. Do not rebuild
these pieces unless they fail a smoke test.

- Live bootstrap is wired in `apps/desktop/src/renderer/src/App.tsx` through
  `window.api.getBootstrap(...)`.
- The sidebar uses bootstrap roster data when available and falls back to
  fixtures only when bootstrap is unavailable.
- Chat sends prompts through `window.api.startAssistantRun(...)` with
  `bootstrap`, `serverUrl`, `userId`, and `authToken`.
- Prompt+answer persistence is wired after a successful `result` event through
  `window.api.savePromptAnswer(...)`.
- The renderer already has structured tool trace state in
  `apps/desktop/src/renderer/src/stores/chatStore.ts`.
- `apps/desktop/src/runner.ts` emits `tool_call`, `tool_status`, and
  `tool_result` events, so V2 can show a visible `request_context` trace.
- `apps/desktop/src/requestContextTool.ts` accepts a single string target,
  including `"project"`, but explicitly rejects multi-target arrays.

Known frontend gaps for V3:

- Project-target calls display as raw `target: project`; they do not have a
  first-class project label or project source metadata in the trace.
- The desktop client normalizes away extra server fields such as
  `source_context_entry_ids`, `target`, `target_project_id`,
  `context_entry_id`, and `project_context_entry_id`.
- The runner still uses a V2 streaming workaround:
  `streamedAssistantText` strips final assistant text after deltas to avoid
  duplicate output.
- The renderer still uses `hasAssistantTextRef` to decide whether a final
  result should replace the assistant message.
- Multi-hop should work in principle because the trace is a list, but it has
  not been tested with repeated `request_context` calls in one assistant turn.
- `VITE_MODEL` and `VITE_MAX_TURNS` are not passed from the renderer to the
  runner, which makes multi-hop tuning awkward during rehearsal.

## Lane

Frontend support for V3 stretch behavior in the local app:

1. `target = "project"` should feel intentional in the UI.
2. Multi-hop traces should remain ordered and readable when the assistant calls
   `request_context` more than once in one turn.
3. Multi-target UI/client support should be added only if Jerf ships the
   backend/tool contract.
4. Streaming should move from the V2 duplicate-guard workaround to explicit
   delta/final semantics.

You do not own the server retrieval, closure writes, project schema, or
multi-target orchestration. You own renderer state, IPC event semantics, trace
presentation, desktop request typing, and frontend smoke coverage.

## Coordination

- Pair with Sarf/Narf on the project-target response shape. The frontend should
  preserve source fields returned by the server instead of dropping them during
  normalization.
- Pair with Jerf before adding multi-target arrays. If the server contract is
  not landed, keep arrays rejected and document the client behavior.
- Pair with Jorf on local assistant prompt wording for project queries and
  multi-hop termination. The frontend should not compensate for weak prompt
  behavior with hidden UI logic.
- Pair with Marf/Jerf if IPC channel names change. Prefer changing event
  payload types on the existing `assistant:event` channel unless there is a
  strong reason to introduce new channels.

## Deliverables

1. **V2 gate stays green.** Before V3 work, run the desktop V2 smoke from
   `apps/desktop/README.md`: bootstrap live, User1 -> User2
   `request_context`, visible trace, final answer once, prompt+answer saved.
2. **Project-target trace polish.**
   - Render `target: project` as a first-class project context label, not as an
     unknown user id.
   - Show project source metadata when available: `source_context_entry_ids`,
     `target_project_id`, and `project_context_entry_id`.
   - Keep User1 -> User2 labels working from roster data.
3. **Preserve richer request-context response fields.**
   - Extend `RequestContextResponse` and `normalizeResponse(...)` in
     `apps/desktop/src/requestContextTool.ts`.
   - Keep the model-facing tool result compact, but do not discard fields the
     renderer can use for trace and debugging.
   - Cover both user-target and project-target responses in
     `request_context_tool_active.test.ts`.
4. **Multi-hop trace readiness.**
   - Verify two or more `request_context` calls in one turn produce two ordered
     trace rows, each with the right target/question/result.
   - Avoid relying on "last running entry" when marking errors; use
     `toolUseId` whenever possible.
   - Add `VITE_MAX_TURNS` and optional `VITE_MODEL` passthrough from renderer
     config to `startAssistantRun(...)`.
5. **Multi-target only if backend ships it.**
   - If Jerf lands `target = [user_id, "project"]`, update the zod schema,
     TypeScript types, tests, and trace rendering for arrays.
   - Each target should appear legibly in one trace row or as grouped child
     rows. Pick the simpler UI that matches the server response.
   - If backend multi-target does not land, leave the existing rejection test
     and mark multi-target as unsupported in the README.
6. **Explicit streaming event contract.**
   - Replace generic `assistant_text` with explicit delta/final event semantics
     in `LocalAssistantEvent`, preload typings, and renderer handling.
   - Recommended shape:
     `assistant_delta { text }`, `assistant_final { text }`, and existing
     `result { result, sessionId }` for run completion.
   - Remove `streamedAssistantText` from `apps/desktop/src/runner.ts`.
   - Remove `hasAssistantTextRef` from `ChatView.tsx`; renderer should append
     deltas and replace on final.
   - Keep the final answer visually non-duplicated across streaming and
     non-streaming SDK paths.
7. **Frontend smoke docs.**
   - Extend `apps/desktop/README.md` with a V3 smoke:
     project-context prompt from `seeds/LOCK.md`, expected project trace,
     optional multi-hop prompt if Jorf/Jerf ship it, and expected no-duplicate
     streaming behavior.

## Decisions You Own

- Exact event type names for assistant delta/final. Keep them boring and typed.
- Whether project trace source ids are shown expanded by default or summarized
  as a compact count/list.
- How multi-hop trace rows are grouped in the chat panel. Preserve chronological
  order above all else.
- Whether multi-target appears as one grouped trace row or multiple target
  rows, if the backend supports it.

## Out Of Scope For V3

- Backend project retrieval, `project_qa` writes, or project ledger writes.
- Vector retrieval quality and graph-RAG.
- Demo fallback/pre-recorded answer mode. That is V4 hardening.
- Native settings windows or packaging polish. Keep env config.
- Reworking fixture tabs (`pool`, `timeline`, `tasks`) unless they directly
  block the chat demo.

## Done When

V3 is done for Marirf when these pass locally against the deployed server:

1. V2 User1 -> User2 smoke still passes.
2. A project-context prompt causes `request_context({target: "project", ...})`
   and the trace clearly labels project context.
3. Project source ids returned by the server are preserved in frontend state
   and visible enough for demo/debugging.
4. Two `request_context` calls in one assistant turn render as two ordered
   trace entries without corrupting the final answer.
5. Streaming and non-streaming assistant output both render once, with no
   prefix/full-text duplicate guard left in renderer logic.
6. `npm run typecheck` and `npm test` pass in `apps/desktop`.
7. `apps/desktop/README.md` documents the V3 frontend smoke path.
