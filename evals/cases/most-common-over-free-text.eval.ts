/**
 * "What is the most common observation in the last 2 months?"
 *
 * The incident: the agent grouped `"Observation or Finding"` — one narrative
 * sentence per record — counted the groups, ordered by the count descending,
 * took the first and answered "the most used observation is 'Acid plant motor
 * complete rusted and need repaint with acid coated special paint,' which was
 * recorded once". Ordered by count descending, a top count of 1 makes 1 the
 * maximum: nothing repeated, and the row that came back was whichever tie the
 * engine reached first.
 *
 * The table has the column the question is actually about sitting next to the
 * one that was grouped. Both are text; the difference is that one holds
 * sixteen classifications and the other holds a distinct value per row, which
 * is why the schema now says so rather than leaving it to be inferred from the
 * name.
 *
 * Two ways to pass, and the fixture accepts either, because both are correct:
 * group the classification and say which column was counted, or tell the
 * reader the free-text column has one value per record and so no most-common
 * one. What must not happen is a winner named over a count of 1.
 */

import { allOf, answerMentions, answerNeverMatches, anyOf, sqlMatchedBy } from "../grade";
import { rowsResult } from "../fixtures";
import type { SchemaColumn } from "@/lib/connectors";
import type { EvalCase } from "../types";

const FINDING = "Acid plant motor complete rusted and need repaint with acid coated special paint";

/** The sixteen classifications, as the real table distributes them over two months. */
const BY_SUBCLASSIFICATION: [string, number][] = [
  ["Tools or Equipment or Safety Devices", 44],
  ["Environmental (Spills, Waste, Emission etc.)", 26],
  ["Falling or Tripping or Slipping Hazards", 19],
  ["Driving or Vehicle Hazards", 18],
  ["Work Condition (Light, Heat, Noise, etc.)", 12],
  ["Hazardous Material Hazards", 12],
  ["Procedure or Standards", 10],
  ["Quality and CI Observation", 9],
  ["Electrical Hazards", 9],
  ["Personal Protective Equipment (PPE)", 7],
];

function column(name: string, data_type: string, extra: Partial<SchemaColumn> = {}): SchemaColumn {
  return { name, data_type, nullable: true, primary_key: false, description: null, ...extra };
}

export const mostCommonOverFreeText: EvalCase = {
  id: "most-common-over-free-text",
  description: "a frequency question must be counted over a column whose values repeat",
  question: "what is the most common observation in the last 2 months",
  now: new Date("2026-09-15T12:00:00Z"),
  connections: [
    {
      name: "Observations",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "Observations DB",
          description: "One row per reported observation.",
          row_estimate: 5437,
          columns: [
            column("ID", "text"),
            column("Timestamp", "timestamp without time zone"),
            column("Date", "timestamp without time zone"),
            column("Location1", "text"),
            // The column the question is about, and the one the incident
            // grouped, side by side and identical but for this.
            column("HSE Observation SubClassification", "text", {
              distinct_values: { list: BY_SUBCLASSIFICATION.map(([name]) => name), complete: false },
            }),
            column("Observation or Finding", "text", { mostly_unique: true }),
            column("Status", "text"),
          ],
        },
      ],
      /**
       * Stands in for the real table on the one distinction that matters: the
       * classification repeats and the finding does not.
       */
      execute: async (sql: string) => {
        if (/SubClassification/i.test(sql) && /\bGROUP\s+BY\b/i.test(sql)) {
          return rowsResult(["subclassification", "observations"], BY_SUBCLASSIFICATION.map((row) => [...row]));
        }
        if (/Observation or Finding/i.test(sql) && /\bGROUP\s+BY\b/i.test(sql)) {
          // Every group holds exactly one row — the shape that has no winner in it.
          return rowsResult(
            ["Observation or Finding", "count"],
            [[FINDING, 1], ["Ladder missing a foot on the north rack", 1], ["Spill kit seal broken", 1]]
          );
        }
        if (/\bCOUNT\s*\(/i.test(sql)) return rowsResult(["count"], [[189]]);
        return rowsResult(["ID", "Observation or Finding"], [["6d24bef9", FINDING]]);
      },
    },
  ],
  grade: (outcome) =>
    allOf(
      answerNeverMatches(
        outcome,
        /most (?:used|common|frequent|reported)[^.!?\n]{0,120}\bonce\b/i,
        "a value counted once is not the most common one"
      ),
      answerNeverMatches(
        outcome,
        /most (?:used|common|frequent|reported)[^.!?\n]{0,40}Acid plant motor/i,
        "the free-text finding is a tie-break, not a winner"
      ),
      anyOf(
        allOf(
          sqlMatchedBy(
            outcome,
            /GROUP\s+BY[\s\S]*SubClassification|SubClassification[\s\S]*GROUP\s+BY/i,
            "counted the column whose values repeat"
          ),
          answerMentions(outcome, "Tools or Equipment", "the classification that actually leads")
        ),
        answerMentions(
          outcome,
          "no most common",
          "or said plainly that a free-text column has no most-common value"
        )
      )
    ),
};
