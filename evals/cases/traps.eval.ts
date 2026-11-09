/**
 * The five production traps from 9-10 September (syslab-server HANDOVER.md, "Claude passes every
 * trap"). Each was a silent failure on the real client database: the 14B fell into four of them on
 * the unfixed deployment and Claude into none. The fence case carries six prose turns, the
 * condition HANDOVER measured at 0/4. They run here on an invented hospital database
 * shaped like the client's (one wide `Report` table whose every column needs quoting, a
 * `Hospitals` lookup, and the two `pg_stat_statements` views a real install also lists). No
 * client name, row or figure is reused.
 */

import { allOf, answerMentions, answerNeverMatches, anyOf, sqlMatchedBy } from "../grade";
import { countResult, rowsResult } from "../fixtures";
import type { EvalCase, EvalConnection, EvalOutcome, GradeResult } from "../types";
import type { ReportGenerator } from "@/lib/agent";

function column(name: string, data_type: string, primary_key = false) {
  return { name, data_type, nullable: !primary_key, primary_key, description: null };
}

/** Items removed per hospital, highest first. The only figures a "top 5" answer may state. */
const RANKING: [string, string, number][] = [
  ["Thornbury Hospital", "Coastline Health", 1288],
  ["Ashgrove Hospital", "Meridian Care", 1175],
  ["Kestrel Bay Hospital", "Coastline Health", 1093],
  ["Umzimvubu Valley Hospital", "Meridian Care", 987],
  ["Lindiwe Ridge Hospital", "Meridian Care", 902],
  ["Okavango Point Hospital", "Coastline Health", 811],
];

const BY_CATEGORY: [string, number][] = [
  ["Sharps", 2140],
  ["Pharmaceutical", 1622],
  ["General", 1406],
  ["Anatomical", 1088],
];

const TOTAL = RANKING.reduce((sum, [, , n]) => sum + n, 0);

const HOSPITAL_DB: EvalConnection = {
  name: "Hospital Waste",
  engine: "postgres",
  description: "Medical waste removal records for the hospitals this workspace serves.",
  schema: [
    {
      schema: "public",
      name: "Report",
      description: "One row per item removed from a hospital.",
      row_estimate: TOTAL,
      columns: [
        column("ID", "text", true),
        column("Hospital Name", "text"),
        column("Removal Date", "date"),
        column("Waste Category", "text"),
        column("Weight (kg)", "numeric"),
        column("Container Type", "text"),
        column("Status", "text"),
      ],
    },
    {
      schema: "public",
      name: "Hospitals",
      description: "One row per hospital, with the group it belongs to.",
      row_estimate: RANKING.length,
      columns: [column("Hospital Name", "text", true), column("Hospital Group", "text"), column("Province", "text")],
    },
    {
      schema: "public",
      name: "pg_stat_statements",
      description: null,
      row_estimate: 4200,
      columns: [column("queryid", "bigint"), column("query", "text"), column("calls", "bigint"), column("total_exec_time", "double precision")],
    },
    {
      schema: "public",
      name: "pg_stat_statements_info",
      description: null,
      row_estimate: 1,
      columns: [column("dealloc", "bigint"), column("stats_reset", "timestamp with time zone")],
    },
  ],
  /** Answers the shapes these questions lead to; anything else gets the row count. */
  execute: async (sql: string) => {
    if (/pg_stat_statements/i.test(sql)) return rowsResult(["queryid", "calls"], [[1, 40]]);
    if (/"Hospitals"/i.test(sql)) return rowsResult(["Hospital Name", "Hospital Group"], RANKING.map(([h, g]) => [h, g]));
    if (/"Waste Category"/i.test(sql) && /group\s+by/i.test(sql)) return rowsResult(["Waste Category", "items"], BY_CATEGORY);
    if (/"Hospital Name"/i.test(sql) && /group\s+by/i.test(sql)) return rowsResult(["Hospital Name", "items"], RANKING.map(([h, , n]) => [h, n]));
    const named = RANKING.find(([h]) => sql.toLowerCase().includes(h.split(" ")[0].toLowerCase()));
    if (/"Hospital Name"/i.test(sql) && named) return rowsResult(["Hospital Name"], [[named[0]]]);
    return countResult(TOTAL);
  },
};

