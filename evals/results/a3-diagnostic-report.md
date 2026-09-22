# A3 routing diagnostic: what actually drives the search-triggering swing

Generated 2026-09-22. Raw data: `evals/results/a3-diagnostic.json`. Script: `evals/diagnostic-routing.ts`
(new file; no change to `lib/agent/prompt.ts`, `lib/agent/index.ts`, or any case/grader/fixture file). 86 runs
against `syslab-default`, 149 requests, 0 rate-limited, ~4.3 minutes wall time.

**Status: evidence only.** Nothing here has been used to change a prompt, a case, a grader, or any production
code. A3 still blocks A4.

## Method, in brief

A3's "no-database" control removed three things from the prompt at once, because they are structurally coupled
in `buildSystemPrompt`: whether `run_sql` was offered at all, whether the "## Choosing a source" section existed
(`renderSourceChoice`, only rendered when `connections.length + libraries.length > 1`), and which "## Connection"
text the model read (`renderConnectionIntro`). That control could not say which one did the work.

This diagnostic separates them by wrapping the model client with a text-editing step (mirroring the pattern
`recordingClient`/`pacedClient` already use in `harness.ts`): `buildSystemPrompt` still runs, unmodified, on
whatever real `connections`/`libraries` a condition attaches — so database presence, and the real availability of
the `run_sql` tool, is a genuine variable, not simulated — and the client wrapper then edits the resulting text by
section heading before it reaches the model: deleting the "## Choosing a source" section, inserting one harvested
from a real `buildSystemPrompt` call, or replacing the "## Connection" section with another condition's real text.
Every spliced section is real, unedited output from the real function. The splice mechanism was verified by hand
before any model call: see the section-order dump reproduced at the end of this file.

Only the routing outcome was measured: which of `run_sql` / `search_documents` / both / neither the model called.
Existing case graders ran too (free, deterministic, already attached to the case) and are recorded in the raw
data, but they are not what this diagnostic reports on — a grader's `sources` expectation was written for the
case's natural connections, and a condition that removes the database in software can make its
`unnecessary_sources`/`missing_sources` accounting stale in the same way A3's own no-database control did (ISS-04).

**Six conditions**, all against `media-vague-show-contracts` ("Show me the contracts.", 1 database + 1 library
naturally attached — the case with the largest and structurally cleanest known effect from A3, 10/10 → 1/10
informally, and the reason the primary ablation runs here rather than on a fresh case):

