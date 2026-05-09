from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
JORF_CONTRACT_FILES = [
    REPO_ROOT / "prompts" / "agent_system.md",
    REPO_ROOT / "prompts" / "local_assistant_system.md",
    REPO_ROOT / "apps" / "server" / "src" / "relevo" / "agents" / "prompts" / "agent_system.md",
    REPO_ROOT / "packages" / "contracts" / "agent_persona.json",
    REPO_ROOT / "prompts" / "validate_personas.py",
]


class StaticContractTest(unittest.TestCase):
    def test_old_prompt_stubs_are_removed(self) -> None:
        self.assertFalse((REPO_ROOT / "prompts" / "router_system.md").exists())
        self.assertFalse((REPO_ROOT / "prompts" / "synthesis_system.md").exists())

    def test_jorf_contract_files_do_not_reference_old_agent_concepts(self) -> None:
        banned_patterns = [
            re.compile(r"\bhandoff\b", re.IGNORECASE),
            re.compile(r"\bpeer agent\b", re.IGNORECASE),
            re.compile(r"\bagent_id\b", re.IGNORECASE),
            re.compile(r"\bperson_id\b", re.IGNORECASE),
            re.compile(r"\bpersonal\s*\|\s*pool\s*\|\s*timeline\b", re.IGNORECASE),
            re.compile(r"\bpersonal-tier\b", re.IGNORECASE),
            re.compile(r"\bpool-tier\b", re.IGNORECASE),
            re.compile(r"\btimeline-tier\b", re.IGNORECASE),
        ]
        violations: list[str] = []

        for path in JORF_CONTRACT_FILES:
            self.assertTrue(path.exists(), f"Expected {path.relative_to(REPO_ROOT)} to exist")
            text = path.read_text(encoding="utf-8")
            for pattern in banned_patterns:
                if pattern.search(text):
                    violations.append(f"{path.relative_to(REPO_ROOT)} matched {pattern.pattern}")

        self.assertEqual([], violations)

    def test_on_demand_prompts_stay_in_sync(self) -> None:
        root_prompt = (REPO_ROOT / "prompts" / "agent_system.md").read_text(encoding="utf-8")
        packaged_prompt = (
            REPO_ROOT / "apps" / "server" / "src" / "relevo" / "agents" / "prompts" / "agent_system.md"
        ).read_text(encoding="utf-8")

        self.assertEqual(root_prompt.strip(), packaged_prompt.strip())
        self.assertIn("retrieved_context_entries", root_prompt)
        self.assertIn("source_user_ids", root_prompt)
        self.assertIn("insufficient_context", root_prompt)


if __name__ == "__main__":
    unittest.main()
