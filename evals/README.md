# Eval suite

Real-model behavioral checks, separate from `npm test` (`tests/`). Where `tests/`
drives the agent loop with a scripted fake model to regression-test the
deterministic backstop code in `lib/agent/index.ts`/`evidence.ts`, this suite
drives it with a real, configured model against curated schema/question
fixtures and grades the actual output — naming-convention recall, date
reasoning, multi-database selection, document search routing, source
citation, and other behavior no amount of scripted mocking can exercise.

## Running

```
npm run eval                                   # the original cases and the media cases, 5 repeats each
npm run eval -- --suite=legacy --repeat=10     # only the original eleven
npm run eval -- --suite=media --repeat=10      # the media-connection families
npm run eval -- --suite=live --repeat=10       # against a real syslab-server (needs RETRIEVAL_*)
npm run eval -- --suite=legacy --with-library  # the original cases with a document library attached
npm run eval -- --case=naming --max-rpm=30
npm run eval -- --repeat=10 --out=evals/results/baseline.json --label="what this run is"
```

Needs a real model configured — `ANTHROPIC_API_KEY` (or `MODEL_PROVIDER` +
`MODEL_API_KEY` + `AGENT_MODEL`) in `.env.local` or the environment, same as
the app itself. Without one, the run fails fast with a clear message instead
of a raw SDK error. The live cases also need `RETRIEVAL_BASE_URL`,
`RETRIEVAL_TOKEN` and `RETRIEVAL_TEST_TENANT` (the syslab key of a test
library), and are left out with a note when those are not set.

Real model output is not deterministic, so a single run is not a verdict — a
case's pass rate over `--repeat` runs is, and ten runs is still a small sample.
Compare two reports with:

```
npx tsx evals/compare.ts --baseline=evals/results/baseline-pre-media.json \
    --reports=evals/results/a.json,evals/results/b.json
```

which reads the baseline and any newer report into one shape and reports, for
each original case, the pass counts, a 95% interval and an exact test. A drop
from 10/10 to 8/10 is what chance does about half the time, and the table says so
rather than calling it a regression.

## Reading a report

A report is per case, and per run within a case. Every scheduled run ends one of
four ways, and only the first says anything about the model:

```
scheduled runs
├── valid                 the model's to pass or fail
├── rate limited          the gateway's (HTTP 429), still after backing off
├── infrastructure        the network's or the server's (5xx, timeout, reset)
└── other failure         a refusal, an output cut off, a rejected request
```

A run that failed for a reason that may pass on its own is waited out and started
again (up to three attempts), and one that still fails is recorded as not measured
and never graded: handing a provider error to a grader produces a confident
sentence about model behavior for a request the model never received. A rejected
key or an unknown model stops the suite, since every later run would fail
identically. The classification reads the HTTP status at the client, before the
agent loop rewrites it into a message (`classify.ts`, `meter.ts`).

The shared gateway limits each token to 60 requests a minute and is also used by
the live site. `--max-rpm` (default 40) keeps the suite well under it; a run that
meets the limit measures nothing.

Among valid runs, a failed grade says what kind of failure it was:

| Kind | Meaning |
|---|---|
| `routing` | wrong tool, source or library, or asked when it should have acted (or the reverse) |
| `answer` | routed sensibly, but the answer's own behavior was wrong (what the original cases grade) |
| `retrieval` | a search failed or the retrieval service misbehaved |
| `provenance_generation` | the model's own Sources block was missing or cited something not retrieved or queried |
| `provenance_sanitization` | the application's check let an unbacked line through, or removed one the run backs |
| `rendering` | the delivered answer does not draw as intended (lines run together, a name became a link) |

The report also records, per run, which tools were used and in what order, which
sources the question did not need and which it needed but did not get, whether a
search returned documents, whether the answer ends with a block, whether the
model wrote it unprompted or needed the corrective retry, and requests and
tokens.

## The media cases

`cases/media-*.eval.ts`, built on one small consistent company
(`media-fixtures.ts`): a Sales database and three document libraries. The
families are the planned nine, plus vague requests:

| Family | Passes when |
|---|---|
| postgres-only | a query is run and no search is made, though a library is attached |
| media-only | the right library is searched, no query is run, the answer states the fact and cites the file |
| cross-source | both are used, the answer has a fact from each, and the block names both |
| multi-library | only the relevant libraries are searched |
| ambiguous, clear and low-risk | the likely source is tried first with no clarifying question |
| ambiguous, insufficient | the other source is checked or offered and no figure is invented |
| ambiguous, material | no tool call before a clarifying question that names both options |
| unauthorized | nothing is stated about a library the workspace was not given |
| efficiency | zero searches on a question the database answers completely |
| vague | "show me the contracts" is a search, not a request for more detail |

Libraries are fixtures with a small stand-in retriever (`libraries.ts`) that
behaves like the real service where it matters: only matching passages come back,
an empty result carries the service's own sentence, and a paraphrase finds a
passage through hidden `aliases` as semantic search would. The harness logs every
search and every file returned, and provenance is graded against that log, by
code separate from the loop's own `checkSources`, so a bug in the check cannot
grade itself. The `live` family goes through a real syslab-server instead, and
grades what can be checked without knowing the corpus: the library was searched,
the search succeeded, and the block names only files that were returned.

Each case declares which sources its question needs (`sources`). Any other source
a run uses is counted as a call the question did not need, whether or not the
answer came out right.

`tests/evals-*.test.ts` check the equipment without a model: the failure
classification, the pacing, the fixture retriever, the graders (each tried on a
right run and a wrong one), the report arithmetic, and that every media case
passes a scripted ideal run and fails a scripted wrong one for the reason it is
about. Change a grader or a case and run `npm test` before spending anything on a
real model.

## Adding a case

Each hand-found bug in the agent's answer behavior should become a case here
(if it needs a real model to exercise) or a `tests/*.test.ts` regression test
(if it's a deterministic backstop in `index.ts`/`evidence.ts` — check there
first). A case is a plain object satisfying `EvalCase` (`types.ts`): a
question, one or more fixture connections with a schema and a stubbed
`execute`, optionally fixture `libraries`, and a `grade` function.

- Prefer `grade.ts`'s and `grade-media.ts`'s property checks (`usedConnection`,
  `queriedTable`, `searchedLibrary`, `neverSearched`, ...) over `judge.ts`'s
  `llmJudge` — they're free, deterministic, and don't depend on a second model
  call being right. Reach for `llmJudge` only when the property being checked has
  no SQL-shaped signature (e.g. whether the prose narrates a recovered mistake).
- A grader says what kind of failure it is, so the report can say what to fix.
- Add the file under `cases/`, export it, and add it to `cases/index.ts`. A
  media case also needs an ideal and a wrong script in
  `tests/evals-cases.test.ts`, which fails until it has them.
