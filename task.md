# V0 — Marf: Electron + React desktop shell with three-pane layout + fixtures

**Owner:** Marf
**Branch:** `v0/marf-desktop-shell`
**Deadline:** h4 converge
**Depends on:** nothing — this branch is self-contained (uses fixtures + a configurable health URL)

## Goal

Get the Electron app booting on every dev's machine with the three-pane shell rendered from local fixture data. Wire one network call (`/health`) gated on an env var so we can flip it on at the V0 converge once Narf's Railway URL is live. No live API calls beyond `/health`; everything else is fixtures until V1.

## Deliverables

1. **`apps/desktop/` scaffold**
   - Electron + React + TypeScript + Vite (or whichever bundler Marf prefers — Vite recommended).
   - `electron/` for main process + IPC; `src/` for the renderer.
   - `pnpm dev` (or `npm run dev`) launches the app on a fresh clone. Document this in `apps/desktop/README.md`.

2. **Three-pane shell** matching `plan.md` §5:
   ```
   <App>
     <TopBar />                              {/* asker identity, workspace switcher — static for V0 */}
     <Sidebar><AgentRoster /></Sidebar>      {/* AgentCard × N from fixtures */}
     <MainPane>
       <Tabs>
         <ChatView />                        {/* renders fixture messages, no streaming yet */}
         <PoolView />                        {/* fixture list */}
         <TimelineView />                    {/* fixture list */}
         <TasksView />                       {/* fixture kanban, 6 columns */}
       </Tabs>
     </MainPane>
   </App>
   ```
   - Tab navigation works.
   - Tier color tokens locked: personal `#E8A87C`, pool `#9CA3AF`, timeline `#6FA8DC`. Put them in a CSS variables file or theme module — do not bikeshed later.
   - Citation chip component renders (`[J · personal]` style) even if it's not wired to real data yet.

3. **Fixtures** at `apps/desktop/src/fixtures/`:
   - `agents.json` — 4–5 fake agents with display name, domain tag, status dot color
   - `messages.json` — a couple of sample chat messages with citation chip refs
   - `pool.json`, `timeline.json`, `tasks.json` — small samples so each tab has something to render
   - These are placeholder shapes; the real contracts ship with V1+. Marf chooses the V0 shapes; expect them to change.

4. **State management**
   - Install **zustand** and create the three stores (`chatStore`, `workspaceStore`, `attributionStore`) per `plan.md` §5, even if mostly empty for V0. Stub them with the right shape so V1 wiring is just "fill in".
   - Install **TanStack Query** and configure a `QueryClient` provider. Use it for `/health` (#5).

5. **`/health` ping**
   - Read `VITE_API_BASE_URL` from `.env`. If unset, default to `http://localhost:8000` for local dev.
   - On app boot, fire a TanStack Query against `${API_BASE_URL}/health`.
   - Render a small status indicator in the `TopBar`: green if 200 + `status:"ok"`, red otherwise. Tooltip shows the sha + model versions when green.
   - This is the **only** live network call in V0. Everything else is fixtures.

## Out of scope for this branch

- No streaming / SSE (V1).
- No real `/ask` flow, no `RoutingVisualizer`, no `SynthesisPanel`, no `PlanProposalCard` (V1+).
- No `AttributionDrawer` content (V1).
- No agent card "live" status — fixed status from fixtures is fine.
- No CI / packaging / signed builds — V4.

## Definition of done

- [ ] `pnpm dev` launches the app on every team member's machine.
- [ ] All four tabs render fixture content; tab switching works.
- [ ] Tier color tokens applied consistently to citation chips.
- [ ] `/health` indicator goes green when pointed at a working backend (Marf can verify against a local `python -m http.server` returning a stub JSON, or wait for Narf's URL at converge).
- [ ] `apps/desktop/README.md` documents `pnpm dev`, the env var, and how to swap to Narf's Railway URL.
- [ ] PR opened against `main`.

## Notes

- This branch only creates files under `apps/desktop/`. Zero collisions with other V0 branches.
- Marf does **not** need Narf's Railway URL to merge — the app defaults to localhost and the `/health` indicator going red is fine for V0 sign-off as long as the request is correctly made. The converge is when we point it at the real URL.
- Fixture shapes are intentionally not contract-stable. V1 introduces real types from `packages/contracts/`; expect to rewrite the fixture types then.
