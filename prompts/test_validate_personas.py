from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


PROMPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = PROMPTS_DIR.parent
SCHEMA_PATH = REPO_ROOT / "packages" / "contracts" / "agent_persona.json"

sys.path.insert(0, str(PROMPTS_DIR))

import validate_personas


def load_schema() -> dict[str, Any]:
    with SCHEMA_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def valid_profile() -> dict[str, Any]:
    return {
        "user_id": "3a835ae5-3d9c-4a76-a170-a4c278b2f8b9",
        "display_name": "Jorf",
        "voice": {
            "tone": "Direct, pragmatic, and coordination-focused.",
            "first_person": True,
            "signature_phrases": [
                "Let me ground this in the contract.",
            ],
        },
        "domain": {
            "primary": "Agent runtime prompts",
            "tags": ["agent-runtime", "prompting"],
            "expertise_summary": (
                "Owns the local assistant prompt, request-context tool contract, "
                "and on-demand agent answer template."
            ),
        },
    }


class UserContextProfileSchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        schema = load_schema()
        Draft202012Validator.check_schema(schema)
        self.validator = Draft202012Validator(schema, format_checker=FormatChecker())

    def assert_valid(self, profile: dict[str, Any]) -> None:
        self.assertEqual([], list(self.validator.iter_errors(profile)))

    def assert_invalid(self, profile: dict[str, Any], expected: str) -> None:
        messages = [error.message for error in self.validator.iter_errors(profile)]
        self.assertTrue(
            any(expected in message for message in messages),
            f"Expected an error containing {expected!r}, got: {messages}",
        )

    def test_user_context_profile_accepts_v1_shape(self) -> None:
        self.assertEqual("UserContextProfile", load_schema()["title"])
        self.assert_valid(valid_profile())

    def test_agent_id_is_rejected(self) -> None:
        profile = {**valid_profile(), "agent_id": "55d836df-2efb-4edc-b28c-fea517852e05"}
        self.assert_invalid(profile, "Additional properties")

    def test_collaboration_is_rejected(self) -> None:
        profile = {
            **valid_profile(),
            "collaboration": {
                "handoff_triggers": ["Ask another agent."],
                "suggested_peer_tags": ["routing"],
            },
        }
        self.assert_invalid(profile, "Additional properties")

    def test_handoff_field_is_rejected(self) -> None:
        profile = {**valid_profile(), "handoff": {"suggest": ["someone"]}}
        self.assert_invalid(profile, "Additional properties")

    def test_validator_checks_user_id_and_display_name_uniqueness(self) -> None:
        profiles = [valid_profile(), {**valid_profile()}]
        errors: list[str] = []

        validate_personas.add_unique_value_errors(profiles, "user_id", errors)
        validate_personas.add_unique_value_errors(profiles, "display_name", errors)

        self.assertTrue(any("/user_id" in error for error in errors))
        self.assertTrue(any("/display_name" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