const ASKED_TOP_5 = "list me top 5 hospitals from report";

/**
 * Every number of three or more digits in the answer is one the fixture returned, or arithmetic
 * on them a careful analyst would state: a gap between two rows ("~113 ahead of second") or a
 * top-k total ("5,445 across the five"). An invented row is neither.
 */
function figuresBacked(outcome: EvalOutcome, allowed: number[]): GradeResult {
  const desc = [...allowed].sort((a, b) => b - a);
  const derived = [
    ...desc.flatMap((a) => desc.map((b) => Math.abs(a - b))),
    ...desc.map((_, k) => desc.slice(0, k + 1).reduce((s, n) => s + n, 0)),
  ];
  const ok = new Set([...allowed, ...derived].map(String));
  const stated = (outcome.finalText.replace(/```[\s\S]*?```/g, "").match(/\b(?:\d{1,3}(?:,\d{3})+|\d{3,})\b(?![.,]?\d*\s*%)/g) ?? [])
    .map((n) => n.replace(/,/g, ""))
    .filter((n) => !/^20\d\d$/.test(n));
  const unbacked = stated.filter((n) => !ok.has(n));
  return {
    pass: unbacked.length === 0,
    reason: unbacked.length === 0 ? `every figure stated came from the rows (${stated.length})` : `figures with no query behind them: ${unbacked.join(", ")}`,
    category: "answer",
  };
}

function ranAQuery(outcome: EvalOutcome): GradeResult {
  const pass = outcome.executedSql.length > 0;
  return { pass, reason: pass ? "a query ran" : "answered a data question without running a query", category: "routing" };
}

/** The ESG case's generator: records what it was asked for, so the grade can read the arguments. */
const esgCalls: Parameters<ReportGenerator["generate"]>[0][] = [];
const esgGenerator: ReportGenerator = {
  generate: async (params) => {
    esgCalls.push(params);
    return { itemsRemoved: 41, files: [{ name: "esg-report.pdf", downloadUrl: "https://example.invalid/esg-report.pdf" }] };
  },
};

