#!/usr/bin/env python3
"""Validate seeded user context profiles against the shared JSON Schema."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
    from jsonschema import Draft202012Validator, FormatChecker
    from jsonschema.exceptions import ValidationError
except ModuleNotFoundError as error:
    print(
        "Missing Python dependency for profile validation. "
        "Install PyYAML and jsonschema, then rerun python3 prompts/validate_personas.py. "
        f"Original error: {error}",
        file=sys.stderr,
    )
    raise SystemExit(2) from error


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "packages" / "contracts" / "agent_persona.json"
PROFILES_PATH = REPO_ROOT / "seeds" / "personas.yaml"


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def format_error(label: str, error: ValidationError) -> str:
    schema_path = "/".join(str(part) for part in error.absolute_schema_path)
    instance_path = "/".join(str(part) for part in error.absolute_path)
    location = label
    if instance_path:
        location = f"{location}/{instance_path}"
    if schema_path:
        return f"{location}: {error.message} (schema: {schema_path})"
    return f"{location}: {error.message}"


def add_unique_value_errors(profiles: list[Any], field: str, errors: list[str]) -> None:
    seen: dict[str, int] = {}
    for index, profile in enumerate(profiles):
        if not isinstance(profile, dict):
            continue
        value = profile.get(field)
        if not isinstance(value, str):
            continue
        key = value.strip().lower()
        if key in seen:
            errors.append(f"profiles[{index}]/{field}: duplicates profiles[{seen[key]}]/{field}")
        else:
            seen[key] = index


def main() -> int:
    schema = load_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)

    profiles = load_yaml(PROFILES_PATH)

    if not isinstance(profiles, list):
        print(f"{PROFILES_PATH}: expected a top-level YAML list of profiles", file=sys.stderr)
        return 1
    if not profiles:
        print(f"{PROFILES_PATH}: expected at least one profile", file=sys.stderr)
        return 1

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []

    for index, profile in enumerate(profiles):
        profile_errors = sorted(
            validator.iter_errors(profile),
            key=lambda error: list(error.absolute_path),
        )
        errors.extend(format_error(f"profiles[{index}]", error) for error in profile_errors)

    add_unique_value_errors(profiles, "user_id", errors)
    add_unique_value_errors(profiles, "display_name", errors)

    examples = schema.get("examples", [])
    if not isinstance(examples, list):
        errors.append("schema/examples: expected a list")
    else:
        for index, example in enumerate(examples):
            example_errors = sorted(
                validator.iter_errors(example),
                key=lambda error: list(error.absolute_path),
            )
            errors.extend(format_error(f"schema/examples[{index}]", error) for error in example_errors)

    if errors:
        print("Profile validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Validated {len(profiles)} profile(s) against {SCHEMA_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
