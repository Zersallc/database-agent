/**
 * Family: multi-library.
 *
 * Three libraries and a database, and a question that belongs to one library or
 * to two. Only the relevant libraries are searched, since each search of an
 * irrelevant one is a call the question did not need, and the Sources block
 * carries each file's library because a file name alone would not say which
 * library it came from.
 */

import { allOf } from "../grade";
import { answerMatches, neverRanSql, provenanceHolds, retrievalSucceeded, searchedLibrary, searchedOnly } from "../grade-media";
import { COMPLIANCE, CONTRACTS, HR_POLICIES, salesDatabase } from "../media-fixtures";
import type { EvalCase } from "../types";

const LIBRARIES = [CONTRACTS, HR_POLICIES, COMPLIANCE];

export const mediaMultiLibraryCases: EvalCase[] = [
  {
    id: "media-multi-leave-policy",
    family: "multi-library",
    description: "a leave question goes to HR Policies alone",
    question: "How many days of paid annual leave do full-time employees get?",
    connections: [salesDatabase()],
    libraries: LIBRARIES,
    sources: { required: ["lib:HR Policies"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "HR Policies"),
        searchedOnly(outcome, ["HR Policies"]),
        neverRanSql(outcome, "leave entitlement is a policy, not a table"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /twenty|\b20\b/i, "the entitlement the policy states"),
        provenanceHolds(outcome, { cites: ["leave_policy.pdf"] })
      ),
  },
  {
    id: "media-multi-audit-findings",
    family: "multi-library",
    description: "an audit question goes to Compliance alone",
    question: "How many findings did the 2025 internal audit raise, and how many are still open?",
    connections: [salesDatabase()],
    libraries: LIBRARIES,
    sources: { required: ["lib:Compliance"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Compliance"),
        searchedOnly(outcome, ["Compliance"]),
        neverRanSql(outcome, "audit findings are in the audit report"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /\b(three|3)\b/i, "the number of findings the audit states"),
        provenanceHolds(outcome, { cites: ["audit_2025.pdf"] })
      ),
  },
  {
    id: "media-multi-two-relevant",
    family: "multi-library",
    description: "a question that spans two libraries searches both and not the third",
    question: "What retention or confidentiality periods do our documents set, for data and for confidential information?",
    connections: [],
    libraries: LIBRARIES,
    sources: { required: ["lib:Contracts", "lib:Compliance"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        searchedLibrary(outcome, "Compliance"),
        searchedOnly(outcome, ["Contracts", "Compliance"]),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /\b(five|5)\b/i, "the confidentiality period in the NDA"),
        answerMatches(outcome, /\b(seven|7)\b/i, "the retention period in the GDPR register"),
        provenanceHolds(outcome, { cites: ["nda_2024.pdf", "gdpr_register.pdf"] })
      ),
  },
];
