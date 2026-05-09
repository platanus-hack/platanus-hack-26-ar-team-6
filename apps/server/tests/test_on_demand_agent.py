from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


from relevo.agents.on_demand import (  # noqa: E402
    ContextSliceEntry,
    ContextSliceTarget,
    OnDemandAgentError,
    OnDemandContextSlice,
    answer_on_demand,
    build_agent_prompt,
    load_agent_system_prompt,
)


TARGET_USER_ID = "11111111-1111-4111-8111-111111111111"
ENTRY_ID = "22222222-2222-4222-8222-222222222222"


class FakeMessages:
    def __init__(self, text: str) -> None:
        self.text = text
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            content=[
                SimpleNamespace(
                    type="text",
                    text=self.text,
                )
            ]
        )


class FakeClient:
    def __init__(self, text: str) -> None:
        self.messages = FakeMessages(text)


class FailingMessages:
    def create(self, **kwargs):
        raise RuntimeError("network down")


class FailingClient:
    def __init__(self) -> None:
        self.messages = FailingMessages()


def make_context_slice(entries: list[ContextSliceEntry] | None = None) -> OnDemandContextSlice:
    return OnDemandContextSlice(
        target=ContextSliceTarget(
            id=TARGET_USER_ID,
            display_name="User2 (Deployment)",
            domain_summary="Server, API, hosting, and auth.",
            profile={
                "voice": {
                    "tone": "precise about endpoint shapes",
                    "first_person": True,
                },
                "domain": {
                    "primary": "deployment",
                    "tags": ["server", "railway"],
                    "expertise_summary": "Owns FastAPI deployment and server API contracts.",
                },
            },
        ),
        entries=entries
        if entries is not None
        else [
            ContextSliceEntry(
                id=ENTRY_ID,
                user_id=TARGET_USER_ID,
                kind="seed",
                content="The shared server is FastAPI, deployed to Railway.",
                metadata={"tags": ["deployment", "railway"]},
            )
        ],
    )


class OnDemandAgentTest(unittest.TestCase):
    def test_build_agent_prompt_includes_target_question_and_chunks(self) -> None:
        prompt = build_agent_prompt(make_context_slice(), "Where is the server deployed?")

        self.assertIn("User2 (Deployment)", prompt)
        self.assertIn("Where is the server deployed?", prompt)
        self.assertIn(ENTRY_ID, prompt)
        self.assertIn("The shared server is FastAPI, deployed to Railway.", prompt)

        lowered = prompt.lower()
        self.assertNotIn("handoff", lowered)
        self.assertNotIn("peer agent", lowered)
        self.assertNotIn("personal|pool|timeline", lowered)

    def test_build_agent_prompt_serializes_created_at_values(self) -> None:
        context_slice = make_context_slice(
            entries=[
                ContextSliceEntry(
                    id=ENTRY_ID,
                    user_id=TARGET_USER_ID,
                    kind="seed",
                    content="Railway owns the demo deployment.",
                    metadata={},
                    created_at=datetime(2026, 5, 9, tzinfo=timezone.utc),
                )
            ]
        )

        prompt = build_agent_prompt(context_slice, "Who owns deployment?")

        self.assertIn("2026-05-09 00:00:00+00:00", prompt)

    def test_root_and_packaged_prompts_are_on_demand_prompt(self) -> None:
        root_prompt = (REPO_ROOT / "prompts" / "agent_system.md").read_text(encoding="utf-8")
        packaged_prompt = load_agent_system_prompt()

        self.assertEqual(root_prompt.strip(), packaged_prompt.strip())
        self.assertIn("on-demand context answer", packaged_prompt.lower())
        self.assertNotIn("handoff", packaged_prompt.lower())

    def test_answer_on_demand_calls_anthropic_and_parses_json(self) -> None:
        client = FakeClient(
            json.dumps(
                {
                    "answer": f"The server is deployed to Railway. [{ENTRY_ID}]",
                    "source_user_ids": [],
                    "citations": [
                        {
                            "claim": "The server is deployed to Railway.",
                            "context_entry_id": ENTRY_ID,
                        }
                    ],
                    "confidence": 0.82,
                    "insufficient_context": False,
                }
            )
        )

        answer = answer_on_demand(
            make_context_slice(),
            "Where is the server deployed?",
            client=client,
        )

        self.assertEqual(answer.answer, f"The server is deployed to Railway. [{ENTRY_ID}]")
        self.assertEqual(answer.source_user_ids, [TARGET_USER_ID])
        self.assertEqual(answer.citations[0].context_entry_id, ENTRY_ID)
        self.assertEqual(answer.confidence, 0.82)
        self.assertFalse(answer.insufficient_context)

        call = client.messages.calls[0]
        self.assertEqual(call["model"], "claude-sonnet-4-6")
        self.assertEqual(call["max_tokens"], 1200)
        self.assertEqual(call["temperature"], 0)
        self.assertIn("system", call)
        self.assertEqual(call["messages"], [{"role": "user", "content": "Where is the server deployed?"}])

    def test_empty_context_slice_returns_insufficient_context_without_llm_call(self) -> None:
        client = FakeClient("{}")

        answer = answer_on_demand(
            make_context_slice(entries=[]),
            "Where is the server deployed?",
            client=client,
        )

        self.assertTrue(answer.insufficient_context)
        self.assertEqual(answer.source_user_ids, [TARGET_USER_ID])
        self.assertEqual(client.messages.calls, [])

    def test_invalid_model_json_raises_clear_agent_error(self) -> None:
        client = FakeClient("not json")

        with self.assertRaisesRegex(OnDemandAgentError, "valid JSON"):
            answer_on_demand(
                make_context_slice(),
                "Where is the server deployed?",
                client=client,
            )

    def test_client_call_failure_raises_clear_agent_error(self) -> None:
        with self.assertRaisesRegex(OnDemandAgentError, "call failed"):
            answer_on_demand(
                make_context_slice(),
                "Where is the server deployed?",
                client=FailingClient(),
            )


if __name__ == "__main__":
    unittest.main()
