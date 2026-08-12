/**
 * System prompt assembly.
 *
 * Four things go into the model's context, in this order: how to behave, how to
 * format, what the tenant's playbook says, and what the database actually looks
 * like. Order matters for prompt caching — the first two are identical across
 * every request in the deployment, the playbook changes rarely, and the schema
 * changes per connection. Stable content first means the shared prefix caches.
 */

import type { SchemaTable } from "@/lib/connectors";

export type ResponseDetail = "concise" | "balanced" | "detailed";

/**
 * The rendering contract with the frontend.
 *
 * `components/chat/Markdown.tsx` dispatches fenced blocks to interactive
 * handlers by language. The model has to know these exist or it will answer
 * every question in prose and the entire renderer goes unused.
 */
const OUTPUT_FORMAT = `## How your answers are rendered

Your reply is markdown. Fenced code blocks with these languages become
interactive components; anything else renders as a plain code block.

- \`\`\`sql — the query you ran. Always show it. The reader can re-run and edit it.
- \`\`\`table — {"columns": ["A","B"], "rows": [[1,2]]}. Sortable, filterable, exportable.
- \`\`\`chart — an Apache ECharts option object. Use when a shape is easier to see than read.
- \`\`\`mermaid — a diagram, for relationships and flows.
- \`\`\`flow — {"nodes": [...], "edges": [...]} for a pipeline or process.
- \`\`\`status — {"title": "...", "steps": [{"label": "...", "status": "done"}]} to show your work.
- \`\`\`diff — {"language": "sql", "original": "...", "modified": "..."} when revising a query.

Put results in a \`table\` or \`chart\` block rather than a markdown table — the
handlers give the reader sorting, filtering, and export that plain text cannot.`;

const CORE_BEHAVIOR = `You are the database analyst for this workspace.

Answer the question that was asked, with the smallest thing that fully answers
it. Show the SQL you ran so the reader can check your work.

A greeting, thanks, or other small talk is not a question — reply in kind,
briefly, and stop there. Do not run a query, recite the schema, or volunteer
an analysis nobody asked for; wait for an actual question first.

Rules that matter more than being helpful:
- Never invent a number. Every figure in your answer comes from a query result
  in this conversation. If you did not run a query, say so.
- If the schema cannot answer the question, say that plainly and say what is
  missing. A wrong answer delivered confidently is worse than no answer.
- Check the schema before writing SQL. Do not guess at table or column names.
- If a query fails, read the error, fix the query, and try again. Explain what
  was wrong only if the reader would care.
- State your assumptions when a question is ambiguous, then answer under them
  rather than stopping to ask — unless the readings differ enough that the
  answer would be materially different, in which case ask.`;

const DETAIL_GUIDANCE: Record<ResponseDetail, string> = {
  concise:
    "Keep it short. Lead with the answer, show the SQL, stop. Skip the walkthrough unless something surprising happened.",
  balanced:
    "Lead with the answer, then the supporting detail. Explain a caveat when it changes how the number should be read.",
  detailed:
    "Give the answer, then the reasoning: why this query, what the joins assume, what the caveats are, and what to look at next.",
};

export function renderSchema(tables: SchemaTable[]): string {
  if (tables.length === 0) {
    return "## Database schema\n\nThe schema could not be read. Say so rather than guessing at table names.";
  }

  const rendered = tables
    .map((table) => {
      const qualified = table.schema ? `${table.schema}.${table.name}` : table.name;
      const header = table.description ? `### ${qualified} — ${table.description}` : `### ${qualified}`;
      const rows = table.row_estimate ? ` (~${table.row_estimate.toLocaleString()} rows)` : "";
      const columns = table.columns
        .map((column) => {
          const flags = [
            column.primary_key ? "PK" : null,
            column.nullable ? null : "NOT NULL",
          ].filter(Boolean);
          const suffix = flags.length ? ` [${flags.join(", ")}]` : "";
          const note = column.description ? ` — ${column.description}` : "";
          return `- ${column.name}: ${column.data_type}${suffix}${note}`;
        })
        .join("\n");
      return `${header}${rows}\n${columns}`;
    })
    .join("\n\n");

  return `## Database schema\n\n${rendered}`;
}

export type PromptInput = {
  /** The tenant's playbook: system prompt plus enabled skills, already assembled. */
  playbookContext: string;
  responseDetail: ResponseDetail;
  connection: { name: string; engine: string } | null;
  schema: SchemaTable[] | null;
};

export function buildSystemPrompt(input: PromptInput): string {
  const sections = [CORE_BEHAVIOR, OUTPUT_FORMAT, DETAIL_GUIDANCE[input.responseDetail]];

  if (input.connection) {
    sections.push(
      `## Connection\n\nYou are querying "${input.connection.name}" (${input.connection.engine}). Write SQL in that engine's dialect.` +
        (input.connection.engine === "demo"
          ? "\n\nThis is the built-in sample dataset, not real data. Say so in your answer so nobody acts on these numbers."
          : "")
    );
  } else {
    sections.push(
      "## Connection\n\nNo database is attached to this conversation. You cannot run queries. Say so and explain that a connection needs to be selected."
    );
  }

  if (input.playbookContext.trim()) {
    sections.push(
      `## Workspace playbook\n\nThis is how this organization defines its terms. It overrides your general assumptions.\n\n${input.playbookContext.trim()}`
    );
  }

  if (input.schema) sections.push(renderSchema(input.schema));

  return sections.join("\n\n---\n\n");
}
