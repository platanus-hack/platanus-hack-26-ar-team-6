"""Agent modules used by server routes."""

from relevo.agents.on_demand import (
    ContextEntryCitation,
    ContextSliceEntry,
    ContextSliceTarget,
    OnDemandAgentAnswer,
    OnDemandAgentError,
    OnDemandContextSlice,
    answer_on_demand,
)

__all__ = [
    "ContextEntryCitation",
    "ContextSliceEntry",
    "ContextSliceTarget",
    "OnDemandAgentAnswer",
    "OnDemandAgentError",
    "OnDemandContextSlice",
    "answer_on_demand",
]
