from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
JORF_CONTRACT_FILES = [
    REPO_ROOT / "prompts" / "agent_system.md",
    REPO_ROOT / "prompts" / "local_assistant_system.md",
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

    def test_retriever_prompt_declares_current_tool_contract(self) -> None:
        root_prompt = (REPO_ROOT / "prompts" / "agent_system.md").read_text(encoding="utf-8")

        self.assertIn("retriever agent", root_prompt)
        self.assertIn("agent_ctx(agent_id, query)", root_prompt)
        self.assertIn("global_ctx(query)", root_prompt)
        self.assertIn("commit_memory_update", root_prompt)
        self.assertIn("context_exchange_id", root_prompt)
        self.assertIsNone(re.search(r"\bglobal_ct\b", root_prompt))
        self.assertNotIn("request_context", root_prompt)
        self.assertNotIn("on-demand", root_prompt.lower())

    def test_local_assistant_uses_retriever_not_request_context(self) -> None:
        local_prompt = (REPO_ROOT / "prompts" / "local_assistant_system.md").read_text(encoding="utf-8")

        self.assertIn("ask_retriever", local_prompt)
        self.assertIn("retriever agent", local_prompt)
        self.assertIn("global_ctx", local_prompt)
        self.assertIsNone(re.search(r"\bglobal_ct\b", local_prompt))
        self.assertNotIn("request_context", local_prompt)


if __name__ == "__main__":
    unittest.main()
