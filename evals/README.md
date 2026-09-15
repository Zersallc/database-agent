# Eval suite

Real-model behavioral checks, separate from `npm test` (`tests/`). Where `tests/`
drives the agent loop with a scripted fake model to regression-test the
deterministic backstop code in `lib/agent/index.ts`/`evidence.ts`, this suite
drives it with a real, configured model against curated schema/question
fixtures and grades the actual output — naming-convention recall, date
reasoning, multi-database selection, and other behavior no amount of scripted
mocking can exercise.

## Running

```
npm run eval                          # every case, 5 repeats each
npm run eval -- --case=naming         # only cases whose id contains "naming"
npm run eval -- --repeat=10 --out=evals/results/baseline.json
```

Needs a real model configured — `ANTHROPIC_API_KEY` (or `MODEL_PROVIDER` +
`MODEL_API_KEY` + `AGENT_MODEL`) in `.env.local` or the environment, same as
the app itself. Without one, the run fails fast with a clear message instead
of a raw SDK error.

Real model output is not deterministic, so a single run is not a verdict — a
case's `passRate` over `--repeat` runs is. Before or after a prompt change
(most importantly the schema-pruning work discussed for scaling to many
tables per connection), run with `--out` to two files and diff the pass
rates — the `naming-*` cases are where a recall regression shows up first.

## Adding a case

Each hand-found bug in the agent's answer behavior should become a case here
(if it needs a real model to exercise) or a `tests/*.test.ts` regression test
(if it's a deterministic backstop in `index.ts`/`evidence.ts` — check there
first). A case is a plain object satisfying `EvalCase` (`types.ts`): a
question, one or more fixture connections with a schema and a stubbed
`execute`, and a `grade` function.

- Prefer `grade.ts`'s property checks (`usedConnection`, `queriedTable`,
  `sqlMatchedBy`, ...) over `judge.ts`'s `llmJudge` — they're free,
  deterministic, and don't depend on a second model call being right. Reach
  for `llmJudge` only when the property being checked has no SQL-shaped
  signature (e.g. whether the prose narrates a recovered mistake).
- Add the file under `cases/`, export it, and add it to `cases/index.ts`.
