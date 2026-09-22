/**
 * Family: PostgreSQL-only.
 *
 * The workspace has a document library, and the question is about something
 * the database holds even though it is worded like documents. A register of
 * contracts is rows, and "how many contracts expire this year" is a query.
 * This is the shape of the question from the transcript that started the media
 * work ("how many contracts" answered from a table), and the risk here is the
 * opposite one from the rest of the suite: having a library available must not
 * pull a figures question toward the documents.
 *
 * Passes when a query is run and no search is made.
 */

import { allOf } from "../grade";
import { neverSearched, usedSql } from "../grade-media";
import { CONTRACTS, salesDatabase } from "../media-fixtures";
import type { EvalCase } from "../types";

export const mediaPostgresOnlyCases: EvalCase[] = [
  {
    id: "media-pg-contracts-register",
    family: "postgres-only",
    description: "a count of contracts on record is a query on the register, not a search of the contract documents",
    question: "How many supplier contracts do we have on record?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["db:Sales"], allowed: [] },
    grade: (outcome) =>
      allOf(
        usedSql(outcome, "the register of supplier contracts is a table"),
        neverSearched(outcome, "a count of rows in the register does not need the contract documents")
      ),
  },
  {
    id: "media-pg-expiring-contracts",
    family: "postgres-only",
    description: "which contracts expire by a date is a query on the register's expiry column",
    question: "How many supplier contracts expire before the end of 2026?",
    now: new Date("2026-09-21T12:00:00Z"),
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["db:Sales"], allowed: [] },
    grade: (outcome) =>
      allOf(
        usedSql(outcome, "the register has an expires_on column"),
        neverSearched(outcome, "an expiry date is a column, not something the documents are needed for")
      ),
  },
];
