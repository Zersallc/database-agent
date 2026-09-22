# A3 intro-wording experiment

Generated 2026-09-22. Raw data: `evals/results/a3-intro-experiment.json`. Script:
`evals/experiment-intro-wording.ts` (new file; no change to `lib/agent/prompt.ts`, `lib/agent/index.ts`, or any
case/grader/fixture file). git HEAD `46ee7ff` (unchanged, working tree unchanged besides the two new eval-only
scripts and their outputs). 60 runs against `syslab-default`, 120 requests, 0 rate-limited, ~3.4 minutes wall time.

**Status: evidence only.** Nothing here has been used to change a prompt, case, grader, or any production code.
A3 still blocks A4. This is a follow-up experiment, not a broader validation and not a production change.

## Experiment objective

The prior diagnostic (`evals/results/a3-diagnostic-report.md`) found that swapping the "## Connection" section's
wording, alone, moved `media-vague-show-contracts` from 6/6 search to 0/6 search (p = 0.0022) — the strongest
single result in that diagnostic. That test used A3's own no-database text (a false claim that no database
exists) as the alternative, which shows wording *matters*, not that a *clearer* wording *helps*. This experiment
asks the next, narrower question:

> Does changing only the "## Connection" section — making the document library feel like an actionable,
> non-fallback source, and pairing each tool with the kind of question it serves — change tool selection, holding
> the routing policy itself, the tools, the fixtures, the grader and the model fixed?

## Exact variables changed

One variable: the text of the "## Connection" section, and only that section. Nothing else in the prompt differs
between variants — this is enforced structurally, not just by intent: Variant B is built by taking the real,
unmodified `buildSystemPrompt()` output for each run and appending one paragraph to the end of the existing "##
Connection" section (never retyping or replacing the original wording), the same section-splicing mechanism the
prior diagnostic used and verified. "## Document libraries", "## Choosing a source", "## Sources", the tool
definitions, the schema, and the routing policy are byte-identical to control in every run.

The added paragraph names which tool serves which kind of need and says the library is not a fallback. It adds no
keyword list, no decision tree, no JSON structure, and no new reasoning step, and it does not touch "## Choosing a
source", which remains the only place the routing policy itself lives.

## Control vs. experimental prompt section

**Control (Variant A)** — the real, unmodified "## Connection" section, exactly as production sends it today for
this fixture (`connections: [salesDatabase()]`):

```
## Connection

You are querying "Sales" (postgres). Write SQL in that engine's dialect. "Sales" is this connection's label for
humans — it is not a schema, catalog, or anything else writable in SQL. Reference tables using exactly the
schema-qualified names shown in the Database schema section below, nothing prepended.

"Sales" holds: Orders, customers, and the register of supplier contracts.
```

**Experimental (Variant B)** — the same text, with one paragraph appended:

```
## Connection

You are querying "Sales" (postgres). Write SQL in that engine's dialect. "Sales" is this connection's label for
humans — it is not a schema, catalog, or anything else writable in SQL. Reference tables using exactly the
schema-qualified names shown in the Database schema section below, nothing prepended.

"Sales" holds: Orders, customers, and the register of supplier contracts.

This workspace's document libraries (below) are a separate, equally real source, not a fallback: call run_sql
for a row or a figure the database holds, and search_documents for what a document says — a clause, term,
obligation, or policy. Reach for the library because the question is about what a document states, not because
the database already came up short.
```

All six test cases use the same `salesDatabase()` connection and the `Contracts` library (confirmed by reading
each case file before writing the script), so this single fixed addition applies unchanged across every case —
there was no per-case tuning of the wording.

## Test matrix

One case per routing class requested, 5 repeats per variant per case (60 runs total):

| Case | Role | Why this one |
|---|---|---|
| `media-vague-show-contracts` | vague request | the diagnostic's strongest effect; the case this experiment is a direct follow-up to |
| `media-only-notice-period` | specific document question | contrast point: a targeted question in the same workspace |
| `media-pg-contracts-register` | SQL-only | negative control — must not start searching a library it does not need |
| `media-cross-register-and-terms` | cross-source | known failure (0/10 search in both A3 passes) |
| `media-multi-leave-policy` | multi-library | known failure; the one case in the prior diagnostic where removing the routing section *(not this wording change)* directionally reduced search (not significant) |
| `media-insufficient-penalty-rate` | ambiguous, insufficient-source | stable in A3 (10/10, 9/10 across passes); included as requested for the family |

## Raw outcome summary

All 60 scheduled runs were valid (0 rate-limited, 0 infrastructure, 0 execution failures). 120 agent requests,
472,121 input / 7,186 output tokens, 201s wall time, paced at ≤30 requests/minute.

