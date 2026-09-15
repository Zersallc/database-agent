/**
 * "Show me details of the sept 11 one" — about a row already on screen.
 *
 * The incident: the previous turn listed three observations and labelled the
 * first "Sept 11, 2026", reading the date off `"Timestamp"`, which is what the
 * listing had sorted by. Asked to open that one, the agent filtered `"Date"` to
 * September 11 instead, got nothing back, and told the reader no observation
 * existed on that date. The row was real, it was on screen, and its id was in
 * the first column of the table the reader was looking at.
 *
 * Two ways to pass, and the fixture accepts either, because both are correct:
 * go back to the row by the id the listing carried, or notice that this table
 * dates a row four ways and try the one the answer was labelled by. What must
 * not happen is a third query on `"Date"` alone, or a reported absence.
 */

import { allOf, answerMentions, answerNeverMatches } from "../grade";
import { rowsResult } from "../fixtures";
import type { EvalCase } from "../types";

const ID = "6d24bef9";

/** One row, dated the 10th by `Date` and the 11th by `Timestamp`. */
const ROW = [
  ID,
  "2026-09-11T12:45:00.000Z",
  "2026-09-10T04:00:00.000Z",
  "Camp - Wadi Laithem",
  "A disposable plastic spoon with a sharp edge caused cuts to the lips and mouth.",
  "Closed",
];

const COLUMNS = ["ID", "Timestamp", "Date", "Location1", "Observation or Finding", "Status"];

function column(name: string, data_type: string, primary_key = false) {
  return { name, data_type, nullable: !primary_key, primary_key, description: null };
}

export const followUpRowOnScreen: EvalCase = {
  id: "follow-up-row-on-screen",
  description: "a follow-up about a row already listed must reach that row, not report it missing",
  question: "show me details of sept 11 one",
  now: new Date("2026-09-15T12:00:00Z"),
  history: [
    { role: "user", content: "show me the recent 3 observations" },
    {
      role: "assistant",
      content:
        `Here are the 3 most recent observations, newest first.\n\n` +
        `The most recent (${ID}, Sept 11, 2026) is a Camp - Wadi Laithem hygiene finding and is already ` +
        `closed; the other two are both OXY North ladder defects from Sept 10 and both are still open.`,
    },
  ],
  connections: [
    {
      name: "Observations",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "Observations DB",
          description: "One row per reported observation.",
          row_estimate: 1200,
          columns: [
            column("ID", "text", true),
            column("Timestamp", "timestamp without time zone"),
            column("Date", "timestamp without time zone"),
            column("Last Edited DateTime", "timestamp without time zone"),
            column("Closer DateTime", "timestamp without time zone"),
            column("Location1", "text"),
            column("Observation or Finding", "text"),
            column("Status", "text"),
          ],
        },
      ],
      /**
       * Stands in for the real table on the one distinction that matters: the
       * row is reachable by its id, or by the column the listing dated it with,
       * and not by the column the incident filtered.
       */
      execute: async (sql: string) => {
        const byId = sql.includes(ID);
        const byTimestamp = /"Timestamp"/i.test(sql) && sql.includes("2026-09-11");
        const everything = !/\bWHERE\b/i.test(sql);
        return byId || byTimestamp || everything ? rowsResult(COLUMNS, [ROW]) : rowsResult(COLUMNS, []);
      },
    },
  ],
  grade: (outcome) =>
    allOf(
      answerMentions(outcome, "spoon", "the finding on the row the reader pointed at"),
      answerNeverMatches(
        outcome,
        /\bno (?:observations?|rows|records|results|entries|data|matches)\b|\bnothing (?:was )?found\b|\bnot found\b/i,
        "the row exists and was on screen one turn earlier"
      )
    ),
};
