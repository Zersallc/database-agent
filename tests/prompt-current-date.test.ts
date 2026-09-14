/**
 * The current-date grounding in the system prompt.
 *
 * Nothing else in the prompt carries the wall-clock date, so a year-omitted
 * or relative date the reader asks about has to be resolved against
 * something — see prompt.ts's `renderCurrentDate` for the incident this
 * exists to prevent: a query landing on 2021 for a database whose rows were
 * all 2026, because nothing told the model what year it actually was.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "@/lib/agent/prompt";

function prompt(now: Date): string {
  return buildSystemPrompt({
    playbookContext: "",
    responseDetail: "balanced",
    connections: [],
    now,
  });
}

describe("grounding the model in the actual date", () => {
  test("today's date reaches the prompt in YYYY-MM-DD", () => {
    const rendered = prompt(new Date("2026-09-14T12:00:00Z"));
    assert.match(rendered, /Today is 2026-09-14/);
  });

  test("a different run date renders a different date, not a cached one", () => {
    const rendered = prompt(new Date("2021-01-05T00:00:00Z"));
    assert.match(rendered, /Today is 2021-01-05/);
    assert.doesNotMatch(rendered, /2026-09-14/);
  });

  test("the guidance tells the model to resolve year-omitted dates from it", () => {
    const rendered = prompt(new Date("2026-09-14T00:00:00Z"));
    assert.match(rendered, /year the reader left out|resolve every relative/i);
  });
});
