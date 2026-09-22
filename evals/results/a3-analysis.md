# A3 analysis report

Generated 2026-09-21T13:30:00Z.

> **Status: measurements only.** This report shows what the evaluation recorded. It reaches no verdict on the evaluation, and every assessment line is TBD until an engineer reviews it. Results that do not exist yet are marked TBD.

## Results this report reads

| role | result | state | file | commit | model | ran at (UTC) | scheduled / valid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline_a0 | A0 baseline: the original eleven cases on main before any media change | loaded | evals/results/baseline-pre-media.json | aac16b2 | syslab-default | 2026-09-21 07:12:38 | 110 / 110 |
| legacy_database_only | A2/A2b database-only: the original eleven cases, no library attached | loaded | evals/results/a3-legacy-dbonly.json | 46ee7ff | syslab-default | 2026-09-21 11:54:51 | 110 / 110 |
| legacy_with_library | Database plus library: the original eleven cases with a document library attached | loaded | evals/results/a3-legacy-with-library.json | 46ee7ff | syslab-default | 2026-09-21 12:02:00 | 110 / 110 |
| media_pass_1 | Media families, first pass | loaded | evals/results/a3-media.json | 46ee7ff | syslab-default | 2026-09-21 12:09:55 | 240 / 240 |
| media_pass_2 | Media families, second pass | loaded | evals/results/a3-media-run2.json | 46ee7ff | syslab-default | 2026-09-21 12:25:15 | 240 / 240 |
| live | Live retrieval against a real syslab-server tenant | loaded | evals/results/a3-live.json | 46ee7ff | syslab-default | 2026-09-21 12:22:10 | 40 / 40 |
| control_no_database | Control: no database attached | loaded | evals/results/a3-control-no-database.json | 46ee7ff | syslab-default | 2026-09-21 12:37:14 | 40 / 40 |
| control_relevant_library | Control: only the relevant libraries attached | loaded | evals/results/a3-control-relevant-library.json | 46ee7ff | syslab-default | 2026-09-21 12:38:59 | 30 / 30 |
| control_no_library | Control: no library attached | loaded | evals/results/a3-control-no-library.json | 46ee7ff | syslab-default | 2026-09-21 12:40:35 | 60 / 60 |

Notes on how results were produced:

- **media_pass_1:** Graded before the provenance grader stopped demanding citations of files the run never retrieved; see the register.

## How to read it

- Only **valid** runs count in any rate. A run the gateway turned away, or that failed for another reason, is in the accounting (Q11) and in no percentage.
- A failed run has **one primary cause**: routing, then retrieval, provenance generation, provenance sanitization, rendering, and the answer's own content last. The earliest link in the chain is charged, so one mistake is not counted three times.
- Nothing is inferred from data a result does not have. The A0 baseline has no run-level detail, so tool, source, provenance and retry measures leave it out and say so.
- Small samples: ten runs per case. Intervals are Wilson 95%; comparisons use Fisher's exact test. Neither is an acceptance criterion.

## The eleven questions

### Q1. Does adding libraries change SQL behavior?

**What we need to know:** does adding libraries change SQL behavior, compared with A0.

| case | A0 | A2/A2b, database only | p vs A0 | database + library | p vs A0 | searched the attached library |
| --- | --- | --- | --- | --- | --- | --- |
| between-boundary | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| relative-date-recall | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| connection-label-as-schema | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| silent-fix-no-renarration | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| naming-abbreviated-table | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| naming-multi-connection-ambiguous | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| naming-decoy-table | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| answer-shape | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| no-invented-attribution | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| follow-up-row-on-screen | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |
| most-common-over-free-text | 10/10 (100%) | 10/10 (100%) | 1.00 | 10/10 (100%) | 1.00 | 0/10 (0%) |

| all original cases | A0 | database only | p vs A0 | database + library | p vs A0 |
| --- | --- | --- | --- | --- | --- |
| valid runs passed | 110/110 (100%) 97–100% | 110/110 (100%) 97–100% | 1.00 | 110/110 (100%) 97–100% | 1.00 |

With a library attached, runs that used a library the question did not need: 0/110 (0%).

The existing case `naming-multi-connection-ambiguous` (threshold T03):

| result | passed |
| --- | --- |
| A0 | 10/10 (100%) |
| database only | 10/10 (100%) |
| database + library | 10/10 (100%) |

**Assessment:** TBD — requires engineering review.

### Q2. Does document routing remain reliable?

**What we need to know:** does document routing remain reliable across the real-model matrix.

Families: media-only and vague requests, fixture libraries; then a real syslab-server tenant.

#### First pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-only-notice-period | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-only-no-database | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×10 |
| media-only-paraphrase | 10 | 6/10 (60%) | 6/10 (60%) | 6/10 (60%) | 6/10 (60%) | routing 4 | search ×6, none ×4 |
| media-vague-show-contracts | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-vague-library-only | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | asked ×10 |

#### Second pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-only-notice-period | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-only-no-database | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×10 |
| media-only-paraphrase | 10 | 3/10 (30%) | 3/10 (30%) | 3/10 (30%) | 3/10 (30%) | routing 7 | none ×7, search ×3 |
| media-vague-show-contracts | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-vague-library-only | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | asked ×10 |

