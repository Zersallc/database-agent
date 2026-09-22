/**
 * Known grader, fixture, expectation and report issues, kept by hand.
 *
 * "This failure was the grader's, not the model's" cannot be read off a result
 * file: nothing in a run says its grader was wrong. Inferring it from a pattern
 * (a case that always fails must have a bad expectation) would be exactly the
 * kind of conclusion this analysis is meant to avoid, so such issues are recorded
 * here by a person, each with what is known and what is not, and the report
 * prints the register beside the failure accounting instead of folding it in.
 *
 * An entry says what was found and what it affected. It does not say the result
 * is otherwise fine or otherwise broken.
 */

export type Issue = {
  id: string;
  kind: "grader" | "report" | "expectation" | "limitation";
  summary: string;
  /** Which results it touches, and how. */
  effect: string;
  status: string;
  affects: string[];
};

export const KNOWN_ISSUES: Issue[] = [
  {
    id: "ISS-01",
    kind: "grader",
    summary:
      "provenanceGenerated required the model's Sources block to name every file a case lists, even one the run never retrieved.",
    effect:
      "In the first media pass, 10 runs of media-multi-two-relevant carry a provenance_generation flag on top of their routing failure (the Contracts library was never searched, so nda_2024.pdf could not have been cited). The check now requires citations only of retrieved files. The raw answers were not stored, so the first pass was not regraded.",
    status: "fixed in evals/grade-media.ts before the second pass; first-pass records keep the old flag",
    affects: ["media_pass_1: media-multi-two-relevant"],
  },
  {
    id: "ISS-02",
    kind: "report",
    summary:
      "Reports listed every failed check on a run, so one missed search appeared as a routing, an answer and sometimes a provenance failure.",
    effect:
      "Per-category counts from the run's own record add to more than the number of failed runs. The analysis assigns one primary cause per failed run (routing, then retrieval, provenance generation, provenance sanitization, rendering, and the answer's own content last), derived from the stored categories. No re-run was needed.",
    status: "handled in the analysis; the run records are unchanged",
    affects: ["every report from A3"],
  },
  {
    id: "ISS-03",
    kind: "expectation",
    summary:
      "media-lowrisk-expiry-date designates the Sales register as the expected first source for an expiry date. A contract document is also a plausible source for one.",
    effect:
      "The case grades the first tool used against the register. Whether that expectation is the right one is a judgment about the routing policy, not something a result can settle.",
    status: "open: requires engineering decision",
    affects: ["media_pass_1, media_pass_2: media-lowrisk-expiry-date"],
  },
  {
    id: "ISS-04",
    kind: "limitation",
    summary:
      "A control's runs record which sources were missing or unnecessary against the original case's expectation, not against what the control actually attached.",
    effect:
      "In a control with a source removed, a run-level list can name a source that was never available. The analysis adjusts its tool-kind metrics for the removed source and leaves the run-level lists as recorded.",
    status: "documented; the control results are not altered",
    affects: ["control_no_database", "control_relevant_library", "control_no_library"],
  },
  {
    id: "ISS-05",
    kind: "limitation",
    summary:
      "Which cases carry a check on the answer's own content is not recorded in a result file.",
    effect:
      "Answer failures are reported as failed runs whose primary cause was the answer, over runs that routed correctly. The report does not say how many cases could have produced one.",
    status: "documented",
    affects: ["every report"],
  },
  {
    id: "ISS-06",
    kind: "expectation",
    summary:
      "The efficiency cases require a query to have run, in addition to zero searches. The plan's efficiency condition is only zero search calls on a pure-figures question.",
    effect:
      "media-efficiency-revenue-by-region failed in runs that made no tool call at all: each satisfied the plan's condition (no search) and failed the extra one (no query). Its result cannot be read as a violation of the plan's efficiency row. It is a failure of the PostgreSQL-only row's condition (run_sql used), applied to a case in the efficiency family.",
    status: "open: requires engineering decision on which condition the efficiency family carries",
    affects: ["media_pass_1, media_pass_2: media-efficiency-revenue-by-region"],
  },
  {
    id: "ISS-07",
    kind: "grader",
    summary:
      "media-insufficient-uncovered-customer fails an answer that matches \"Initech ... N days\" within one sentence. An answer that says Initech's deadline is not available and then names another customer's period could match it.",
    effect:
      "One second-pass run failed this check. The grader quotes 160 characters of the answer and the quote ends before the match, so it cannot be told from the result whether the answer invented a deadline or the check matched a correct answer. The full answer was not stored.",
    status: "unresolved: needs the full text of that answer, which the result does not have",
    affects: ["media_pass_2: media-insufficient-uncovered-customer"],
  },
  {
    id: "ISS-08",
    kind: "report",
    summary:
      "The first version of this report's cost table counted grading (LLM judge) requests and tokens as agent cost.",
    effect:
      "Requests and input tokens per request were understated for results with judge calls (the A0 baseline showed 2,929 input tokens per request where the agent alone spent 3,028). The cost figures now use agent usage only and report grading calls apart.",
    status: "fixed in the analysis before any figure was reported; the result files are unchanged",
    affects: ["baseline_a0", "legacy_database_only", "legacy_with_library", "media_pass_1", "media_pass_2"],
  },
];
