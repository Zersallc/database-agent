/**
 * The same measurements as the report, as data.
 *
 * The Markdown report is for reading. This is for anything that needs the
 * numbers themselves: a later comparison with another evaluation, or a check that
 * two runs of the analysis produced the same thing. It is a pure function of the
 * loaded results, like the report, and contains no judgment.
 */

import { pairControls } from "./controls";
import { isLoaded, type Loaded, type Role } from "./manifest";
import {
  answerGivenRouting,
  cost,
  failureAccounting,
  multiSource,
  passes,
  provenance,
  retries,
  searchRate,
  sourceSelection,
  toolSelection,
  unnecessarySearches,
  type Expectations,
} from "./metrics";
import { comparePasses, summarizeCase } from "./repeat";

export function analysisSummary(results: Map<Role, Loaded>, expectations: Expectations, generatedAt: string) {
  const roles: Record<string, unknown> = {};
  for (const [role, result] of results) {
    if (result.state !== "loaded") {
      roles[role] = { state: result.state, title: result.entry.title, path: result.entry.path };
      continue;
    }
    const cases = result.cases;
    roles[role] = {
      state: "loaded",
      title: result.entry.title,
      path: result.entry.path,
      meta: result.meta,
      passes: passes(cases),
      searchRate: searchRate(cases),
      accounting: failureAccounting(cases),
      cost: cost(cases),
      toolSelection: toolSelection(cases, expectations),
      sourceSelection: sourceSelection(cases),
      multiSource: multiSource(cases, expectations),
      unnecessary: unnecessarySearches(cases, expectations),
      provenance: provenance(cases),
      retries: retries(cases),
      answerGivenRouting: answerGivenRouting(cases),
      cases: cases.map(summarizeCase),
    };
  }

  const first = results.get("media_pass_1");
  const second = results.get("media_pass_2");
  const repeat = isLoaded(first) && isLoaded(second) ? comparePasses(first.cases, second.cases) : null;

  const controls: Record<string, unknown> = {};
  for (const role of ["control_no_database", "control_relevant_library", "control_no_library"] as Role[]) {
    const control = results.get(role);
    controls[role] = isLoaded(control) ? pairControls(control.cases, isLoaded(first) ? first.cases : [], isLoaded(second) ? second.cases : []) : null;
  }

  return { generatedAt, roles, repeat, controls };
}
