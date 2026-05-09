"""V0 stub router used to prove the eval harness can discriminate bad routing."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RouterDecision:
    tiers: list[str]
    agents: list[str]
    mode: str
    rationale: str


def route(question: str) -> RouterDecision:
    """Return an intentionally naive routing decision for every question."""
    return RouterDecision(
        tiers=["pool"],
        agents=["<infra_owner>"],
        mode="single",
        rationale="V0 stub: always routes to pool and <infra_owner>.",
    )
