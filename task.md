# V1 - Jorf: single-agent answer pipeline

Owner: Jorf
Branch: `v1/jorf`
Target: V1 converge

## Goal

Make one worker-tied agent answer a question from retrieved memory. The output
should be structured, cited, and ready for Narf to stream through the ask SSE
endpoint.

## What to build

- Load a persona from `seeds/personas.yaml` using the V0 persona contract.
- Format the V0 agent system prompt with persona fields, retrieved chunks, peer
  directory if available, and the user question.
- Call the model for a single-agent answer.
- Parse the model output as strict JSON in the normal or out-of-scope shape.
- Validate citations: every cited memory id must exist in the retrieved chunks.
- Return a typed result that Narf can translate into `agent_partial`,
  `citation`, and `done` stream events.

## Coordination notes

- Sarf owns retrieval. Jorf should accept retrieved chunks as input and avoid
  reaching into database details directly.
- Narf owns SSE transport. Jorf should expose a simple function/class boundary
  rather than FastAPI route code.
- Keep prompt/runtime code small enough to swap model settings quickly during
  the hackathon.

## Definition of done

- A local call can produce a cited answer for one persona and a provided set of
  retrieved chunks.
- Invalid JSON, missing citations, and hallucinated memory ids fail clearly.
- Add focused tests for prompt input formatting, JSON parsing, citation
  validation, and out-of-scope behavior.
