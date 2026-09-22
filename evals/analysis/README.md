# A3 analysis

Tooling that turns completed eval results into one report, the same way every
time. It reads result files, computes measurements, and lays them out against the
eleven questions A3 has to answer. It does not run a model, does not change a
result file, and does not decide whether anything passes.

```
npx tsx evals/analyze.ts --out=evals/results/a3-analysis.md --json=evals/results/a3-analysis.json
npx tsx evals/analyze.ts --tier-a=evals/results/tier-a.json   # once the Tier A totals exist
```

The default manifest (`manifest.ts`) names the nine results: the A0 baseline, the
original cases with and without a library, the two media passes, the live arm and
the three controls. A result whose file does not exist yet, or is not a complete
report, is shown as **TBD** in every section that needs it. `--manifest` replaces
the list; `--generated-at` fixes the timestamp so a report can be reproduced
byte for byte.

## What it will not do

- **Conclude.** Each question has a section of evidence and an assessment line
  that is always `TBD — requires engineering review`. Nothing in the report says
  A3 passed or failed.
- **Choose thresholds.** `thresholds.ts` lists what would need a threshold and
  where it was decided. The plan set almost none, and said the numbers would come
  from the A0 baseline after A3. Those rows say `TBD / requires engineering
  decision`. A number picked after seeing results is fitted to them.
- **Infer from missing data.** The A0 baseline has no run-level detail, so
  metrics about tools, sources, provenance and retries leave its runs out and say
  how many. A control's expectations are the original case's, adjusted only by
  removing the source the control removed.
- **Average away a difference.** The two media passes are shown side by side;
  there is no pooled row.

## What it measures

Every rate counts **valid runs only**. A run the gateway turned away, or that
failed for another reason, is in the accounting (Q11) and in no percentage.

A failed run has **one primary cause**, the earliest link in this chain that
failed: routing, retrieval, provenance generation, provenance sanitization,
rendering, and last the answer's own content. A model that never searched fails
routing and, downstream of that, has no fact to state and no source to cite;
charging all three would count one mistake three times. The stored failure
categories are unchanged, and the report also shows how many runs failed each
check.

| Dimension | Measured as | Needs |
|---|---|---|
| Tool selection | the kinds of tool used (SQL, search, neither) against the kinds the question needs or allows | the case's declared sources |
| Source and library selection | required sources not used, unneeded sources used, by library and by database | run-level source lists |
| Multi-source | of runs needing more than one source, all, some, none used | the case's declared sources |
| Ambiguity | what the model did: which tools, whether it ended in a question. Described, not judged | run detail |
| Unnecessary searches | searches where no library is needed; unneeded libraries and databases used | declared sources, run-level lists |
| SQL regression | the original eleven cases against A0: pass counts, Wilson 95% interval, Fisher's exact test | A0 and the reruns |
| Provenance | of runs that retrieved documents: block delivered, written unprompted, failed each check, lines removed | run detail |
| Corrective retry | of runs that retrieved documents; and other retries over all valid runs | run detail |
| Answer correctness | failed runs whose primary cause is the answer, over runs that routed correctly | run detail |
| Cost | requests, tokens and wall time per valid run and per request | usage |
| Failure accounting | how every scheduled run ended, primary cause of each failed run, routing failures by observed pattern | all |

The routing patterns (no tool used, asked instead of using a tool, required
source not used, unneeded source used) describe what the run did. They are not
causes.

## Failure kinds are kept apart

The report separates, and never merges into one score: tool-routing failures,
wrong-source failures, retrieval failures, answer failures, provenance failures
(generation and sanitization), rendering failures, infrastructure and rate-limit
failures, and grader or fixture issues. The last cannot be read from a result. A
result file cannot say its own grader was wrong, so those are kept by hand in
`register.ts`, each with what was found and what it affected, and printed beside
the failure accounting.

## Repeatability

`repeat.ts` sets the first and second media pass side by side, case by case:
pass count, search rate, routing, primary cause, tool pattern, provenance and
retries. "Differs" means the observed counts differ, not that the difference is
significant. Fisher's p on the pass count is shown as a description of how
surprising the gap would be if both passes shared one rate, and is not an
acceptance threshold.

## Controls

`controls.ts` pairs each control case with the case it was made from (the id and
`@variant`), and shows it beside that case in both passes. The three controls are
no database attached, only the relevant libraries attached, and no library
attached. A control with no result is TBD.

## Tests

`tests/evals-analysis.test.ts` covers the loader, every metric, the two-pass
comparison, the control pairing, the threshold table, the register and the
report's own guarantees: it never states a verdict, it marks pending results TBD,
and the same input always gives the same report.
