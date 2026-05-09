from __future__ import annotations

import sys
from argparse import ArgumentParser, Namespace
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from _stub_router import RouterDecision, route


PASS_PRECISION = 0.80
PASS_RECALL = 0.85
ALLOWED_TIERS = {"pool", "personal", "timeline"}
ALLOWED_CATEGORIES = {"factual", "rationale", "status", "cross_cutting", "out_of_scope"}
EXPECTED_AGENTS_FIELD = "expected_agents_any_of"
LEGACY_EXPECTED_AGENTS_FIELD = "expected_agents"
REQUIRED_FIELDS = {
    "id",
    "question",
    "expected_tiers",
    "forbidden_agents",
    "must_mention_any_of",
    "category",
}
ROOT = Path(__file__).resolve().parent
CASES_PATH = ROOT / "router_cases.yaml"
AGENT_DIRECTORY_PATH = ROOT / "agent_directory.yaml"
REPORTS_DIR = ROOT / "reports"


@dataclass(frozen=True)
class EvalProfile:
    name: str
    expected_case_count: int
    expected_category_counts: dict[str, int] | None = None
    require_all_categories: bool = True


PROFILES = {
    "v0": EvalProfile(
        name="v0",
        expected_case_count=20,
        expected_category_counts={
            "factual": 6,
            "rationale": 5,
            "status": 4,
            "cross_cutting": 3,
            "out_of_scope": 2,
        },
    ),
    "v3": EvalProfile(name="v3", expected_case_count=30),
}
DEFAULT_PROFILE = "v0"


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    category: str
    question: str
    expected_tiers: list[str]
    expected_agents: list[str]
    predicted_tiers: list[str]
    predicted_agents: list[str]
    forbidden_agents: list[str]
    precision: float
    recall: float
    tier_match: bool
    forbidden_ok: bool
    rationale_mentions_expected: bool
    passed: bool
    rationale: str