#### Live retrieval

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live-termination-notice | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| live-paraphrase | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| live-late-delivery | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| live-vague-show-contracts | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×9, asked ×1 |

**Assessment:** TBD — requires engineering review.

### Q3. Does cross-source routing work?

**What we need to know:** does cross-source routing work: PostgreSQL and a document library in one question.

#### First pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-cross-late-orders-and-penalty | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | sql+search ×10 |
| media-cross-register-and-terms | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | sql ×10 |

Runs needing more than one source: 20; all used 10, some but not all 10, none 0.

#### Second pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-cross-late-orders-and-penalty | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | sql+search ×10 |
| media-cross-register-and-terms | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | sql ×10 |

Runs needing more than one source: 20; all used 10, some but not all 10, none 0.

**Assessment:** TBD — requires engineering review.

### Q4. Does multi-library selection work?

**What we need to know:** does multi-library selection work: the relevant library searched, without unnecessary searches.

#### First pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-multi-leave-policy | 10 | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) | routing 9 | none ×9, search ×1 |
| media-multi-audit-findings | 10 | 5/10 (50%) | 5/10 (50%) | 5/10 (50%) | 5/10 (50%) | routing 5 | search ×5, none ×5 |
| media-multi-two-relevant | 10 | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 0/10 (0%) | routing 10 | search ×10 |

Runs with a source expectation: 30; required library not used 24, an unneeded library also searched 0.
Of the runs that needed more than one source: all used 0, some but not all 10, none 0 (of 10).

#### Second pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-multi-leave-policy | 10 | 2/10 (20%) | 2/10 (20%) | 2/10 (20%) | 2/10 (20%) | routing 8 | none ×8, search ×2 |
| media-multi-audit-findings | 10 | 4/10 (40%) | 4/10 (40%) | 4/10 (40%) | 4/10 (40%) | routing 6 | none ×6, search ×4 |
| media-multi-two-relevant | 10 | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 0/10 (0%) | routing 10 | search ×10 |

Runs with a source expectation: 30; required library not used 24, an unneeded library also searched 0.
Of the runs that needed more than one source: all used 0, some but not all 10, none 0 (of 10).

**Assessment:** TBD — requires engineering review.

### Q5. Does ambiguity handling work?

**What we need to know:** does ambiguity handling work, for low-risk questions and materially consequential ones. Behavior is described here, not judged.

