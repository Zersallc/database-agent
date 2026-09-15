/**
 * LLM-as-judge, for the minority of properties a regex over executed SQL
 * can't check — whether the answer's prose narrates a recovered mistake, for
 * instance. Kept deliberately separate from `grade.ts`: everything there is
 * free and deterministic, everything here costs a call and can be wrong.
 */

import type { ModelClient } from "@/lib/agent/providers/types";
import type { GradeResult } from "./types";

const JUDGE_SYSTEM =
  "You grade one AI agent's reply against one rule. Reply with nothing but JSON: " +
  '{"pass": true|false, "reason": "one sentence"}. No markdown fence, no other text.';

export async function llmJudge(
  question: string,
  rubric: string,
  finalText: string,
  client: ModelClient
): Promise<GradeResult> {
  const prompt =
    `The reader asked: ${JSON.stringify(question)}\n\n` +
    `The agent's full reply:\n${finalText}\n\n` +
    `Rule to check: ${rubric}`;

  let text = "";
  for await (const event of client.stream({
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    tools: [],
    maxTokens: 300,
    effort: "low",
    enableThinking: false,
  })) {
    if (event.type === "turn") text = event.turn.text;
  }

  const cleaned = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { pass: boolean; reason: string };
    return { pass: Boolean(parsed.pass), reason: parsed.reason ?? "(no reason given)" };
  } catch {
    return { pass: false, reason: `judge did not return valid JSON: ${text.slice(0, 200)}` };
  }
}
