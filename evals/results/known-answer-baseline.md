# Known-answer baseline — media connections document search

A small, repeatable measurement of document-search behavior against real,
checkable ground truth, built specifically because the project's existing
live eval cases (`media-live.eval.ts`) could not check facts — their own
header says so: *"the corpus is a set of commercial contracts the suite does
not control, so a case cannot know what the right answer says."* This set
can, for the two documents it covers, because the ground truth comes from
outside this project: `golden.json` (syslab-server's own CUAD v1 fixture,
lawyer-annotated) for document-level relevance, and one fact read directly
from `contract_49.pdf`'s actual text for everything else.

This is a starting measurement to optimize against, not a verdict on the
feature. Reproduce it with `evals/run-known-answer.ts`
(`RETRIEVAL_TEST_TENANT=database-agent-integration-test node --env-file=.env.local --import tsx evals/run-known-answer.ts`),
which verifies the tenant's real indexed inventory before running anything
and writes a full per-run JSON (git-ignored — this file is the durable
summary that survives after that JSON is gone).

## Results, from the run persisted this session

15 real runs (5 repeats × 3 cases) against `syslab-default`, all valid — no
rate limiting, no infrastructure failures.

| Case | Dimension | Heuristic (regex) | Reviewed |
| --- | --- | --- | --- |
| `known-para-01-sweeter-deal` | tool choice | 5/5 | not reviewed |
| | retrieval recall (document-level) | 5/5 | not reviewed |
| | citation precision | **1/5** | not reviewed |
| `known-contract-49-mfn-fact` | tool choice | 5/5 | not reviewed |
| | retrieval recall (document-level: `contract_49.pdf`) | 5/5 | not reviewed |
| | **supporting passage retrieved** | **0/5** | — (mechanical, not a judgment) |
| | factual correctness | 3/5 | **0/5 — all "unsupported"** |
| `known-contract-49-escrow-abstention` | tool choice | 5/5 | not reviewed |
| | abstention | 4/5 | not reviewed |

## The finding that matters most: document recall is not passage recall

Every one of the 5 `known-contract-49-mfn-fact` runs retrieved
`contract_49.pdf` — document-level recall looks perfect, 5/5. But **zero**
of those 5 runs' own search calls returned the specific passage containing
Section 3.6 (the actual Most Favored Nation clause the question is about) —
checked directly, mechanically, against each run's real captured passages,
not a separate probe run afterward with different query wording.
`supporting_passage_retrieved` exists as its own dimension specifically to
make this distinction visible: **a file being retrieved proves nothing about
whether the passage that answers the question was.**

The heuristic factual-correctness regex scored this case **3/5**, but a
manual read of all 5 real transcripts found every one of them either denies
the fact outright or hedges as if the contract never addresses it — genuinely
wrong in all 5 cases, three of which merely worded the wrongness in a way the
regex's negation guard didn't catch (a 4-word negation window doesn't reach
across "no explicit mention of whether Aura is *automatically* entitled").
**Reviewed verdict: 0/5 supported.** The model cannot be faulted for failing
to use evidence it was never given — this is a retrieval-recall problem for
this question's real query formulation, not primarily a reasoning problem.

`known-para-01-sweeter-deal` shows the opposite pattern: retrieval recall is
reliable (5/5 — real relevant documents are found), but the delivered
Sources block reliably also names irrelevant ones (`citation_precision`
1/5) — a citation-rendering problem downstream of otherwise-working
retrieval, not a retrieval problem itself.

`known-contract-49-escrow-abstention` is the closest to reliable in this set
(4/5) — the one miss was a real phrasing two independent runs used that the
fixed abstention pattern list didn't originally cover, since fixed since
(now covers "did not return any information about" / "no indication that").
Disclosed as a known, ongoing limitation of any fixed-rule approach rather
than chased indefinitely — a judge is proposed as a supplement for exactly
this gap, never as the primary grade.

## Methodology notes, for anyone re-running this

- **Pre-flight, not optional:** the tenant's real indexed inventory is
  confirmed (exactly 10 files: `contract_01/02/03/04/05/07/08/33/49/52.pdf`)
  via `GET /api/v1/documents` before any case runs. `golden.json` itself
  assumes 52 files; only `para-01`'s full `relevant[]` set is present in the
  real 10, which is why it is the only paraphrase query reused from it.
- **Every `retrieved_passages` value is per-run**, captured from that run's
  own `search_documents` tool call, never a separately-run probe — a probe
  with different query wording, `k`, or timing proves the corpus *can*
  answer, never what a specific run actually saw.
- **`heuristic: true`** on every regex-graded dimension is not decoration —
  the MFN case above is the concrete proof that a passing regex and a
  correct answer are not the same thing. `reviewed_verdict` is the
  authoritative claim-level judgment; it starts `"not_reviewed"` and is only
  ever filled in by someone reading the real transcript, never inferred from
  the regex result.
- **Zero persistent side effects:** the ephemeral media connection each run
  creates is deleted in a `finally` immediately after use; a failed delete
  now fails the run visibly (`cleanupOrThrow`, `evals/harness.ts`) rather
  than being logged and silently left behind, which is how 30 stray rows
  had accumulated in an earlier pass before this was fixed.
- **Fact and passage verification** (the expected fact and its exact
  supporting quote) were read and recorded by Claude directly from
  `contract_49.pdf`'s real text during this implementation pass — not an
  independent domain-expert review. Worth spot-checking before this baseline
  is treated as fully authoritative for anything beyond its own stated scope.

## What this does and does not establish

**Does:** a small, reproducible, self-verifying measurement, with real
per-run evidence, distinguishing four separate failure-capable dimensions
instead of one blended pass rate.

**Does not:** validate SQL-vs-document routing (no database connection
existed to route against in this environment), say anything about INTAJ or
real customer data (100% the shared SEC/CUAD test corpus), or constitute a
full accuracy audit (2 documents, 1 verified fact, 3 questions).
