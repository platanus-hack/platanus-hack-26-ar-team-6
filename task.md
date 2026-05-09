# V1 - Jerf: retrieval eval cases and runner support

Owner: Jerf
Branch: `v1/jerf`
Target: V1 converge

## Goal

Add the eval gate for Sarf's V1 retrieval work. The team needs a small but real
set of questions that prove the memory layer can return the right personal
memories in the top five results.

## What to build

- Add 20 retrieval eval cases shaped roughly as:
  - `id`
  - `question`
  - `expected_memory_ids`
  - optional category/notes fields if useful
- Extend or add an eval runner that calls the V1 retrieval boundary and reports
  top-5 recall.
- Target top-5 recall `>= 0.7` for V1.
- Keep the existing router eval harness intact; retrieval evals should be
  separate enough that router stub failure remains expected.
- Make reports easy to read during converge.

## Coordination notes

- Sarf owns the memory ids and retrieval function shape. Align with Sarf before
  freezing the case file.
- Jorf needs citation-friendly memory ids, so eval cases should use the same ids
  the answer pipeline will see.
- If live DB retrieval is not ready at first, make the runner's dependency seam
  obvious so it can run against a stub and then the real repository.

## Definition of done

- 20 retrieval cases are committed with stable expected memory ids.
- The retrieval eval runner prints aggregate top-5 recall and exits nonzero when
  below `0.7`.
- Add tests for case validation, recall scoring, and failure exit behavior.
- Document the retrieval eval command in `eval/README.md` or this PR's notes.
