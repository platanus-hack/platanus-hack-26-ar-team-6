# Router Eval Harness

This directory contains the V0 router eval harness for Jerf. It grades router
decisions against hand-authored cases before the real router exists.

## Run

```bash
python eval/run_eval.py
```

If `PyYAML` is not installed in your active Python environment, install the
repo's Python dependencies first:

```bash
python -m pip install -e apps/server
```

Use `--profile v3` once the eval file expands to 30 cases:

```bash
python eval/run_eval.py --profile v3
```

The V0 runner imports `eval/_stub_router.py`. The stub is intentionally bad and
always routes to the same tier and agent, so the command should run, write a
report, and exit nonzero until a real router is wired in later versions.

Reports are written to:

```text
eval/reports/<timestamp>.md
```

## Case Schema

Add cases to `eval/router_cases.yaml` with this shape:

```yaml
- id: r_001
  question: "How do we deploy the backend?"
  expected_tiers: ["pool", "personal"]
  expected_agents_any_of: ["<infra_owner>", "<api_owner>"]
  forbidden_agents: ["<frontend_owner>"]
  must_mention_any_of: ["deploy", "Railway", "health"]
  category: factual
```

Fields:

- `id`: stable case identifier.
- `question`: user-facing question to route.
- `expected_tiers`: memory tiers the router should consider. Use an empty list
  for out-of-scope cases.
- `expected_agents_any_of`: expected agent placeholder set. In V0 these are
  placeholders; later `agent_directory.yaml` can resolve them to real IDs.
- `forbidden_agents`: agents that must not be selected.
- `must_mention_any_of`: diagnostic terms expected in router rationale. These
  are reported but do not affect the V0 precision/recall gate.
- `category`: one of `factual`, `rationale`, `status`, `cross_cutting`, or
  `out_of_scope`.

`expected_agents` is accepted as a legacy alias, but new cases should use
`expected_agents_any_of` to match `task.md` and `plan.md`.

Profiles:

- `v0`: exactly 20 cases, with 6 factual, 5 rationale, 4 status, 3
  cross-cutting, and 2 out-of-scope.
- `v3`: exactly 30 cases, with every category represented.

## Agent Directory

`eval/agent_directory.yaml` maps placeholder names to real agent IDs. During V0
all values are `null`, and the runner warns without failing. Once Jorf lands the
seeded personas, replace `null` with the real IDs.

## Scoring

Per case:

- Agent precision = correct predicted agents / predicted agents.
- Agent recall = correct predicted agents / expected agents.
- Tier match passes when at least one expected tier is predicted.
- Out-of-scope tier match passes only when no tiers are predicted.
- Forbidden check passes when no forbidden agent is predicted.

Aggregate pass bar:

- Macro precision must be at least `0.80`.
- Macro recall must be at least `0.85`.
- Every case must pass tier matching and forbidden-agent checks.

The V0 stub should fail those bars. That failure is useful: it proves the
harness can catch poor routing before the real router lands.

## Tests

```bash
python -m unittest eval/test_run_eval.py
```

The tests cover suite pass/fail behavior, V0 case-shape validation, and the stub
rationale diagnostic.
