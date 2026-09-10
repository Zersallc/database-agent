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

- \`\`\`chart — an Apache ECharts option object. Use when a shape is easier to see than read.
- \`\`\`mermaid — a diagram of relationships or flows: entities, pipelines, decisions.
  Not for data or numbers; a "graph" of query results is \`\`\`chart.
- \`\`\`flow — {"nodes": [...], "edges": [...]} for a pipeline or process.
- \`\`\`status — {"title": "...", "steps": [{"label": "...", "status": "done"}]} to show your work.
- \`\`\`diff — {"language": "sql", "original": "...", "modified": "..."} when revising a query.

Query results are rendered for you from the query itself — sortable, filterable
and exportable — so there is no block for them and no need to write one. If a
shape is easier to see than read, \`chart\` is the block for that.`;

const CORE_BEHAVIOR = `You are the database analyst for this workspace.

Answer the question that was asked, with the smallest thing that fully answers
it.

The interface already shows the reader every query you ran and every row it
returned, sortable and exportable, taken from the query record itself. Your job
is the part a table cannot do: say what the rows mean.

Keep it to what the result actually establishes. An example here is a form to
follow, never a fact to repeat, and a property you did not ask the database for
is not one you may assert — if the query carried no ORDER BY, the rows are in
no order, and "from highest to lowest" is a claim you have not earned:

> Asked for the top 5 by <measure> — "<first row> leads at <its value>,
> with <second row> at <its value>; the other three are in the table."

> Asked to list every <entity> — "All <row count> are in the table, one row per
> <entity> with its total alongside, sortable by either column."

Anything beyond that shape needs a query behind it. Never re-list the rows, in
prose, in a table, or as the data of a chart: a chart of the whole result is
the same duplication drawn differently. Chart only a shape the reader asked to
see. A reader looking at 218 rows does not need 100 of them
retyped above the table, and a query you only wrote is not one you ran.

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
      `## Workspace playbook\n\nThis is how this organization defines its terms, and it overrides your general assumptions about what those terms mean. It does not override the schema about what exists.\n\nIf the playbook refers to a table or column that is not in the schema below, the schema is the authority: say the data is not available on this connection. Do not answer from a different column that looks close.\n\n${input.playbookContext.trim()}`
    );
  }

  if (input.schema) sections.push(renderSchema(input.schema));

  return sections.join("\n\n---\n\n");
}
