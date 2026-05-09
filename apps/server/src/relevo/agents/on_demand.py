"""Stateless on-demand agent for answering from a target user's context slice."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from relevo.config import OnDemandAgentConfig, load_on_demand_agent_config


PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "agent_system.md"


class OnDemandAgentError(RuntimeError):
    """Raised when the on-demand model response cannot be used safely."""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContextSliceTarget(StrictModel):
    id: UUID
    display_name: str
    domain_summary: str | None = None
    profile: dict[str, Any] = Field(default_factory=dict)


class ContextSliceEntry(StrictModel):
    id: UUID
    user_id: UUID
    kind: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: Any | None = None


class OnDemandContextSlice(StrictModel):
    target: ContextSliceTarget
    entries: list[ContextSliceEntry] = Field(default_factory=list)


class ContextEntryCitation(StrictModel):
    claim: str
    context_entry_id: str


class OnDemandAgentAnswer(StrictModel):
    answer: str
    source_user_ids: list[str]
    citations: list[ContextEntryCitation] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    insufficient_context: bool = False

    @field_validator("source_user_ids")
    @classmethod
    def require_sources(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("source_user_ids must not be empty")
        return value


def load_agent_system_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _target_profile_summary(target: ContextSliceTarget) -> dict[str, Any]:
    return {
        "id": str(target.id),
        "display_name": target.display_name,
        "domain_summary": target.domain_summary,
        "voice": target.profile.get("voice", {}),
        "domain": target.profile.get("domain", {}),
    }


def _entry_payload(entry: ContextSliceEntry) -> dict[str, Any]:
    return {
        "id": str(entry.id),
        "user_id": str(entry.user_id),
        "kind": entry.kind,
        "content": entry.content,
        "metadata": entry.metadata,
        "created_at": entry.created_at,
    }


def build_agent_prompt(context_slice: OnDemandContextSlice, question: str) -> str:
    prompt = load_agent_system_prompt()
    payload = {
        "target_user": _target_profile_summary(context_slice.target),
        "retrieved_context_entries": [
            _entry_payload(entry) for entry in context_slice.entries
        ],
        "question": question,
    }
    return (
        f"{prompt.rstrip()}\n\nRuntime input:\n```json\n"
        f"{json.dumps(payload, indent=2, default=str)}\n```"
    )


def _extract_text(response: Any) -> str:
    text_parts: list[str] = []
    for block in getattr(response, "content", []):
        if getattr(block, "type", None) == "text":
            text_parts.append(getattr(block, "text", ""))
    return "".join(text_parts).strip()


def _parse_model_answer(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise OnDemandAgentError("on-demand agent did not return valid JSON") from error
    if not isinstance(parsed, dict):
        raise OnDemandAgentError("on-demand agent JSON must be an object")
    return parsed


def _normalize_source_user_ids(
    raw_ids: Any,
    target_user_id: UUID,
) -> list[str]:
    normalized: list[str] = []
    if isinstance(raw_ids, list):
        for raw_id in raw_ids:
            try:
                candidate = str(UUID(str(raw_id)))
            except (TypeError, ValueError):
                continue
            if candidate not in normalized:
                normalized.append(candidate)
    target = str(target_user_id)
    if target not in normalized:
        normalized.insert(0, target)
    return normalized


def _normalize_answer(parsed: dict[str, Any], target_user_id: UUID) -> OnDemandAgentAnswer:
    normalized = {
        **parsed,
        "source_user_ids": _normalize_source_user_ids(
            parsed.get("source_user_ids"),
            target_user_id,
        ),
    }
    try:
        return OnDemandAgentAnswer.model_validate(normalized)
    except ValueError as error:
        raise OnDemandAgentError("on-demand agent JSON failed contract validation") from error


def _empty_context_answer(context_slice: OnDemandContextSlice) -> OnDemandAgentAnswer:
    return OnDemandAgentAnswer(
        answer=(
            f"No retrieved context entries were provided for "
            f"{context_slice.target.display_name}, so I cannot answer from that user's stored context."
        ),
        source_user_ids=[str(context_slice.target.id)],
        citations=[],
        confidence=0.0,
        insufficient_context=True,
    )


def _get_client(client: Any | None) -> Any:
    if client is not None:
        return client
    try:
        from anthropic import Anthropic
    except ModuleNotFoundError as error:
        raise OnDemandAgentError(
            "anthropic package is required for live on-demand agent calls"
        ) from error
    return Anthropic()


def answer_on_demand(
    context_slice: OnDemandContextSlice | dict[str, Any],
    question: str,
    *,
    client: Any | None = None,
    model: str | None = None,
    config: OnDemandAgentConfig | None = None,
) -> OnDemandAgentAnswer:
    """Answer one question from one target user's retrieved context slice.

    Retrieval is intentionally owned by Narf/Sarf. Callers pass the already
    filtered top-k entries for one target user.
    """
    parsed_slice = (
        context_slice
        if isinstance(context_slice, OnDemandContextSlice)
        else OnDemandContextSlice.model_validate(context_slice)
    )

    if not parsed_slice.entries:
        return _empty_context_answer(parsed_slice)

    runtime_config = config or load_on_demand_agent_config()
    selected_model = model or runtime_config.model
    prompt = build_agent_prompt(parsed_slice, question)
    anthropic_client = _get_client(client)
    response = anthropic_client.messages.create(
        model=selected_model,
        max_tokens=runtime_config.max_tokens,
        temperature=0,
        system=prompt,
        messages=[{"role": "user", "content": question}],
        timeout=runtime_config.timeout_seconds,
    )
    response_text = _extract_text(response)
    if not response_text:
        raise OnDemandAgentError("on-demand agent returned no text content")
    parsed = _parse_model_answer(response_text)
    return _normalize_answer(parsed, parsed_slice.target.id)