def load_yaml(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Missing eval input: {path}")

    with path.open("r", encoding="utf-8") as file:
        return yaml.safe_load(file) or {}


def as_string_list(value: Any, field_name: str, case_id: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{case_id}: {field_name} must be a list")
    if not all(isinstance(item, str) for item in value):
        raise ValueError(f"{case_id}: {field_name} must contain only strings")
    return value


def expected_agents_for_case(case: dict[str, Any], case_id: str) -> list[str]:
    has_current = EXPECTED_AGENTS_FIELD in case
    has_legacy = LEGACY_EXPECTED_AGENTS_FIELD in case
    if has_current and has_legacy:
        raise ValueError(
            f"{case_id}: use only one of {EXPECTED_AGENTS_FIELD} "
            f"or {LEGACY_EXPECTED_AGENTS_FIELD}"
        )
    if not has_current and not has_legacy:
        raise ValueError(f"{case_id}: missing ['{EXPECTED_AGENTS_FIELD}']")

    field_name = EXPECTED_AGENTS_FIELD if has_current else LEGACY_EXPECTED_AGENTS_FIELD
    return as_string_list(case[field_name], field_name, case_id)


def validate_case(case: dict[str, Any], index: int) -> None:
    missing = sorted(REQUIRED_FIELDS - set(case))
    if missing:
        raise ValueError(f"{case.get('id', f'case #{index}')}: missing {missing}")

    case_id = str(case["id"])
    if not case_id:
        raise ValueError(f"Case #{index}: id must not be empty")
    if not isinstance(case["question"], str) or not case["question"]:
        raise ValueError(f"{case_id}: question must be a non-empty string")

    expected_tiers = as_string_list(case["expected_tiers"], "expected_tiers", case_id)
    unknown_tiers = sorted(set(expected_tiers) - ALLOWED_TIERS)
    if unknown_tiers:
        raise ValueError(f"{case_id}: unknown expected_tiers {unknown_tiers}")

    expected_agents_for_case(case, case_id)
    as_string_list(case["forbidden_agents"], "forbidden_agents", case_id)
    as_string_list(case["must_mention_any_of"], "must_mention_any_of", case_id)

    category = case["category"]
    if category not in ALLOWED_CATEGORIES:
        raise ValueError(f"{case_id}: unknown category {category!r}")


def validate_case_suite(cases: list[dict[str, Any]], profile: EvalProfile) -> None:
    if len(cases) != profile.expected_case_count:
        raise ValueError(
            f"router_cases.yaml must contain exactly {profile.expected_case_count} "
            f"cases for profile {profile.name}"
        )

    seen_ids: set[str] = set()
    category_counts: Counter[str] = Counter()
    for index, case in enumerate(cases, start=1):
        if not isinstance(case, dict):
            raise ValueError(f"Case #{index} must be a mapping")
        validate_case(case, index)
        case_id = str(case["id"])
        if case_id in seen_ids:
            raise ValueError(f"Duplicate case id: {case_id}")
        seen_ids.add(case_id)
        category_counts[str(case["category"])] += 1

    if profile.expected_category_counts is not None:
        expected_counts = Counter(profile.expected_category_counts)
        if category_counts != expected_counts:
            raise ValueError(
                "router_cases.yaml category spread must be "
                f"{profile.expected_category_counts}, got {dict(category_counts)}"
            )
    elif profile.require_all_categories:
        missing_categories = sorted(ALLOWED_CATEGORIES - set(category_counts))
        if missing_categories:
            raise ValueError(
                f"router_cases.yaml is missing categories for profile {profile.name}: "
                f"{missing_categories}"
            )


def load_cases(profile: EvalProfile = PROFILES[DEFAULT_PROFILE]) -> list[dict[str, Any]]:
    cases = load_yaml(CASES_PATH)
    if not isinstance(cases, list):
        raise ValueError(f"{CASES_PATH} must contain a YAML list")

    validate_case_suite(cases, profile)
    return cases


def load_agent_directory() -> dict[str, str | None]:
    raw_directory = load_yaml(AGENT_DIRECTORY_PATH)
    if not isinstance(raw_directory, dict):
        raise ValueError(f"{AGENT_DIRECTORY_PATH} must contain a YAML mapping")

    directory: dict[str, str | None] = {}
    for placeholder, agent_id in raw_directory.items():
        if not isinstance(placeholder, str):
            raise ValueError("agent_directory.yaml keys must be strings")
        if agent_id is not None and not isinstance(agent_id, str):
            raise ValueError(f"{placeholder}: mapped agent id must be a string or null")
        directory[placeholder] = agent_id
    return directory


def referenced_placeholders(cases: list[dict[str, Any]]) -> set[str]:
    placeholders: set[str] = set()
    for case in cases:
        case_id = str(case.get("id", "unknown"))
        agent_lists = [
            expected_agents_for_case(case, case_id),
            as_string_list(case["forbidden_agents"], "forbidden_agents", case_id),
        ]
        for agents in agent_lists:
            placeholders.update(
                agent
                for agent in agents
                if agent.startswith("<") and agent.endswith(">")
            )
    return placeholders


def warn_for_unresolved_placeholders(
    cases: list[dict[str, Any]], directory: dict[str, str | None]
) -> list[str]:
    warnings: list[str] = []
    for placeholder in sorted(referenced_placeholders(cases)):
        if placeholder not in directory:
            warnings.append(f"{placeholder} is referenced by cases but missing from agent_directory.yaml")
        elif directory[placeholder] is None:
            warnings.append(f"{placeholder} is unresolved in agent_directory.yaml")
    return warnings


def resolve_agents(agents: list[str], directory: dict[str, str | None]) -> list[str]:
    return [directory.get(agent) or agent for agent in agents]


def agent_precision(expected_agents: list[str], predicted_agents: list[str]) -> float:
    if not predicted_agents:
        return 1.0 if not expected_agents else 0.0
    correct = len(set(expected_agents) & set(predicted_agents))
    return correct / len(set(predicted_agents))


def agent_recall(expected_agents: list[str], predicted_agents: list[str]) -> float:
    if not expected_agents:
        return 1.0 if not predicted_agents else 0.0
    correct = len(set(expected_agents) & set(predicted_agents))
    return correct / len(set(expected_agents))


def tiers_match(expected_tiers: list[str], predicted_tiers: list[str]) -> bool:
    if not expected_tiers:
        return not predicted_tiers
    return bool(set(expected_tiers) & set(predicted_tiers))


def rationale_mentions_any(rationale: str, expected_terms: list[str]) -> bool:
    if not expected_terms:
        return True
    normalized_rationale = rationale.lower()
    return any(term.lower() in normalized_rationale for term in expected_terms)


def score_case(case: dict[str, Any], decision: RouterDecision, directory: dict[str, str | None]) -> CaseResult:
    case_id = str(case["id"])
    expected_tiers = as_string_list(case["expected_tiers"], "expected_tiers", case_id)
    expected_agents = resolve_agents(
        expected_agents_for_case(case, case_id),
        directory,
    )
    forbidden_agents = resolve_agents(
        as_string_list(case["forbidden_agents"], "forbidden_agents", case_id),
        directory,
    )
    predicted_tiers = list(decision.tiers)
    predicted_agents = list(decision.agents)
    precision = agent_precision(expected_agents, predicted_agents)
    recall = agent_recall(expected_agents, predicted_agents)
    tier_ok = tiers_match(expected_tiers, predicted_tiers)
    forbidden_ok = not (set(predicted_agents) & set(forbidden_agents))
    rationale_ok = rationale_mentions_any(
        decision.rationale,
        as_string_list(case["must_mention_any_of"], "must_mention_any_of", case_id),
    )
    passed = precision == 1.0 and recall == 1.0 and tier_ok and forbidden_ok

    return CaseResult(
        case_id=case_id,
        category=str(case["category"]),
        question=str(case["question"]),
        expected_tiers=expected_tiers,
        expected_agents=expected_agents,
        predicted_tiers=predicted_tiers,
        predicted_agents=predicted_agents,
        forbidden_agents=forbidden_agents,
        precision=precision,
        recall=recall,
        tier_match=tier_ok,
        forbidden_ok=forbidden_ok,
        rationale_mentions_expected=rationale_ok,
        passed=passed,
        rationale=decision.rationale,
    )


def average(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def category_breakdown(results: list[CaseResult]) -> dict[str, dict[str, float]]:
    categories = sorted({result.category for result in results})
    breakdown: dict[str, dict[str, float]] = {}
    for category in categories:
        category_results = [result for result in results if result.category == category]
        breakdown[category] = {
            "cases": float(len(category_results)),
            "passed": float(sum(1 for result in category_results if result.passed)),
            "precision": average([result.precision for result in category_results]),
            "recall": average([result.recall for result in category_results]),
        }
    return breakdown


def route_checks_pass(results: list[CaseResult]) -> bool:
    return all(result.tier_match and result.forbidden_ok for result in results)


def suite_passes(results: list[CaseResult], macro_precision: float, macro_recall: float) -> bool:
    return (
        macro_precision >= PASS_PRECISION
        and macro_recall >= PASS_RECALL
        and route_checks_pass(results)
    )


def format_bool(value: bool) -> str:
    return "yes" if value else "no"


def render_report(
    results: list[CaseResult],
    warnings: list[str],
    macro_precision: float,
    macro_recall: float,
    passed: bool,
    profile: EvalProfile,
) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    all_tiers_match = all(result.tier_match for result in results)
    all_forbidden_ok = all(result.forbidden_ok for result in results)
    lines = [
        "# Router Eval Report",
        "",
        f"Generated: {timestamp}",
        "",
        "## Summary",
        "",
        f"- Profile: {profile.name}",
        f"- Cases: {len(results)}",
        f"- Macro precision: {macro_precision:.3f}",
        f"- Macro recall: {macro_recall:.3f}",
        f"- Tier checks: {'PASS' if all_tiers_match else 'FAIL'}",
        f"- Forbidden checks: {'PASS' if all_forbidden_ok else 'FAIL'}",
        f"- Pass bar: precision >= {PASS_PRECISION:.2f}, recall >= {PASS_RECALL:.2f}, all tier and forbidden checks pass",
        f"- Status: {'PASS' if passed else 'FAIL'}",
        "",
    ]

    if warnings:
        lines.extend(["## Warnings", ""])
        lines.extend(f"- {warning}" for warning in warnings)
        lines.append("")

    lines.extend(
        [
            "## Category Breakdown",
            "",
            "| Category | Cases | Passed | Precision | Recall |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    for category, values in category_breakdown(results).items():
        lines.append(
            "| "
            f"{category} | {int(values['cases'])} | {int(values['passed'])} | "
            f"{values['precision']:.3f} | {values['recall']:.3f} |"
        )

    lines.extend(
        [
            "",
            "## Cases",
            "",
            "| ID | Category | Pass | Precision | Recall | Tier Match | Forbidden OK | Rationale Mentions |",
            "|---|---|---|---:|---:|---|---|---|",
        ]
    )
    for result in results:
        lines.append(
            "| "
            f"{result.case_id} | {result.category} | {format_bool(result.passed)} | "
            f"{result.precision:.3f} | {result.recall:.3f} | "
            f"{format_bool(result.tier_match)} | {format_bool(result.forbidden_ok)} | "
            f"{format_bool(result.rationale_mentions_expected)} |"
        )

    lines.extend(["", "## Case Details", ""])
    for result in results:
        lines.extend(
            [
                f"### {result.case_id}: {result.question}",
                "",
                f"- Expected tiers: {result.expected_tiers}",
                f"- Predicted tiers: {result.predicted_tiers}",
                f"- Expected agents: {result.expected_agents}",
                f"- Predicted agents: {result.predicted_agents}",
                f"- Forbidden agents: {result.forbidden_agents}",
                f"- Rationale: {result.rationale}",
                "",
            ]
        )

    return "\n".join(lines)


def print_console_report(
    results: list[CaseResult],
    warnings: list[str],
    macro_precision: float,
    macro_recall: float,
    report_path: Path,
    passed: bool,
    profile: EvalProfile,
) -> None:
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)

    print("Router eval")
    print(f"profile: {profile.name}")
    print(f"cases: {len(results)}")
    print(f"macro_precision: {macro_precision:.3f}")
    print(f"macro_recall: {macro_recall:.3f}")
    print(f"tier_checks: {'PASS' if all(result.tier_match for result in results) else 'FAIL'}")
    print(f"forbidden_checks: {'PASS' if all(result.forbidden_ok for result in results) else 'FAIL'}")
    print(
        f"pass_bar: precision >= {PASS_PRECISION:.2f}, "
        f"recall >= {PASS_RECALL:.2f}, all tier and forbidden checks pass"
    )
    print("")
    print("Category breakdown:")
    for category, values in category_breakdown(results).items():
        print(
            f"- {category}: "
            f"{int(values['passed'])}/{int(values['cases'])} passed, "
            f"precision={values['precision']:.3f}, "
            f"recall={values['recall']:.3f}"
        )
    print("")
    print(f"report: {report_path}")
    print("status: PASS" if passed else "status: FAIL")


def write_report(content: str) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = REPORTS_DIR / f"{timestamp}.md"
    report_path.write_text(content, encoding="utf-8")
    return report_path


def parse_args(argv: list[str] | None = None) -> Namespace:
    parser = ArgumentParser(description="Run router eval cases against the configured router.")
    parser.add_argument(
        "--profile",
        choices=sorted(PROFILES),
        default=DEFAULT_PROFILE,
        help="Eval profile to validate against. Defaults to v0.",
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    profile = PROFILES[args.profile]
    cases = load_cases(profile)
    directory = load_agent_directory()
    warnings = warn_for_unresolved_placeholders(cases, directory)
    results = [
        score_case(case, route(str(case["question"])), directory)
        for case in cases
    ]
    macro_precision = average([result.precision for result in results])
    macro_recall = average([result.recall for result in results])
    passed = suite_passes(results, macro_precision, macro_recall)
    report_content = render_report(results, warnings, macro_precision, macro_recall, passed, profile)
    report_path = write_report(report_content)
    print_console_report(results, warnings, macro_precision, macro_recall, report_path, passed, profile)
    return 0 if passed else 1


def main(argv: list[str] | None = None) -> int:
    try:
        return run(argv)
    except (FileNotFoundError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
