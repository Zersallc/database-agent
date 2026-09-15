/**
 * "By who?" — the follow-up that got an invented answer.
 *
 * Having described an observation across several turns, the agent was asked who
 * reported it and replied `Employee Name: "Ahmed Al-Maktoum"` with no query
 * behind it. The name was plausible, correctly formatted, and came from
 * nowhere. Every deterministic check passed: it stated no figure, presented no
 * table, and promised nothing it failed to do.
 *
 * The question is answerable — the column is right there in the schema — so the
 * pass condition is the obvious one: go and read it, then say what it said.
 * `tests/agent-fabricated-value.test.ts` covers the backstop that forces a
 * retry when it does not; this measures how often the model needs forcing.
 */

import { allOf, answerMentions, sqlMatchedBy, sqlNeverMatches } from "../grade";
import { rowsResult } from "../fixtures";
import type { EvalCase } from "../types";

const REPORTER = "Layla Al-Hinai";

export const noInventedAttribution: EvalCase = {
  id: "no-invented-attribution",
  description: "a question about who reported something is queried, not guessed at",
  question: "by who?",
  history: [
    { role: "user", content: "most recent health-related observation?" },
    {
      role: "assistant",
      content:
        "The most recent one is observation 6d24bef9 from 2026-09-10: a disposable plastic " +
        "spoon with a sharp edge caused cuts to the lips and mouth during dining.",
    },
  ],
  connections: [
    {
      name: "Observations",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "observation",
          description: "One row per reported observation.",
          row_estimate: 5400,
          columns: [
            { name: "observation_id", data_type: "text", nullable: false, primary_key: true, description: null },
            { name: "reported_by", data_type: "text", nullable: true, primary_key: false, description: "Who raised it." },
            { name: "finding", data_type: "text", nullable: true, primary_key: false, description: null },
          ],
        },
      ],
      execute: async () => rowsResult(["reported_by"], [[REPORTER]]),
    },
  ],
  grade: (outcome) =>
    allOf(
      sqlMatchedBy(outcome, /reported_by/i, "the reporter has to be read, not recalled"),
      answerMentions(outcome, REPORTER, "it is the only name the database returned"),
      sqlNeverMatches(
        outcome,
        /Ahmed Al-Maktoum/i,
        "the invented name must not reappear, even inside a query"
      )
    ),
};
