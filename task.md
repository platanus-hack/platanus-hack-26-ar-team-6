# V1 - Narf: single-agent ask SSE endpoint

Owner: Narf
Branch: `v1/narf`
Target: V1 converge

## Goal

Wire the first real backend chat path: `POST /workspaces/{id}/ask` should accept
a question, route it to one agent, stream useful SSE events, and finish with a
stable request id. This is the backend spine Marf and Jorf can plug into.

## What to build

- Add `POST /workspaces/{id}/ask` under the FastAPI app.
- Return an SSE stream with these V1 events:
  - `routing_decision`
  - `agent_partial`
  - `citation`
  - `done`
- Generate and log a `request_id` for every ask request.
- Keep the router/agent/retrieval seams simple and replaceable. If Sarf or Jorf
  are not ready yet, use small typed stubs with the same shape the real code will
  satisfy.
- Keep `/health` working exactly as it does in V0.

## Coordination notes

- Jorf owns the actual agent answer pipeline. Narf should expose a clean call
  boundary for it, not bury prompt/model logic in the route.
- Sarf owns retrieval and memory storage. Narf should consume a retrieval
  function/interface and keep a temporary fallback only while V1 is converging.
- Prefer clear Pydantic request/event models over loose dictionaries.

## Definition of done

- A local client can call the ask endpoint and receive the four SSE event types
  in order for a single-agent happy path.
- Each response includes a request id in logs and the final `done` event.
- Route-level errors produce a useful SSE/error response without crashing the
  server process.
- Add focused tests for the endpoint/event stream shape.
