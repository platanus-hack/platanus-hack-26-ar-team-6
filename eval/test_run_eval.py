from __future__ import annotations

import sys
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path


EVAL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(EVAL_DIR))

import run_eval
from _stub_router import route


def make_case(case_id: str = "r_999", category: str = "factual") -> dict[str, object]:
    return {
        "id": case_id,
        "question": "What should this test route?",
        "expected_tiers": ["pool"],
        "expected_agents_any_of": ["<api_owner>"],
        "forbidden_agents": [],
        "must_mention_any_of": ["route"],
        "category": category,
    }


def make_result(
    *,
    precision: float = 1.0,
    recall: float = 1.0,
    tier_match: bool = True,
    forbidden_ok: bool = True,
) -> run_eval.CaseResult:
    return run_eval.CaseResult(
        case_id="r_999",
        category="factual",
        question="What should this test route?",
        expected_tiers=["pool"],
        expected_agents=["<api_owner>"],
        predicted_tiers=["pool"],
        predicted_agents=["<api_owner>"],
        forbidden_agents=[],
        precision=precision,
        recall=recall,
        tier_match=tier_match,
        forbidden_ok=forbidden_ok,
        rationale_mentions_expected=True,
        passed=precision == 1.0 and recall == 1.0 and tier_match and forbidden_ok,
        rationale="test rationale",
    )


class RouterEvalTest(unittest.TestCase):
    def test_suite_passes_when_metrics_and_route_checks_pass(self) -> None:
        self.assertTrue(run_eval.suite_passes([make_result()], 1.0, 1.0))

    def test_suite_fails_when_tier_check_fails_despite_agent_metrics(self) -> None:
        self.assertFalse(run_eval.suite_passes([make_result(tier_match=False)], 1.0, 1.0))

    def test_suite_fails_when_forbidden_check_fails_despite_agent_metrics(self) -> None:
        self.assertFalse(run_eval.suite_passes([make_result(forbidden_ok=False)], 1.0, 1.0))

    def test_validate_case_suite_rejects_wrong_case_count(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly 20"):
            run_eval.validate_case_suite([make_case()], run_eval.PROFILES["v0"])

    def test_validate_case_suite_rejects_duplicate_ids(self) -> None:
        cases = [make_case("r_001") for _ in range(20)]
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            run_eval.validate_case_suite(cases, run_eval.PROFILES["v0"])

    def test_validate_case_suite_accepts_current_yaml_shape(self) -> None:
        cases = run_eval.load_cases()
        self.assertEqual(len(cases), 20)

    def test_current_yaml_uses_task_agent_field_name(self) -> None:
        cases = run_eval.load_yaml(run_eval.CASES_PATH)
        self.assertTrue(all("expected_agents_any_of" in case for case in cases))
        self.assertTrue(all("expected_agents" not in case for case in cases))

    def test_validate_case_suite_accepts_v3_profile_with_30_cases(self) -> None:
        categories = [
            "factual",
            "rationale",
            "status",
            "cross_cutting",
            "out_of_scope",
        ]
        cases = [
            make_case(f"r_{index:03d}", categories[index % len(categories)])
            for index in range(30)
        ]
        run_eval.validate_case_suite(cases, run_eval.PROFILES["v3"])

    def test_task_agent_field_is_canonical(self) -> None:
        self.assertEqual(run_eval.EXPECTED_AGENTS_FIELD, "expected_agents_any_of")
        self.assertEqual(run_eval.LEGACY_EXPECTED_AGENTS_FIELD, "expected_agents")

    def test_validate_case_accepts_legacy_expected_agents(self) -> None:
        case = make_case()
        case["expected_agents"] = case.pop("expected_agents_any_of")
        run_eval.validate_case(case, 1)

    def test_validate_case_rejects_both_agent_fields(self) -> None:
        case = make_case()
        case["expected_agents"] = ["<legacy_owner>"]
        with self.assertRaisesRegex(ValueError, "only one"):
            run_eval.validate_case(case, 1)

    def test_score_case_uses_task_expected_agents_field(self) -> None:
        result = run_eval.score_case(
            make_case(),
            run_eval.RouterDecision(
                tiers=["pool"],
                agents=["<api_owner>"],
                mode="single",
                rationale="route",
            ),
            {},
        )
        self.assertEqual(result.precision, 1.0)
        self.assertEqual(result.recall, 1.0)

    def test_main_reports_validation_error_without_traceback(self) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr):
            exit_code = run_eval.main(["--profile", "v3"])
        self.assertEqual(exit_code, 2)
        self.assertIn("exactly 30", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_stub_rationale_does_not_echo_question_keywords(self) -> None:
        decision = route("How do we deploy to Railway?")
        self.assertNotIn("Railway", decision.rationale)
        self.assertNotIn("deploy", decision.rationale)


if __name__ == "__main__":
    unittest.main()