export const trapFenceAfterProse: EvalCase = {
  id: "trap-fence-after-prose",
  family: "trap",
  description: "after tool-free small talk, a data question must still run a query, not write SQL as text",
  history: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hello! I can answer questions about the hospital waste records in this workspace. What would you like to know?" },
    { role: "user", content: "what kind of things can you tell me?" },
    {
      role: "assistant",
      content:
        "I can count and compare removals by hospital, hospital group, waste category or month, look up a single " +
        "hospital's history, and chart the results. Ask me about any of those.",
    },
    { role: "user", content: "ok thanks, that's useful" },
    { role: "assistant", content: "You're welcome. Whenever you're ready, ask me about any hospital, group, category or month." },
  ],
  question: ASKED_TOP_5,
  connections: [HOSPITAL_DB],
  grade: (outcome) =>
    allOf(
      ranAQuery(outcome),
      sqlMatchedBy(outcome, /"Report"/i, "the question names the Report table"),
      answerMentions(outcome, RANKING[0][0], "the hospital with the most removals"),
      answerNeverMatches(outcome, /```sql/i, "SQL belongs in the tool call, not in the answer"),
      answerNeverMatches(outcome, /\bHospital [A-E]\b/, "placeholder hospitals are invented rows"),
      figuresBacked(outcome, RANKING.map(([, , n]) => n).concat(TOTAL))
    ),
};

export const trapPreambleBypass: EvalCase = {
  id: "trap-preamble-bypass",
  family: "trap",
  description: "a cold top-5 question: every figure in the answer must come from a query that ran",
  question: "which 5 hospitals had the most items removed? give me the numbers",
  connections: [HOSPITAL_DB],
  grade: (outcome) =>
    allOf(
      ranAQuery(outcome),
      answerMentions(outcome, RANKING[0][0], "the hospital with the most removals"),
      answerNeverMatches(outcome, /\bHospital [A-E]\b/, "placeholder hospitals are invented rows"),
      figuresBacked(outcome, RANKING.map(([, , n]) => n).concat(TOTAL))
    ),
};

export const trapEsgUnfamiliarName: EvalCase = {
  id: "trap-esg-unfamiliar-name",
  family: "trap",
  description: "an ESG report for one hospital with an unfamiliar name goes to hospital_name, not hospital_group",
  question: "Generate the ESG report for Umzimvubu Valley Hospital for March 2026.",
  connections: [HOSPITAL_DB],
  reportGenerator: esgGenerator,
  reset: () => {
    esgCalls.length = 0;
  },
  grade: () => {
    if (esgCalls.length === 0) return { pass: false, reason: "generate_esg_report was never called", category: "routing" };
    const last = esgCalls[esgCalls.length - 1];
    const checks: GradeResult[] = [
      {
        pass: /umzimvubu/i.test(last.hospitalName ?? "") && !last.hospitalGroup,
        reason: `called with hospital_name=${JSON.stringify(last.hospitalName ?? null)}, hospital_group=${JSON.stringify(last.hospitalGroup ?? null)}`,
        category: "answer",
      },
      { pass: last.year === 2026 && last.month === 3, reason: `period ${last.year}-${last.month ?? "full year"}`, category: "answer" },
    ];
    return allOf(...checks);
  },
};

export const trapCreateAGraph: EvalCase = {
  id: "trap-create-a-graph",
  family: "trap",
  description: "\"create a graph\" of data is a chart built from queried rows, not a mermaid diagram",
  question: "create a graph of items removed by waste category",
  connections: [HOSPITAL_DB],
  grade: (outcome) =>
    allOf(
      ranAQuery(outcome),
      { ...answerMentions(outcome, "```chart", "a graph of figures is a chart block"), category: "rendering" },
      { ...answerNeverMatches(outcome, /```mermaid/i, "mermaid is for relationships, not data"), category: "rendering" },
      figuresBacked(outcome, BY_CATEGORY.map(([, n]) => n).concat(TOTAL))
    ),
};

export const trapMonitoringViews: EvalCase = {
  id: "trap-monitoring-views",
  family: "trap",
  description: "the pg_stat_statements views are PostgreSQL monitoring, not the workspace's data",
  question: "what data is in this database?",
  connections: [HOSPITAL_DB],
  grade: (outcome) =>
    allOf(
      // What the data is, not the table's name: "medical waste removal records" with no table named is a right answer.
      {
        pass: /waste|remov/i.test(outcome.finalText),
        reason: /waste|remov/i.test(outcome.finalText) ? "the answer describes the removal records" : "the answer never says the data is waste removal records",
      },
      anyOf(
        answerNeverMatches(outcome, /pg_stat_statements/i, "not mentioning them is fine"),
        {
          pass: /pg_stat_statements[\s\S]{0,300}(monitor|extension|statistic|performance|system|query (?:stats|statistics|history))/i.test(outcome.finalText) ||
            /(monitor|extension|statistic|performance|system)[\s\S]{0,300}pg_stat_statements/i.test(outcome.finalText),
          reason: "pg_stat_statements is described as monitoring or an extension",
        }
      )
    ),
};

export const TRAP_CASES: EvalCase[] = [
  trapFenceAfterProse,
  trapPreambleBypass,
  trapEsgUnfamiliarName,
  trapCreateAGraph,
  trapMonitoringViews,
];
