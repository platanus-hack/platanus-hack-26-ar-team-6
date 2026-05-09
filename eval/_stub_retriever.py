"""V0 stub retriever used to prove the eval harness catches bad retrieval."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RetrieverDecision:
    tools: list[str]
    agents: list[str]
    mode: str
    rationale: str


def retrieve(question: str) -> RetrieverDecision:
    """Return an intentionally naive retrieval decision for every question."""
    return RetrieverDecision(
        tools=["global_ctx"],
        agents=[],
        mode="single",
        rationale="V0 stub: always asks global_ctx.",
    )
