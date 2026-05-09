from __future__ import annotations

import json
import os
import textwrap
import urllib.request
from typing import Any

from relevo.config import AppConfig


def answer_from_context(
    *,
    question: str,
    target_user: dict[str, Any],
    context_entries: list[dict[str, Any]],
    config: AppConfig,
) -> str:
    """Return a grounded answer for request_context project fallback.

    User-target requests use Jorf's structured on-demand agent. This fallback
    remains for project-target requests until the project context lane has its
    own structured answer contract.
    """
    if not context_entries:
        return (
            f"I do not have stored context for {target_user['display_name']} "
            "that answers this yet."
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            return _answer_with_anthropic(
                api_key=api_key,
                model=os.environ.get("ANTHROPIC_MODEL")
                or os.environ.get("ON_DEMAND_MODEL")
                or config.models.agent,
                question=question,
                target_user=target_user,
                context_entries=context_entries,
            )
        except Exception as exc:  # pragma: no cover - network fallback
            return _fallback_answer(question, target_user, context_entries, error=exc)

    return _fallback_answer(question, target_user, context_entries)


def _answer_with_anthropic(
    *,
    api_key: str,
    model: str,
    question: str,
    target_user: dict[str, Any],
    context_entries: list[dict[str, Any]],
) -> str:
    context = _format_context(context_entries)
    system = textwrap.dedent(
        f"""
        You are answering as {target_user['display_name']}'s stored project
        context. Answer only from the supplied context. If the context is
        insufficient, say what is missing. Keep the answer concise and useful
        to a teammate integrating a hackathon demo.
        """
    ).strip()
    body = {
        "model": model,
        "max_tokens": 700,
        "temperature": 0,
        "system": system,
        "messages": [
            {
                "role": "user",
                "content": (
                    f"Context:\n{context}\n\n"
                    f"Question:\n{question}\n\n"
                    "Answer with the relevant concrete facts."
                ),
            }
        ],
    }
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    parts = []
    for block in payload.get("content", []):
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    answer = "\n".join(part.strip() for part in parts if part.strip()).strip()
    if not answer:
        raise RuntimeError("Anthropic response did not contain text")
    return answer


def _fallback_answer(
    question: str,
    target_user: dict[str, Any],
    context_entries: list[dict[str, Any]],
    error: Exception | None = None,
) -> str:
    lines = [
        f"{target_user['display_name']}'s stored context has these relevant facts:",
    ]
    for entry in context_entries[:4]:
        content = " ".join(str(entry["content"]).split())
        lines.append(f"- {content}")
    if error is not None:
        lines.append(
            f"\nModel synthesis failed, so this is the retrieved-context fallback: {type(error).__name__}."
        )
    return "\n".join(lines)


def _format_context(context_entries: list[dict[str, Any]]) -> str:
    chunks = []
    for index, entry in enumerate(context_entries, start=1):
        metadata = entry.get("metadata") or {}
        chunks.append(
            "\n".join(
                [
                    f"[{index}] kind={entry.get('kind')} id={entry.get('id')}",
                    f"metadata={json.dumps(metadata, default=str, sort_keys=True)}",
                    str(entry.get("content", "")).strip(),
                ]
            )
        )
    return "\n\n".join(chunks)