#### First pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-lowrisk-payment-terms | 10 | 7/10 (70%) | 7/10 (70%) | 7/10 (70%) | 7/10 (70%) | routing 3 | search ×7, none ×3 |
| media-lowrisk-expiry-date | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-insufficient-penalty-rate | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-insufficient-uncovered-customer | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-material-penalty-which | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-material-invoice-rate | 10 | 0/10 (0%) | 8/10 (80%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×5, sql+search ×3, sql ×2 |

#### Second pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-lowrisk-payment-terms | 10 | 8/10 (80%) | 8/10 (80%) | 8/10 (80%) | 8/10 (80%) | routing 2 | search ×8, none ×2 |
| media-lowrisk-expiry-date | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-insufficient-penalty-rate | 10 | 9/10 (90%) | 9/10 (90%) | 9/10 (90%) | 9/10 (90%) | routing 1 | search ×9, none ×1 |
| media-insufficient-uncovered-customer | 10 | 9/10 (90%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | answer 1 | search ×10 |
| media-material-penalty-which | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-material-invoice-rate | 10 | 0/10 (0%) | 7/10 (70%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×6, sql ×3, sql+search ×1 |

**Assessment:** TBD — requires engineering review.

### Q6. Does provenance survive repeated runs?

**What we need to know:** does provenance survive repeated runs: how often the delivered answer ends with a valid Sources block, and whether anything unbacked reaches the reader.

| result | runs that retrieved documents | delivered answer ends with a block | block written unprompted | failed a check (generation / sanitization / rendering) | as primary cause | runs with lines removed by the check |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| First pass | 107 | 107/107 (100%) 97–100% | 107/107 (100%) | 10 / 0 / 0 | 0 / 0 / 0 | 0 |  |
| Second pass | 103 | 103/103 (100%) 96–100% | 103/103 (100%) | 0 / 0 / 0 | 0 / 0 / 0 | 0 |  |
| Live retrieval | 30 | 30/30 (100%) 89–100% | 27/30 (90%) | 0 / 0 / 0 | 0 / 0 / 0 | 0 |  |

Failures are counted twice on purpose: under every check a run failed, and as the primary cause only. See ISS-01 for a first-pass counting issue.

**Assessment:** TBD — requires engineering review.

### Q7. Does the corrective retry remain rare?

**What we need to know:** does the corrective retry remain rare, and how often do the loop's existing backstops retry.

| result | corrective retry for a missing Sources block (of runs that retrieved documents) | any other retry (of valid runs) |
| --- | --- | --- |
| First pass | 0/107 (0%) 0–3% | 32/240 (13%) 10–18% |
| Second pass | 0/103 (0%) 0–4% | 34/240 (14%) 10–19% |
| Live retrieval | 3/30 (10%) 3–26% | 0/40 (0%) 0–9% |
| Original cases, library attached | n/a | 40/110 (36%) 28–46% |

**Assessment:** TBD — requires engineering review.

### Q8. Does SQL-only behavior remain unchanged?

**What we need to know:** does SQL-only behavior remain unchanged, with no unnecessary document searches.

#### First pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-pg-contracts-register | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-pg-expiring-contracts | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-revenue-by-region | 10 | 5/10 (50%) | 0/10 (0%) | 5/10 (50%) | 5/10 (50%) | routing 5 | sql ×5, none ×5 |
| media-efficiency-order-count | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-top-customers | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-empty-result | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |

Searched a library although the case needs none: 0/60 (0%).

#### Second pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-pg-contracts-register | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-pg-expiring-contracts | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-revenue-by-region | 10 | 6/10 (60%) | 0/10 (0%) | 6/10 (60%) | 6/10 (60%) | routing 4 | sql ×6, none ×4 |
| media-efficiency-order-count | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-top-customers | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-empty-result | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |

Searched a library although the case needs none: 0/60 (0%).

The original cases against A0 are in Q1.

**Assessment:** TBD — requires engineering review.

### Q9. Does unauthorized access remain impossible?

**What we need to know:** does unauthorized access remain impossible. This is a Tier A (deterministic) guarantee; the Tier B cases below only show what the model does at that boundary.

#### Tier A: authorization and isolation tests

`npm test` at 2026-09-21T13:24:00Z: 944 tests, 939 passed, 0 failed, 5 skipped.

#### Tier B: the model at the boundary

#### First pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-unauthorized-library-not-attached | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | none ×10 |
| media-unauthorized-named-library | 10 | 10/10 (100%) | 6/10 (60%) | 10/10 (100%) | 10/10 (100%) | — | search ×6, none ×4 |

#### Second pass

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-unauthorized-library-not-attached | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | none ×10 |
| media-unauthorized-named-library | 10 | 10/10 (100%) | 6/10 (60%) | 10/10 (100%) | 10/10 (100%) | — | search ×6, none ×4 |

**Assessment:** TBD — requires engineering review.

### Q10. What does it cost?

**What we need to know:** requests, tokens and wall time of the agent. Requests include those for runs that were retried or never measured; grading (LLM-judge) requests are not agent cost and are counted apart; wall time includes any wait after a rate limit and any grading.

| result | valid runs | requests per valid run | input tokens per request | output tokens per request | input tokens per valid run | seconds per valid run | agent requests sent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0 baseline: the original eleven cases on main before any media change | 110 | 2.54 | 3028 | 55 | 7680 | 2.6 | 279 (0 answered 429; 10 more for grading) |
| A2/A2b database-only: the original eleven cases, no library attached | 110 | 2.36 | 3180 | 59 | 7516 | 3.5 | 260 (0 answered 429; 10 more for grading) |
| Database plus library: the original eleven cases with a document library attached | 110 | 2.55 | 3784 | 62 | 9632 | 3.9 | 280 (0 answered 429; 10 more for grading) |
| Media families, first pass | 240 | 1.91 | 3812 | 57 | 7274 | 2.9 | 458 (0 answered 429; 20 more for grading) |
| Media families, second pass | 240 | 1.91 | 3811 | 57 | 7273 | 2.9 | 458 (0 answered 429; 20 more for grading) |
| Live retrieval against a real syslab-server tenant | 40 | 1.82 | 4738 | 75 | 8647 | 2.2 | 73 (0 answered 429; 0 more for grading) |
| Control: no database attached | 40 | 1.82 | 3155 | 45 | 5758 | 1.8 | 73 (1 answered 429; 0 more for grading) |
| Control: only the relevant libraries attached | 30 | 1.77 | 3605 | 33 | 6369 | 2.1 | 53 (1 answered 429; 0 more for grading) |
| Control: no library attached | 60 | 2.43 | 3249 | 65 | 7905 | 3.3 | 146 (0 answered 429; 0 more for grading) |

**Assessment:** TBD — requires engineering review.

### Q11. Are failures actually model failures?

**What we need to know:** which failures are the model's. Runs that never reached the model are reported apart from every rate, and each failed run has one primary cause.

#### How every scheduled run ended

| result | scheduled | valid (the model's) | rate limited | infrastructure | other failure | attempts / requests answered 429 |
| --- | --- | --- | --- | --- | --- | --- |
| A0 baseline: the original eleven cases on main before any media change | 110 | 110 | 0 | 0 | 0 | 110 / 0 |
| A2/A2b database-only: the original eleven cases, no library attached | 110 | 110 | 0 | 0 | 0 | 110 / 0 |
| Database plus library: the original eleven cases with a document library attached | 110 | 110 | 0 | 0 | 0 | 110 / 0 |
| Media families, first pass | 240 | 240 | 0 | 0 | 0 | 240 / 0 |
| Media families, second pass | 240 | 240 | 0 | 0 | 0 | 240 / 0 |
| Live retrieval against a real syslab-server tenant | 40 | 40 | 0 | 0 | 0 | 40 / 0 |
| Control: no database attached | 40 | 40 | 0 | 0 | 0 | 41 / 1 |
| Control: only the relevant libraries attached | 30 | 30 | 0 | 0 | 0 | 31 / 1 |
| Control: no library attached | 60 | 60 | 0 | 0 | 0 | 60 / 0 |

#### Failed valid runs by primary cause

| result | failed valid runs | routing | retrieval | provenance (generation) | provenance (sanitization) | rendering | answer | kind not recorded (A0) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A0 baseline: the original eleven cases on main before any media change | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A2/A2b database-only: the original eleven cases, no library attached | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Database plus library: the original eleven cases with a document library attached | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Media families, first pass | 96 | 96 | 0 | 0 | 0 | 0 | 0 | 0 |
| Media families, second pass | 99 | 98 | 0 | 0 | 0 | 0 | 1 | 0 |
| Live retrieval against a real syslab-server tenant | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| Control: no database attached | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| Control: only the relevant libraries attached | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| Control: no library attached | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Routing failures by what the run did. These describe observed behavior and are not causes; one pattern each, first match wins.

| result | routing failures | no tool used | asked instead of using a tool | required source not used | unneeded source used | other |
| --- | --- | --- | --- | --- | --- | --- |
| A0 baseline: the original eleven cases on main before any media change | 0 | 0 | 0 | 0 | 0 | 0 |
| A2/A2b database-only: the original eleven cases, no library attached | 0 | 0 | 0 | 0 | 0 | 0 |
| Database plus library: the original eleven cases with a document library attached | 0 | 0 | 0 | 0 | 0 | 0 |
| Media families, first pass | 96 | 36 | 10 | 30 | 20 | 0 |
| Media families, second pass | 98 | 38 | 10 | 30 | 20 | 0 |
| Live retrieval against a real syslab-server tenant | 10 | 9 | 1 | 0 | 0 | 0 |
| Control: no database attached | 9 | 5 | 4 | 0 | 0 | 0 |
| Control: only the relevant libraries attached | 20 | 10 | 0 | 10 | 0 | 0 |
| Control: no library attached | 0 | 0 | 0 | 0 | 0 | 0 |

Grader, fixture and expectation issues are not inferred from results. They are kept in the register at the end of this report.

**Assessment:** TBD — requires engineering review.

## Repeatability: first and second media pass

The two media passes side by side on every dimension, each on its own; no figure is computed across the two. "Differs" means the observed counts differ on that dimension; p is Fisher's exact test on the pass count and is descriptive, not a threshold.

Cases with an identical pass count in both passes: 17 of 24. Cases that differ on at least one dimension: 9 of 24.

| case | passed (1 vs 2) | p | searched (1 vs 2) | routing right (1 vs 2) | primary cause (1 vs 2) | provenance: block / owed, failed a check (1 vs 2) | retries: provenance, other (1 vs 2) | differs in |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| media-pg-contracts-register | 10/10  vs  10/10 | 1.00 | 0/10  vs  0/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |
| media-pg-expiring-contracts | 10/10  vs  10/10 | 1.00 | 0/10  vs  0/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |
| media-only-notice-period | 10/10  vs  10/10 | 1.00 | 10/10  vs  10/10 | 10/10  vs  10/10 | —  vs  — | 10/10, 0 failed  vs  10/10, 0 failed | 0/10, 0/10  vs  0/10, 0/10 | identical |
| media-only-no-database | 0/10  vs  0/10 | 1.00 | 0/10  vs  0/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |
| media-only-paraphrase | 6/10  vs  3/10 | 0.37 | 6/10  vs  3/10 | 6/10  vs  3/10 | routing 4  vs  routing 7 | 6/6, 0 failed  vs  3/3, 0 failed | 0/6, 0/10  vs  0/3, 0/10 | pass count, search rate, routing, tool pattern, primary cause, provenance, retries |
| media-cross-late-orders-and-penalty | 10/10  vs  10/10 | 1.00 | 10/10  vs  10/10 | 10/10  vs  10/10 | —  vs  — | 10/10, 0 failed  vs  10/10, 0 failed | 0/10, 0/10  vs  0/10, 0/10 | identical |
| media-cross-register-and-terms | 0/10  vs  0/10 | 1.00 | 0/10  vs  0/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 5/10  vs  0/0, 5/10 | identical |
| media-multi-leave-policy | 1/10  vs  2/10 | 1.00 | 1/10  vs  2/10 | 1/10  vs  2/10 | routing 9  vs  routing 8 | 1/1, 0 failed  vs  2/2, 0 failed | 0/1, 0/10  vs  0/2, 0/10 | pass count, search rate, routing, tool pattern, primary cause, provenance, retries |
| media-multi-audit-findings | 5/10  vs  4/10 | 1.00 | 5/10  vs  4/10 | 5/10  vs  4/10 | routing 5  vs  routing 6 | 5/5, 0 failed  vs  4/4, 0 failed | 0/5, 0/10  vs  0/4, 0/10 | pass count, search rate, routing, tool pattern, primary cause, provenance, retries |
| media-multi-two-relevant | 0/10  vs  0/10 | 1.00 | 10/10  vs  10/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 10/10, 10 failed  vs  10/10, 0 failed | 0/10, 0/10  vs  0/10, 0/10 | provenance |
| media-lowrisk-payment-terms | 7/10  vs  8/10 | 1.00 | 7/10  vs  8/10 | 7/10  vs  8/10 | routing 3  vs  routing 2 | 7/7, 0 failed  vs  8/8, 0 failed | 0/7, 0/10  vs  0/8, 1/10 | pass count, search rate, routing, tool pattern, primary cause, provenance, retries |
| media-lowrisk-expiry-date | 0/10  vs  0/10 | 1.00 | 10/10  vs  10/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 10/10, 0 failed  vs  10/10, 0 failed | 0/10, 0/10  vs  0/10, 0/10 | identical |
| media-insufficient-penalty-rate | 10/10  vs  9/10 | 1.00 | 10/10  vs  9/10 | 10/10  vs  9/10 | —  vs  routing 1 | 10/10, 0 failed  vs  9/9, 0 failed | 0/10, 0/10  vs  0/9, 0/10 | pass count, search rate, routing, tool pattern, primary cause, provenance, retries |
| media-insufficient-uncovered-customer | 10/10  vs  9/10 | 1.00 | 10/10  vs  10/10 | 10/10  vs  10/10 | —  vs  answer 1 | 10/10, 0 failed  vs  10/10, 0 failed | 0/10, 0/10  vs  0/10, 0/10 | pass count, primary cause |
| media-material-penalty-which | 0/10  vs  0/10 | 1.00 | 10/10  vs  10/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 10/10, 0 failed  vs  10/10, 0 failed | 0/10, 10/10  vs  0/10, 10/10 | identical |
| media-material-invoice-rate | 0/10  vs  0/10 | 1.00 | 8/10  vs  7/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 8/8, 0 failed  vs  7/7, 0 failed | 0/8, 0/10  vs  0/7, 0/10 | search rate, tool pattern, provenance, retries |
| media-unauthorized-library-not-attached | 10/10  vs  10/10 | 1.00 | 0/10  vs  0/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |
| media-unauthorized-named-library | 10/10  vs  10/10 | 1.00 | 6/10  vs  6/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 6/10  vs  0/0, 6/10 | identical |
| media-efficiency-revenue-by-region | 5/10  vs  6/10 | 1.00 | 0/10  vs  0/10 | 5/10  vs  6/10 | routing 5  vs  routing 4 | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 5/10  vs  0/0, 6/10 | pass count, routing, tool pattern, primary cause, retries |
| media-efficiency-order-count | 10/10  vs  10/10 | 1.00 | 0/10  vs  0/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 6/10  vs  0/0, 6/10 | identical |
| media-efficiency-top-customers | 10/10  vs  10/10 | 1.00 | 0/10  vs  0/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |
| media-efficiency-empty-result | 10/10  vs  10/10 | 1.00 | 0/10  vs  0/10 | 10/10  vs  10/10 | —  vs  — | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |
| media-vague-show-contracts | 10/10  vs  10/10 | 1.00 | 10/10  vs  10/10 | 10/10  vs  10/10 | —  vs  — | 10/10, 0 failed  vs  10/10, 0 failed | 0/10, 0/10  vs  0/10, 0/10 | identical |
| media-vague-library-only | 0/10  vs  0/10 | 1.00 | 0/10  vs  0/10 | 0/10  vs  0/10 | routing 10  vs  routing 10 | 0/0, 0 failed  vs  0/0, 0 failed | 0/0, 0/10  vs  0/0, 0/10 | identical |

## Controls

A control changes one thing about a case and nothing else, to show which of the things a case has is responsible for what the model does.

### Control: no database attached

The same cases with the database removed. Each control is set beside its original in both media passes.

| case | original, first pass | original, second pass | control | control: failed by primary cause |
| --- | --- | --- | --- | --- |
| media-only-notice-period | 10/10; searched 10/10; search ×10 | 10/10; searched 10/10; search ×10 | 10/10; searched 10/10; search ×10 | — |
| media-only-paraphrase | 6/10; searched 6/10; search ×6, none ×4 | 3/10; searched 3/10; none ×7, search ×3 | 10/10; searched 10/10; search ×10 | — |
| media-lowrisk-payment-terms | 7/10; searched 7/10; search ×7, none ×3 | 8/10; searched 8/10; search ×8, none ×2 | 10/10; searched 10/10; search ×10 | — |
| media-vague-show-contracts | 10/10; searched 10/10; search ×10 | 10/10; searched 10/10; search ×10 | 1/10; searched 1/10; none ×5, asked ×4, search ×1 | routing 9 |

### Control: only the relevant libraries attached

The same cases with every library the question does not need removed. Each control is set beside its original in both media passes.

| case | original, first pass | original, second pass | control | control: failed by primary cause |
| --- | --- | --- | --- | --- |
| media-multi-leave-policy | 1/10; searched 1/10; none ×9, search ×1 | 2/10; searched 2/10; none ×8, search ×2 | 0/10; searched 0/10; none ×10 | routing 10 |
| media-multi-audit-findings | 5/10; searched 5/10; search ×5, none ×5 | 4/10; searched 4/10; none ×6, search ×4 | 10/10; searched 10/10; search ×10 | — |
| media-multi-two-relevant | 0/10; searched 10/10; search ×10 | 0/10; searched 10/10; search ×10 | 0/10; searched 10/10; search ×10 | routing 10 |

### Control: no library attached

The same cases with every library removed. Each control is set beside its original in both media passes.

| case | original, first pass | original, second pass | control | control: failed by primary cause |
| --- | --- | --- | --- | --- |
| media-pg-contracts-register | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | — |
| media-pg-expiring-contracts | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | — |
| media-efficiency-revenue-by-region | 5/10; searched 0/10; sql ×5, none ×5 | 6/10; searched 0/10; sql ×6, none ×4 | 10/10; searched 0/10; sql ×10 | — |
| media-efficiency-order-count | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | — |
| media-efficiency-top-customers | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | — |
| media-efficiency-empty-result | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | 10/10; searched 0/10; sql ×10 | — |

## Thresholds

No threshold below was chosen after seeing these results. Those the engineering plan did not decide say TBD. Observed values are in the section named; whether they meet a threshold is a decision for the person who sets it.

| id | metric | threshold | where it was decided | observed in |
| --- | --- | --- | --- | --- |
| T01 | The original eleven cases, database only, against A0 | TBD / requires engineering decision | TBD / requires engineering decision (the plan: targets set from the A0 baseline after A3) | Q1, Q8 |
| T02 | The original eleven cases with a library attached, against A0 | TBD / requires engineering decision | TBD / requires engineering decision (the plan: targets set from the A0 baseline after A3) | Q1, Q8 |
| T03 | The existing case naming-multi-connection-ambiguous | keeps passing (no numeric threshold specified) | engineering plan: "the existing naming-multi-connection-ambiguous case must keep passing" | Q1 |
| T04 | Tier A authorization and isolation tests | all pass (deterministic; no tolerance specified) | engineering plan: Tier A deterministic authorization, isolation and hygiene tests | Q9 |
| T05 | Media-only: right library searched, no query, file cited | TBD / requires engineering decision | TBD / requires engineering decision | Q2 |
| T06 | Vague requests for documents: the library is searched | TBD / requires engineering decision | TBD / requires engineering decision | Q2 |
| T07 | Cross-source: both sources used and named | TBD / requires engineering decision | TBD / requires engineering decision | Q3 |
| T08 | Multi-library: only the relevant libraries searched | TBD / requires engineering decision | TBD / requires engineering decision | Q4 |
| T09 | Ambiguous, clear and low-risk: likely source first, no clarifying question | TBD / requires engineering decision | TBD / requires engineering decision | Q5 |
| T10 | Ambiguous, insufficient: other source checked or offered, nothing invented | TBD / requires engineering decision | TBD / requires engineering decision | Q5 |
| T11 | Ambiguous, material: clarifying question naming both options, before any tool call | TBD / requires engineering decision | TBD / requires engineering decision | Q5 |
| T12 | Unnecessary cross-source call rate | TBD / requires engineering decision | TBD / requires engineering decision (the plan: thresholds set from the A0 baseline) | Q1, Q4, Q5, Q8 |
| T13 | Efficiency: search calls on a question the database answers completely | zero search calls on a pure-figures question (a case's pass condition; no rate threshold specified) | engineering plan: "Efficiency: zero search calls on a pure-figures question" | Q8 |
| T14 | Valid Sources block rate | TBD / requires engineering decision | TBD / requires engineering decision | Q6 |
| T15 | Unbacked provenance lines reaching the reader (sanitization failures) | none reach the reader (a design guarantee; no tolerance specified) | engineering plan: fabricated provenance never reaches the user (A2b approval) | Q6 |
| T16 | Rendering failures of the Sources block | TBD / requires engineering decision | TBD / requires engineering decision | Q6 |
| T17 | Corrective retry frequency ("remains rare") | TBD / requires engineering decision | TBD / requires engineering decision | Q7 |
| T18 | Cost: requests and tokens per valid run | TBD / requires engineering decision | TBD / requires engineering decision | Q10 |
| T19 | Share of scheduled runs not measured (rate limited, infrastructure, other) before a result counts as insufficient | TBD / requires engineering decision | TBD / requires engineering decision | Q11 |
| T20 | Agreement between the first and second media pass | TBD / requires engineering decision | TBD / requires engineering decision | Repeatability |

## Grader, fixture, expectation and report issues

Entered by hand. A result file cannot say its own grader was wrong, so none of these is inferred from a pattern in the data.

| id | kind | what was found | effect on the results | status | affects |
| --- | --- | --- | --- | --- | --- |
| ISS-01 | grader | provenanceGenerated required the model's Sources block to name every file a case lists, even one the run never retrieved. | In the first media pass, 10 runs of media-multi-two-relevant carry a provenance_generation flag on top of their routing failure (the Contracts library was never searched, so nda_2024.pdf could not have been cited). The check now requires citations only of retrieved files. The raw answers were not stored, so the first pass was not regraded. | fixed in evals/grade-media.ts before the second pass; first-pass records keep the old flag | media_pass_1: media-multi-two-relevant |
| ISS-02 | report | Reports listed every failed check on a run, so one missed search appeared as a routing, an answer and sometimes a provenance failure. | Per-category counts from the run's own record add to more than the number of failed runs. The analysis assigns one primary cause per failed run (routing, then retrieval, provenance generation, provenance sanitization, rendering, and the answer's own content last), derived from the stored categories. No re-run was needed. | handled in the analysis; the run records are unchanged | every report from A3 |
| ISS-03 | expectation | media-lowrisk-expiry-date designates the Sales register as the expected first source for an expiry date. A contract document is also a plausible source for one. | The case grades the first tool used against the register. Whether that expectation is the right one is a judgment about the routing policy, not something a result can settle. | open: requires engineering decision | media_pass_1, media_pass_2: media-lowrisk-expiry-date |
| ISS-04 | limitation | A control's runs record which sources were missing or unnecessary against the original case's expectation, not against what the control actually attached. | In a control with a source removed, a run-level list can name a source that was never available. The analysis adjusts its tool-kind metrics for the removed source and leaves the run-level lists as recorded. | documented; the control results are not altered | control_no_database; control_relevant_library; control_no_library |
| ISS-05 | limitation | Which cases carry a check on the answer's own content is not recorded in a result file. | Answer failures are reported as failed runs whose primary cause was the answer, over runs that routed correctly. The report does not say how many cases could have produced one. | documented | every report |
| ISS-06 | expectation | The efficiency cases require a query to have run, in addition to zero searches. The plan's efficiency condition is only zero search calls on a pure-figures question. | media-efficiency-revenue-by-region failed in runs that made no tool call at all: each satisfied the plan's condition (no search) and failed the extra one (no query). Its result cannot be read as a violation of the plan's efficiency row. It is a failure of the PostgreSQL-only row's condition (run_sql used), applied to a case in the efficiency family. | open: requires engineering decision on which condition the efficiency family carries | media_pass_1, media_pass_2: media-efficiency-revenue-by-region |
| ISS-07 | grader | media-insufficient-uncovered-customer fails an answer that matches "Initech ... N days" within one sentence. An answer that says Initech's deadline is not available and then names another customer's period could match it. | One second-pass run failed this check. The grader quotes 160 characters of the answer and the quote ends before the match, so it cannot be told from the result whether the answer invented a deadline or the check matched a correct answer. The full answer was not stored. | unresolved: needs the full text of that answer, which the result does not have | media_pass_2: media-insufficient-uncovered-customer |
| ISS-08 | report | The first version of this report's cost table counted grading (LLM judge) requests and tokens as agent cost. | Requests and input tokens per request were understated for results with judge calls (the A0 baseline showed 2,929 input tokens per request where the agent alone spent 3,028). The cost figures now use agent usage only and report grading calls apart. | fixed in the analysis before any figure was reported; the result files are unchanged | baseline_a0; legacy_database_only; legacy_with_library; media_pass_1; media_pass_2 |

## Appendix: every case in every result

#### A0 baseline: the original eleven cases on main before any media change (baseline_a0)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| between-boundary | 10 | 10/10 (100%) | — | — | — | — | — |
| relative-date-recall | 10 | 10/10 (100%) | — | — | — | — | — |
| connection-label-as-schema | 10 | 10/10 (100%) | — | — | — | — | — |
| silent-fix-no-renarration | 10 | 10/10 (100%) | — | — | — | — | — |
| naming-abbreviated-table | 10 | 10/10 (100%) | — | — | — | — | — |
| naming-multi-connection-ambiguous | 10 | 10/10 (100%) | — | — | — | — | — |
| naming-decoy-table | 10 | 10/10 (100%) | — | — | — | — | — |
| answer-shape | 10 | 10/10 (100%) | — | — | — | — | — |
| no-invented-attribution | 10 | 10/10 (100%) | — | — | — | — | — |
| follow-up-row-on-screen | 10 | 10/10 (100%) | — | — | — | — | — |
| most-common-over-free-text | 10 | 10/10 (100%) | — | — | — | — | — |

#### A2/A2b database-only: the original eleven cases, no library attached (legacy_database_only)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| between-boundary | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| relative-date-recall | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| connection-label-as-schema | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| silent-fix-no-renarration | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| naming-abbreviated-table | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| naming-multi-connection-ambiguous | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| naming-decoy-table | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| answer-shape | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| no-invented-attribution | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| follow-up-row-on-screen | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |
| most-common-over-free-text | 10 | 10/10 (100%) | 0/10 (0%) | — | — | — | sql ×10 |

#### Database plus library: the original eleven cases with a document library attached (legacy_with_library)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| between-boundary | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| relative-date-recall | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| connection-label-as-schema | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| silent-fix-no-renarration | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| naming-abbreviated-table | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| naming-multi-connection-ambiguous | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| naming-decoy-table | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| answer-shape | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| no-invented-attribution | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| follow-up-row-on-screen | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |
| most-common-over-free-text | 10 | 10/10 (100%) | 0/10 (0%) | — | 10/10 (100%) | — | sql ×10 |

#### Media families, first pass (media_pass_1)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-pg-contracts-register | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-pg-expiring-contracts | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-only-notice-period | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-only-no-database | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×10 |
| media-only-paraphrase | 10 | 6/10 (60%) | 6/10 (60%) | 6/10 (60%) | 6/10 (60%) | routing 4 | search ×6, none ×4 |
| media-cross-late-orders-and-penalty | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | sql+search ×10 |
| media-cross-register-and-terms | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | sql ×10 |
| media-multi-leave-policy | 10 | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) | routing 9 | none ×9, search ×1 |
| media-multi-audit-findings | 10 | 5/10 (50%) | 5/10 (50%) | 5/10 (50%) | 5/10 (50%) | routing 5 | search ×5, none ×5 |
| media-multi-two-relevant | 10 | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 0/10 (0%) | routing 10 | search ×10 |
| media-lowrisk-payment-terms | 10 | 7/10 (70%) | 7/10 (70%) | 7/10 (70%) | 7/10 (70%) | routing 3 | search ×7, none ×3 |
| media-lowrisk-expiry-date | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-insufficient-penalty-rate | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-insufficient-uncovered-customer | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-material-penalty-which | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-material-invoice-rate | 10 | 0/10 (0%) | 8/10 (80%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×5, sql+search ×3, sql ×2 |
| media-unauthorized-library-not-attached | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | none ×10 |
| media-unauthorized-named-library | 10 | 10/10 (100%) | 6/10 (60%) | 10/10 (100%) | 10/10 (100%) | — | search ×6, none ×4 |
| media-efficiency-revenue-by-region | 10 | 5/10 (50%) | 0/10 (0%) | 5/10 (50%) | 5/10 (50%) | routing 5 | sql ×5, none ×5 |
| media-efficiency-order-count | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-top-customers | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-empty-result | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-vague-show-contracts | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-vague-library-only | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | asked ×10 |

#### Media families, second pass (media_pass_2)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-pg-contracts-register | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-pg-expiring-contracts | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-only-notice-period | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-only-no-database | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×10 |
| media-only-paraphrase | 10 | 3/10 (30%) | 3/10 (30%) | 3/10 (30%) | 3/10 (30%) | routing 7 | none ×7, search ×3 |
| media-cross-late-orders-and-penalty | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | sql+search ×10 |
| media-cross-register-and-terms | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | sql ×10 |
| media-multi-leave-policy | 10 | 2/10 (20%) | 2/10 (20%) | 2/10 (20%) | 2/10 (20%) | routing 8 | none ×8, search ×2 |
| media-multi-audit-findings | 10 | 4/10 (40%) | 4/10 (40%) | 4/10 (40%) | 4/10 (40%) | routing 6 | none ×6, search ×4 |
| media-multi-two-relevant | 10 | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 0/10 (0%) | routing 10 | search ×10 |
| media-lowrisk-payment-terms | 10 | 8/10 (80%) | 8/10 (80%) | 8/10 (80%) | 8/10 (80%) | routing 2 | search ×8, none ×2 |
| media-lowrisk-expiry-date | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-insufficient-penalty-rate | 10 | 9/10 (90%) | 9/10 (90%) | 9/10 (90%) | 9/10 (90%) | routing 1 | search ×9, none ×1 |
| media-insufficient-uncovered-customer | 10 | 9/10 (90%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | answer 1 | search ×10 |
| media-material-penalty-which | 10 | 0/10 (0%) | 10/10 (100%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×10 |
| media-material-invoice-rate | 10 | 0/10 (0%) | 7/10 (70%) | 0/10 (0%) | 0/10 (0%) | routing 10 | search ×6, sql ×3, sql+search ×1 |
| media-unauthorized-library-not-attached | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | none ×10 |
| media-unauthorized-named-library | 10 | 10/10 (100%) | 6/10 (60%) | 10/10 (100%) | 10/10 (100%) | — | search ×6, none ×4 |
| media-efficiency-revenue-by-region | 10 | 6/10 (60%) | 0/10 (0%) | 6/10 (60%) | 6/10 (60%) | routing 4 | sql ×6, none ×4 |
| media-efficiency-order-count | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-top-customers | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-empty-result | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-vague-show-contracts | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-vague-library-only | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | asked ×10 |

#### Live retrieval against a real syslab-server tenant (live)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live-termination-notice | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| live-paraphrase | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| live-late-delivery | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| live-vague-show-contracts | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×9, asked ×1 |

#### Control: no database attached (control_no_database)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-only-notice-period@no-database | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-only-paraphrase@no-database | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-lowrisk-payment-terms@no-database | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-vague-show-contracts@no-database | 10 | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) | 1/10 (10%) | routing 9 | none ×5, asked ×4, search ×1 |

#### Control: only the relevant libraries attached (control_relevant_library)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-multi-leave-policy@only-relevant-library | 10 | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | 0/10 (0%) | routing 10 | none ×10 |
| media-multi-audit-findings@only-relevant-library | 10 | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | 10/10 (100%) | — | search ×10 |
| media-multi-two-relevant@only-relevant-library | 10 | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | 0/10 (0%) | routing 10 | search ×10 |

#### Control: no library attached (control_no_library)

| case | valid runs | passed | searched | right kind of tool | sources exact | failed by primary cause | tools used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| media-pg-contracts-register@no-library | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-pg-expiring-contracts@no-library | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-revenue-by-region@no-library | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-order-count@no-library | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-top-customers@no-library | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
| media-efficiency-empty-result@no-library | 10 | 10/10 (100%) | 0/10 (0%) | 10/10 (100%) | 10/10 (100%) | — | sql ×10 |
