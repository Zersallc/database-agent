/**
 * The threshold table: what would count as acceptable, and where that was decided.
 *
 * Almost none of it has been decided. The engineering plan set the shape of the
 * evaluation and said the numbers would be set from the A0 baseline after A3
 * ("set pass-rate targets from that baseline after A3, not guess them now").
 * A number chosen after seeing this run's results would be fitted to them, so
 * this table does not choose one. Every row the plan did not decide says
 * `TBD / requires engineering decision`, and stays that way until someone with
 * that authority fills it in.
 *
 * What the plan did specify is stated as specified, in the plan's own terms, with
 * no number invented to go with it. The report shows the observed values beside
 * each row and never a verdict: whether an observed value meets a threshold is
 * for the person who sets it.
 */

export const TBD = "TBD / requires engineering decision";

export type ThresholdRow = {
  id: string;
  metric: string;
  /** What counts as acceptable. `TBD` unless the plan said. */
  threshold: string;
  /** Where the threshold was decided, or that it was not. */
  source: string;
  /** Which report section shows the observed values. */
  observedIn: string;
};

const PLAN = "engineering plan";

export const THRESHOLDS: ThresholdRow[] = [
  {
    id: "T01",
    metric: "The original eleven cases, database only, against A0",
    threshold: TBD,
    source: `${TBD} (the plan: targets set from the A0 baseline after A3)`,
    observedIn: "Q1, Q8",
  },
  {
    id: "T02",
    metric: "The original eleven cases with a library attached, against A0",
    threshold: TBD,
    source: `${TBD} (the plan: targets set from the A0 baseline after A3)`,
    observedIn: "Q1, Q8",
  },
  {
    id: "T03",
    metric: "The existing case naming-multi-connection-ambiguous",
    threshold: "keeps passing (no numeric threshold specified)",
    source: `${PLAN}: "the existing naming-multi-connection-ambiguous case must keep passing"`,
    observedIn: "Q1",
  },
  {
    id: "T04",
    metric: "Tier A authorization and isolation tests",
    threshold: "all pass (deterministic; no tolerance specified)",
    source: `${PLAN}: Tier A deterministic authorization, isolation and hygiene tests`,
    observedIn: "Q9",
  },
  { id: "T05", metric: "Media-only: right library searched, no query, file cited", threshold: TBD, source: TBD, observedIn: "Q2" },
  { id: "T06", metric: "Vague requests for documents: the library is searched", threshold: TBD, source: TBD, observedIn: "Q2" },
  { id: "T07", metric: "Cross-source: both sources used and named", threshold: TBD, source: TBD, observedIn: "Q3" },
  { id: "T08", metric: "Multi-library: only the relevant libraries searched", threshold: TBD, source: TBD, observedIn: "Q4" },
  { id: "T09", metric: "Ambiguous, clear and low-risk: likely source first, no clarifying question", threshold: TBD, source: TBD, observedIn: "Q5" },
  { id: "T10", metric: "Ambiguous, insufficient: other source checked or offered, nothing invented", threshold: TBD, source: TBD, observedIn: "Q5" },
  { id: "T11", metric: "Ambiguous, material: clarifying question naming both options, before any tool call", threshold: TBD, source: TBD, observedIn: "Q5" },
  {
    id: "T12",
    metric: "Unnecessary cross-source call rate",
    threshold: TBD,
    source: `${TBD} (the plan: thresholds set from the A0 baseline)`,
    observedIn: "Q1, Q4, Q5, Q8",
  },
  {
    id: "T13",
    metric: "Efficiency: search calls on a question the database answers completely",
    threshold: "zero search calls on a pure-figures question (a case's pass condition; no rate threshold specified)",
    source: `${PLAN}: "Efficiency: zero search calls on a pure-figures question"`,
    observedIn: "Q8",
  },
  { id: "T14", metric: "Valid Sources block rate", threshold: TBD, source: TBD, observedIn: "Q6" },
  {
    id: "T15",
    metric: "Unbacked provenance lines reaching the reader (sanitization failures)",
    threshold: "none reach the reader (a design guarantee; no tolerance specified)",
    source: `${PLAN}: fabricated provenance never reaches the user (A2b approval)`,
    observedIn: "Q6",
  },
  { id: "T16", metric: "Rendering failures of the Sources block", threshold: TBD, source: TBD, observedIn: "Q6" },
  { id: "T17", metric: "Corrective retry frequency (\"remains rare\")", threshold: TBD, source: TBD, observedIn: "Q7" },
  { id: "T18", metric: "Cost: requests and tokens per valid run", threshold: TBD, source: TBD, observedIn: "Q10" },
  {
    id: "T19",
    metric: "Share of scheduled runs not measured (rate limited, infrastructure, other) before a result counts as insufficient",
    threshold: TBD,
    source: TBD,
    observedIn: "Q11",
  },
  { id: "T20", metric: "Agreement between the first and second media pass", threshold: TBD, source: TBD, observedIn: "Repeatability" },
];