| Case | Variant | search_documents | run_sql | both | neither (asked / answered) |
|---|---|---:|---:|---:|---|
| media-vague-show-contracts | A control | 5/5 | 0 | 0 | 0 |
| media-vague-show-contracts | B experimental | 5/5 | 0 | 0 | 0 |
| media-only-notice-period | A control | 5/5 | 0 | 0 | 0 |
| media-only-notice-period | B experimental | 5/5 | 0 | 0 | 0 |
| media-pg-contracts-register | A control | 0/5 | 5 | 0 | 0 |
| media-pg-contracts-register | B experimental | 0/5 | 5 | 0 | 0 |
| media-cross-register-and-terms | A control | 0/5 | 4 | 1 | 0 |
| media-cross-register-and-terms | B experimental | 0/5 | 5 | 0 | 0 |
| media-multi-leave-policy | A control | 3/5 | 0 | 0 | 2 (0 asked, 2 answered) |
| media-multi-leave-policy | B experimental | 4/5 | 0 | 0 | 1 (0 asked, 1 answered) |
| media-insufficient-penalty-rate | A control | 5/5 | 0 | 0 | 0 |
| media-insufficient-penalty-rate | B experimental | 5/5 | 0 | 0 | 0 |

## Tool-selection comparison

Here "search" means the run used `search_documents` (alone or alongside `run_sql`, i.e. `search_documents + both`),
which is the case-appropriate success condition for every case except the SQL-only one.