| id | database attached (`run_sql` really offered) | "Choosing a source" section | "## Connection" text |
|---|---|---|---|
| A_full | yes | present | database-style ("You are querying \"Sales\"...") |
| B_none | no | absent (natural — this is A3's own control) | no-database-style ("No database is attached...") |
| C_section_removed | yes | **removed** | database-style |
| D_section_added | no | **added** (spliced) | no-database-style |
| E_intro_swapped | yes | present | **swapped** to no-database-style (mismatched: the tool is real, the text denies it) |
| F_database_only_tool_available | yes | **removed** | **swapped** to no-database-style (mismatched) |

E and F are deliberately internally inconsistent prompts — the text denies a database that `run_sql` is still
genuinely usable for. That is not a state the application can ever produce; it exists only to isolate intro
wording from actual tool availability without touching production code. Read their results as "how the model
reacts when told something false about its own capability," not as a realistic scenario.

Five secondary cases got a lighter, two-condition check (5 repeats each) to see whether the primary finding
generalizes, one per family the diagnostic was asked to cover.

## Primary ablation results (n=6 per condition)

| Condition | search_documents | run_sql | both | neither (asked / answered) | Wilson 95% (search rate) |
|---|---|---|---|---|---|
| A_full | 6/6 | 0 | 0 | 0 | 61–100% |
| B_none | 0/6 | 0 | 0 | 6 (4 asked, 2 answered) | 0–39% |
| C_section_removed | 6/6 | 0 | 0 | 0 | 61–100% |
| D_section_added | 0/6 | 0 | 0 | 6 (5 asked, 1 answered) | 0–39% |
| E_intro_swapped | 0/6 | 0 | 0 | 6 (1 asked, 5 answered) | 0–39% |
| F_database_only_tool_available | 2/6 | 0 | 0 | 4 (0 asked, 4 answered) | 10–70% |

### Comparison 1 — the "Choosing a source" section, alone, with the database attached

1. **Changed:** the section (present → removed).
2. **Held constant:** database attached and `run_sql` genuinely offered; "## Connection" reads the normal
   database-style text; question, library, model, everything else.
3. **Observed:** A_full 6/6 search → C_section_removed 6/6 search. No change.
4. **Supports:** with the database present and the intro reading normally, the section's presence or absence made
   no detectable difference to this case, at this sample size.
5. **Does not prove:** that the section never matters anywhere (see the multi-library secondary case, below, where
   removing it moved the result — not significantly, but in the opposite direction). Six runs per arm cannot rule
   out a small effect; it can only say this one was not large enough to appear at all here (both are 6/6 exactly).
6. **Confounders:** none identified for this specific comparison — this is the cleanest cell, since only the
   section text differs and both other variables are untouched.

### Comparison 2 — the section, alone, with the database absent

1. **Changed:** the section (absent → spliced in, harvested from a real 0-database call).
2. **Held constant:** no database attached, `run_sql` not offered; "## Connection" reads the no-database text;
   question, library, model.
3. **Observed:** B_none 0/6 search → D_section_added 0/6 search. No change.
4. **Supports:** the same null result as Comparison 1, at the other end of database presence — reinforces that the
   section is not, on its own, what is suppressing search-triggering in B_none (A3's actual control condition).
5. **Does not prove:** the section is inert in every context (same caveat as above).
6. **Confounders:** none identified.

### Comparison 3 — the intro text, alone, with the database attached and the section present

1. **Changed:** "## Connection" (database-style → the no-database text, verbatim from B_none).
2. **Held constant:** `run_sql` genuinely offered and functional; the section present and reading its normal
   database-aware text; question, library, model.
3. **Observed:** A_full 6/6 search → E_intro_swapped 0/6 search. **Fisher's exact p = 0.0022.**
4. **Supports:** intro wording alone — independent of whether a database is actually usable, and independent of
   the routing-policy section — is sufficient to collapse this case's search rate from 100% to 0%. This is the
   single strongest, most significant result in the diagnostic.
5. **Does not prove:** that intro wording is the *only* thing that matters (Comparison 4, below, shows tool
   availability alone also moves the rate, just less), or that this generalizes beyond this one case's wording
   ("Show me the contracts.").
6. **Confounders:** E is an internally inconsistent prompt (the model is told no database exists while `run_sql`
   is genuinely callable). Five of six E runs answered directly from general knowledge/refusal rather than search
   or ask (`neither_answered: 5`), which is itself informative — the model overwhelmingly took the false claim at
   face value rather than noticing the contradiction — but it means this result characterizes how the model
   resolves a contradiction it was never designed to see, not ordinary behavior.

### Comparison 4 — actual database/tool availability, alone, with the section absent and the intro reading "no database"

1. **Changed:** whether `connections` (and so the real `run_sql` tool) is attached — the database was silently
   made available while every word of the prompt still said it was not.
2. **Held constant:** the section absent; "## Connection" reads the no-database text verbatim; question, library,
   model.
3. **Observed:** B_none 0/6 search → F_database_only_tool_available 2/6 search. Fisher's exact p = 0.45 (not
   significant at this sample size).
4. **Supports:** a real, if partial and statistically unconfirmed at n=6, contribution from actual tool
   availability independent of what the text says — two of six runs searched anyway even though the prompt
   both denied the database and omitted the routing-policy section.
5. **Does not prove:** a reliable effect size — 33% vs 0% on six runs each has a wide interval (Wilson 10–70% for
   the 2/6 arm) and could be noise. This is a "worth a larger check," not a settled finding.
6. **Confounders:** same internal-inconsistency caveat as Comparison 3 (F is also a mismatched prompt). Also:
   F differs from B in exactly one variable (tool availability) but F's own result differs from C's (6/6, same
   tool availability, non-mismatched intro) by both variables, so F alone cannot separate "how much of C's 6/6 is
   tool availability vs. intro" — that split comes from Comparison 3, not this one.

### Comparison 5 (bonus, not in the original 3×2 design) — the section, alone, with the database attached and the intro already reading "no database"

1. **Changed:** the section (present → removed), with the intro already swapped to the no-database text in both
   arms.
2. **Held constant:** `run_sql` genuinely offered; "## Connection" reads the no-database text in both; question,
   library, model.
3. **Observed:** E_intro_swapped 0/6 search → F_database_only_tool_available 2/6 search. Fisher's exact p = 0.45
   (not significant).
4. **Supports:** a third, independent test of the section's effect (after Comparisons 1 and 2, both exactly null),
   this one landing on a small, non-significant increase when the section is removed — the opposite direction from
   "the section helps." Combined with Comparisons 1 and 2, there is no comparison in this diagnostic where removing
   the section reduced search-triggering on the primary case.
5. **Does not prove:** the section is actively counterproductive — the movement is within noise at n=6.
6. **Confounders:** both arms are the internally-inconsistent, mismatched-intro condition; this says nothing about
   the section's effect under a normal, consistent prompt (that is Comparisons 1 and 2).

## What this says about the vague-request collapse specifically

Ranked by evidence strength, for `media-vague-show-contracts`:

1. **Intro wording** — confirmed, large, significant (p = 0.0022). The dominant lever.
2. **Actual database/tool availability** — suggestive, moderate, not significant at n=6 (p = 0.45). A real
   candidate for a secondary contribution, not confirmed.
3. **The "Choosing a source" section** — no effect detected in three independent comparisons (two exact nulls,
   one non-significant reversal). The routing-policy section's own text change is not carrying A3's swing.

## Secondary cases (n=5 per condition, two-condition checks only)

### media-only-notice-period — specific document question, database removed (Comparisons: A_full vs B_none)

1. **Changed:** database attached → removed (A3's original, fully confounded control — all three variables move
   together here, same as it did in A3 itself).
2. **Held constant:** nothing deliberately — this is the natural, unmodified comparison, run again here only to
   put a number beside the vague case's collapse.
3. **Observed:** 5/5 search → 5/5 search. No change.
4. **Supports:** A3's own finding that targeted, specific document questions are robust to the no-database
   confound while a vague one is not. This sharpens the question the primary ablation answers: whatever the intro
   text does to `media-vague-show-contracts`, it does not do the same thing to a specific question in the same
   workspace, with the same three-variables-at-once change.
5. **Does not prove:** why specific questions are robust — this diagnostic did not run the 6-condition ablation
   on this case, so it cannot say whether a specific question is immune to the intro-wording effect, or whether it
   is just less sensitive to it.
6. **Confounders:** the usual three-at-once confound (this comparison does not isolate anything by itself; it is
   a contrast point, not an isolation).

### media-pg-contracts-register — negative control (Comparisons: A_full vs C_section_removed)

1. **Changed:** the section (present → removed), database attached throughout.
2. **Held constant:** database attached, `run_sql` offered, database-style intro; question needs no document at
   all.
3. **Observed:** 5/5 SQL-only, 0/5 search → 5/5 SQL-only, 0/5 search. No change.
4. **Supports:** the splice mechanism itself introduces no artifact — removing the section does not spuriously
   induce a search on a question that plainly needs none. This is a sanity check on the diagnostic apparatus, not
   a finding about routing.
5. **Does not prove:** anything about the vague-request mechanism.
6. **Confounders:** none — this cell exists to validate the method.

### media-only-paraphrase — known no-search failure (Comparisons: A_full vs C_section_removed)

1. **Changed:** the section (present → removed), database attached throughout.
2. **Held constant:** database attached, `run_sql` offered, database-style intro; question (a paraphrase sharing
   almost no words with the source clause).
3. **Observed:** 1/5 search → 4/5 search. Fisher's exact p = 0.21 (not significant).
4. **Supports:** nothing about the section *helping* — if anything the direction is the same as Comparison 5
   above (removing the section did not reduce search-triggering; here it moved the other way).
5. **Does not prove:** that removing the section improves this case — n=5 per arm on a case A3 itself found noisy
   across passes (60% then 30%) is not enough to separate a real effect from the case's own known volatility.
6. **Confounders:** A3 already flagged this case as unstable pass-to-pass (routing 4/10 vs 7/10 failures across
   the two A3 passes) with no manipulation at all; this comparison cannot tell a real effect from that baseline
   noise.

### media-cross-register-and-terms — known multi-source failure (Comparisons: A_full vs C_section_removed)

1. **Changed:** the section (present → removed), database attached throughout.
2. **Held constant:** database attached, `run_sql` offered, database-style intro; the register-count-plus-contract
   question.
3. **Observed:** 0/5 search → 1/5 (recorded as "both": one run called `run_sql` and `search_documents`).
   Fisher's exact p = 1.0 (not significant; one run out of five).
4. **Supports:** essentially nothing conclusive — the case still overwhelmingly defaults to SQL-only with the
   section removed, same as A3 found with it present (0/10 and 0/10 across A3's two passes).
5. **Does not prove:** the section is protective here either — one run out of five is inside ordinary sampling
   noise.
6. **Confounders:** none beyond sample size.

### media-multi-leave-policy — known multi-library failure (Comparisons: A_full vs C_section_removed)

1. **Changed:** the section (present → removed), database *and two other libraries* (HR Policies' siblings,
   Contracts and Compliance) attached throughout — this is the one case in this diagnostic with more than two
   total sources (1 database + 3 libraries).
2. **Held constant:** database attached, `run_sql` offered, database-style intro; the leave-policy question.
3. **Observed:** 3/5 search → 0/5 search. Fisher's exact p = 0.17 (not significant, but the largest directional
   movement of any secondary comparison, and the only one where removing the section coincided with *less*
   searching).
4. **Supports:** a hypothesis worth a dedicated follow-up — that the section's marginal value may scale with how
   many sources there are to choose among. This case has four total sources (1 database + 3 libraries); the
   primary ablation's case has two. The section is the only place the prompt explicitly says "decide which source
   the question needs," and losing that guidance may matter more when there is more to decide between.
5. **Does not prove:** this. n=5 per arm, p=0.17, and this is the only one of five secondary section-removal
   checks that moved in this direction — the other two moved the opposite way (paraphrase, cross-source) and two
   showed nothing (pg-register, and the primary case's own two null comparisons). Presenting this as confirmed
   would be exactly the kind of small-sample overreading A3's assessment was written to avoid.
6. **Confounders:** this case differs from the primary ablation on more than one axis at once (source count,
   question domain, which library is relevant) — a genuine isolation of "does the section matter more with more
   sources" would need its own controlled comparison, not a side observation from a two-condition check built for
   a different purpose.

## What this diagnostic does NOT prove, globally

- **Sample size.** Six and five runs per arm is a diagnostic, not a powered study. Every Wilson interval above is
  wide; only the p=0.0022 result (Comparison 3) clears a conventional significance threshold. Everything else is
  "suggestive" or "no effect detected," not "confirmed absent" or "confirmed present."
- **One case carries the whole causal ablation.** The full 6-condition isolation ran only on
  `media-vague-show-contracts`. The secondary cases each tested one variable (the section) with two conditions,
  not the full ablation — so this diagnostic knows the *mechanism* for one specific vague question, and only knows
  *whether removing the section moves the needle* for five other cases. It does not know whether the intro-wording
  effect (the dominant one here) replicates on those other cases, including the other known vague case
  (`media-vague-library-only`, not run here) or the material-ambiguity or multi-library families at the same depth.
- **Conditions were not randomized or interleaved.** Each condition's six (or five) repeats ran back-to-back,
  and conditions ran in a fixed order (A, B, C, D, E, F) rather than interleaved or randomized. A time-varying
  factor across the ~4-minute run (server load, model state) is not formally excluded as an alternative
  explanation for any single comparison. Two things argue against this being the real story: A and C (run first
  and third) landed on an identical 6/6, and F (run last) landed on a partial 2/6 rather than reverting toward
  either A's 6/6 or B's 0/6 — a monotonic drift account would not naturally produce that pattern — but this was
  not designed to rule drift out, only run cheaply.
- **E and F are not states the application can reach.** Both tell the model something false about whether a
  database is attached while the real tool remains (E) or remains and the section is also gone (F). They isolate
  intro wording from tool availability, which is the only way to do that without changing production code, but
  their absolute search rates (0/6 for E, 2/6 for F) describe the model resolving a contradiction, not ordinary
  behavior in any workspace this application actually creates.
- **Grader/pass fields are not the measurement.** `grader_pass` is recorded in the raw JSON for reference only;
  it inherits the same source-expectation staleness A3's own no-database control had (ISS-04) whenever a condition
  synthetically removed the database. Every finding above is read from `routing` (which tool was actually called),
  not from pass/fail.
- **Single model, single day.** `syslab-default` (Qwen via DashScope) only. A different model could weight intro
  wording, tool availability and explicit policy text differently.

## What this changes about A3's open questions

A3's smallest open question (assessment, section on controls) was: "which variable moves search-triggering —
database presence, the routing-policy section, or the connection intro." For `media-vague-show-contracts`
specifically, this diagnostic's answer is: **mostly the intro text**, with a secondary, unconfirmed contribution
from actual database/tool availability, and **no detected contribution from the routing-policy section on its
own**. That is evidence toward resolving the open question, not new information about whether A3's overall
routing-reliability finding still blocks A4 — it does not change the routing pass rates A3 already measured, and
per your decision this diagnostic does not touch any prompt, case, grader or fixture. A3 still blocks A4.

## Splice verification (run once, before any model call, no cost)

Confirms section ordering and content before any real request was sent:

```
FULL sections (first 70 chars each):
  - You are the database analyst for this workspace. Answer the question ...
  - ## Document libraries  This workspace has a document library that you ...
  - ## Choosing a source  Databases hold rows and figures; document librar...
  - ## Sources  After search_documents returns passages, finish your answe...
  - ## How your answers are rendered  Your reply is markdown. Fenced code ...
  - Lead with the answer, then the supporting detail. Explain a caveat whe...
  - ## Current date  Today is 2026-09-22 (YYYY-MM-DD). Resolve every relat...
  - ## Connection  You are querying "Sales" (postgres). Write SQL in that ...
  - ## Database schema  ### public.orders ...

NONE sections (first 70 chars each):
  - You are the database analyst for this workspace. Answer the question ...
  - ## Document libraries  This workspace has a document library that you ...
  - ## Sources  After search_documents returns passages, finish your answe...
  - ## How your answers are rendered  Your reply is markdown. Fenced code ...
  - Lead with the answer, then the supporting detail. Explain a caveat whe...
  - ## Current date  Today is 2026-09-22 (YYYY-MM-DD). Resolve every relat...
  - ## Connection  No database is attached to this conversation, so you ca...

Harvested "Choosing a source" donor (0 databases, 2 libraries -- databaseCount=0 wording, no
"Databases hold rows and figures" clause), spliced into D_section_added directly after
"## Document libraries" and directly before "## Sources", reproducing FULL's natural section order
exactly.
```

The donor texts used for every splice are saved verbatim in `evals/results/a3-diagnostic.json` under
`donor_texts`, so any spliced prompt can be reconstructed and re-read exactly.
