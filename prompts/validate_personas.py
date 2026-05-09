#!/usr/bin/env python3
"""Validate seeded agent personas against the shared JSON Schema contract."""

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
        "Missing Python dependency for persona validation. "
        "Install PyYAML and jsonschema, then rerun python3 prompts/validate_personas.py. "
        f"Original error: {error}",
        file=sys.stderr,
    )
    raise SystemExit(2) from error


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "packages" / "contracts" / "agent_persona.json"
PERSONAS_PATH = REPO_ROOT / "seeds" / "personas.yaml"


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


def add_unique_value_errors(personas: list[Any], field: str, errors: list[str]) -> None:
    seen: dict[str, int] = {}
    for index, persona in enumerate(personas):
        if not isinstance(persona, dict):
            continue
        value = persona.get(field)
        if not isinstance(value, str):
            continue
        key = value.strip().lower()
        if key in seen:
            errors.append(f"personas[{index}]/{field}: duplicates personas[{seen[key]}]/{field}")
        else:
            seen[key] = index


def main() -> int:
    schema = load_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)

    personas = load_yaml(PERSONAS_PATH)

    if not isinstance(personas, list):
        print(f"{PERSONAS_PATH}: expected a top-level YAML list of personas", file=sys.stderr)
        return 1
    if not personas:
        print(f"{PERSONAS_PATH}: expected at least one persona", file=sys.stderr)
        return 1

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []

    for index, persona in enumerate(personas):
        persona_errors = sorted(
            validator.iter_errors(persona),
            key=lambda error: list(error.absolute_path),
        )
        errors.extend(format_error(f"personas[{index}]", error) for error in persona_errors)

    add_unique_value_errors(personas, "agent_id", errors)
    add_unique_value_errors(personas, "person_id", errors)
    add_unique_value_errors(personas, "display_name", errors)

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
        print("Persona validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Validated {len(personas)} persona(s) against {SCHEMA_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