| Case | Control search | Experimental search | Other tool behavior | Interpretation |
|---|---:|---:|---|---|
| media-vague-show-contracts | 5/5 | 5/5 | — | **Ceiling.** Already 100% under the real control prompt (consistent with the prior diagnostic's A_full: 6/6). No room for the experimental wording to show an effect either way. |
| media-only-notice-period | 5/5 | 5/5 | — | Ceiling, same as above. |
| media-pg-contracts-register | 0/5 | 0/5 | 5/5 SQL both variants | Negative control holds: no spurious search induced. |
| media-cross-register-and-terms | 1/5 | 0/5 | control: 4 sql-only, 1 both; experimental: 5 sql-only | Small movement in the **wrong** direction (fewer runs used both sources), not significant (Fisher p = 1.00, 1/5 vs 0/5). The case's own grader (which requires both sources) went 1/5 → 0/5. |
| media-multi-leave-policy | 3/5 | 4/5 | control: 2 neither (answered without a tool); experimental: 1 neither | Small movement in the **predicted** direction, not significant (Fisher p = 1.00, 3/5 vs 4/5, Wilson 95% intervals 23–88% and 38–96% overlap heavily). The case's own grader went 3/5 → 4/5 and the required-source-missing count went 2 → 1. |
| media-insufficient-penalty-rate | 5/5 | 5/5 | — | Ceiling. |

## Interpretation

Answering the eight questions directly:

1. **Did the introduction change affect `media-vague-show-contracts`?** No — the control was already at 5/5
   (100%), matching the prior diagnostic's own control result (6/6) for the same case under the real, unmodified
   prompt. There was no headroom for this test to show an effect in either direction.
2. **Did the effect replicate across other document cases?** There is no effect from question 1 to replicate.
   The other two clearly document-favoring cases in the matrix (`media-only-notice-period`,
   `media-insufficient-penalty-rate`) were also already at ceiling in control.
3. **Did SQL-only behavior remain unchanged?** Yes. `media-pg-contracts-register` stayed 5/5 SQL-only, 0/5
   search, in both variants — the added paragraph did not pull a figures-only question toward the library.
4. **Did cross-source behavior remain unchanged?** Not exactly — it moved from 1/5 correct (both sources used) to
   0/5, a small decrease. At n=5 with a single-run difference (Fisher p = 1.00) this is not distinguishable from
   noise, but it is the one case in this experiment where the experimental wording did not do better than control,
   and the case was already the weakest performer in the matrix (grader 1/5 in control). This should not be read
   as "cross-source got worse" — it should be read as "cross-source stayed bad, and this specific sample did not
   happen to include the one run that used both sources."
5. **Did multi-library behavior remain unchanged or change?** It moved, directionally in the predicted direction:
   3/5 → 4/5 search, and 2 → 1 runs missing the required library. Not significant (Fisher p = 1.00), and the two
   Wilson intervals (23–88% vs 38–96%) overlap almost entirely. This is consistent with — but does not confirm —
   the open hypothesis the prior diagnostic flagged for this exact case (that explicit source-choice guidance may
   matter more when there are more sources to choose among; this case has four: one database and three libraries).
6. **Did the result support treating connection/source introduction as a meaningful routing variable?** Only
   weakly, and only by not contradicting the prior diagnostic — this experiment could not test the hypothesis on
   the case that mattered most (the vague request) because that case had no headroom under a real, non-adversarial
   prompt. The prior diagnostic's finding — that *breaking* the intro (with a false claim) breaks routing — stands
   on its own evidence (p = 0.0022) and is unaffected by this experiment. This experiment's narrower question —
   does *improving* the intro improve routing — remains effectively untested, because the test matrix did not
   include a case that both (a) has genuine, non-adversarial headroom to improve and (b) was represented at
   adequate sample size. `media-multi-leave-policy` is the closest fit and moved in the right direction, but n=5
   is not enough to call it confirmed.
7. **Is there evidence that the change harms any previously reliable behavior?** No. Every case that was reliable
   in control (5/5 or the SQL-only case's 5/5 no-search) stayed exactly as reliable in the experimental variant.
   The only case that moved in the "wrong" direction (`media-cross-register-and-terms`) was already unreliable in
   control (1/5) — this is not a previously reliable behavior becoming unreliable, it is an already-poor case
   producing one fewer success out of five, which is within ordinary sampling variation at this size.
8. **What remains unexplained?** Whether the experimental wording would show a clear, decisive effect on a case
   that is a genuine, non-adversarial under-triggering failure with real headroom — this experiment's matrix had
   only one case with real headroom in the predicted direction (`media-multi-leave-policy`) and one with headroom
   in the case-needs-improvement direction that didn't move favorably (`media-cross-register-and-terms`), both at
   n=5. Neither is resolved by this sample size.

## Limitations / confounders

- **Ceiling effect dominates the matrix.** Four of six cases (`media-vague-show-contracts`,
  `media-only-notice-period`, `media-pg-contracts-register`, `media-insufficient-penalty-rate`) were already at
  100% (or 0% search, correctly, for the SQL-only case) under the *real, unmodified* control prompt. This test
  matrix — built from cases A3 and the prior diagnostic had already characterized, several of which were chosen
  specifically as *stable* reference points — was not well-suited to detect an improvement, because most of it had
  no room to improve. A follow-up aimed at confirming or rejecting the hypothesis would need cases with genuine,
  non-adversarial headroom (candidates from A3's own data: `media-only-paraphrase`, 30–60% search across A3's two
  passes; `media-multi-audit-findings`, 40–50%; a repeat of `media-multi-leave-policy` at a larger n).
- **Sample size.** n=5 per cell. Every Wilson interval on the two informative cases is wide (23–96% territory),
  and both Fisher's exact tests returned p = 1.00. This experiment can rule out neither a real effect nor its
  absence on those two cases — it can only say the observed difference, at this size, is not distinguishable from
  chance.
- **Two cases, one direction each, opposite signs.** `media-multi-leave-policy` moved favorably;
  `media-cross-register-and-terms` moved unfavorably. Neither move is significant. Read together, this is
  consistent with random noise around a true effect of roughly zero, and equally consistent with a true small
  positive effect obscured by noise in one case. This experiment cannot distinguish those two readings, and no
  further runs, rephrasing, or selective re-analysis were done to try to make it — per the run plan, this is
  reported as observed.
- **Single day, single model.** `syslab-default` (Qwen via DashScope) only, same session-level conditions as the
  prior diagnostic and as A3 itself.
- **Grader/missing-source fields are informational, not the primary measurement.** `grader_pass` reflects each
  case's full pass/fail (answer content and provenance included, not just source selection); `missing_sources` /
  `unnecessary_sources` are the narrower, non-quality-judging signal requested, and both are reported in the raw
  outcome summary above for reference. Every finding in this report is read from `routing` (which tool was
  actually called), consistent with the primary measurement the brief specified.
- **This experiment does not, by itself, re-test the prior diagnostic's E/F conditions.** It was not designed to;
  it tests a *different* Variant B (an addition to the real control, not a replacement with a false claim), so its
  results say nothing new about the diagnostic's own p=0.0022 finding, which stands independently.

## Recommendation

**Insufficient evidence; run a specifically justified follow-up.**

This is not "reject" — nothing here shows the experimental wording harms anything that was working, and one case
moved in the predicted direction. It is not "use the experimental introduction for broader validation" — the
matrix mostly hit a ceiling, the two cases with real headroom produced p = 1.00 in opposite directions, and
adopting a wording change on that basis would be exactly the small-sample overreading this run plan was designed
to avoid. It is not "retain current introduction and investigate elsewhere" either — the multi-library result is
a real, if unconfirmed, signal in the predicted direction, and the prior diagnostic's own finding (intro wording
is the dominant lever for at least one case) has not been undermined by anything observed here.

A specifically justified follow-up, if one is wanted, would need a test matrix built for headroom rather than for
routing-class coverage: cases from A3's own record that are *not* already at or near ceiling under the real
control prompt (e.g. `media-only-paraphrase`, `media-multi-audit-findings`, and `media-multi-leave-policy` again
at a larger n, since it is the one case here with a real, if small, directional result to confirm or disconfirm).
That is a new decision for you to make, not one this report makes on its own — nothing here should be read as
already justifying that follow-up; it is only naming what a follow-up would need in order to actually be able to
answer the question this one could not.
