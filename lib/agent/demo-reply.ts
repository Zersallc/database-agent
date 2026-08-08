/**
 * The reply served when no model provider is configured.
 *
 * This is what a fresh checkout sees, and it has one job: make the workspace
 * legible before anyone has an API key. It exercises every content handler the
 * frontend knows how to render, and it says plainly that it is a demo — an
 * unconfigured deployment that looked like a working one would be worse than an
 * empty screen.
 */

export const SETUP_NOTICE = `**No model provider is configured**, so this is a rendering demo rather than a real answer.

To connect the agent, set \`ANTHROPIC_API_KEY\` in the environment and restart. Then attach a database under **Connections** and ask again.`;

export const DEMO_REPLY = `${SETUP_NOTICE}

\`\`\`status
{"title": "What a real run looks like", "steps": [{"label": "Read the schema", "status": "done"}, {"label": "Wrote a query", "status": "done"}, {"label": "Ran it against the connection", "status": "done"}, {"label": "Charted the result", "status": "done"}]}
\`\`\`

**SQL** — press Execute to run it against the sample dataset.

\`\`\`sql
SELECT region, plan, COUNT(*) AS customers, SUM(amount) AS revenue
FROM orders
JOIN customers USING (customer_id)
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY region, plan
ORDER BY revenue DESC;
\`\`\`

**Table**
\`\`\`table
{"columns": ["Metric", "Value"], "rows": [["Active users", 128], ["Revenue", "$4,200"], ["Errors (24h)", 3]]}
\`\`\`

**Chart**
\`\`\`chart
{"xAxis": {"type": "category", "data": ["Mon", "Tue", "Wed", "Thu", "Fri"]}, "yAxis": {"type": "value"}, "series": [{"type": "bar", "data": [12, 19, 8, 15, 22], "itemStyle": {"color": "#008CF0"}}]}
\`\`\`

**Diagram**
\`\`\`mermaid
graph TD
  A[Question] --> B[Database Agent]
  B --> C[SQL Query]
  C --> D[Results]
\`\`\`

**Workflow**
\`\`\`flow
{"nodes": [{"id": "1", "position": {"x": 0, "y": 60}, "data": {"label": "User Question"}}, {"id": "2", "position": {"x": 220, "y": 60}, "data": {"label": "Database Agent"}}, {"id": "3", "position": {"x": 440, "y": 60}, "data": {"label": "SQL Query"}}, {"id": "4", "position": {"x": 660, "y": 60}, "data": {"label": "Results"}}], "edges": [{"id": "e1-2", "source": "1", "target": "2"}, {"id": "e2-3", "source": "2", "target": "3"}, {"id": "e3-4", "source": "3", "target": "4"}]}
\`\`\`

**Diff**
\`\`\`diff
{"language": "sql", "title": "Added the 90-day window", "original": "SELECT region, COUNT(*)\\nFROM orders\\nGROUP BY region;", "modified": "SELECT region, COUNT(*)\\nFROM orders\\nWHERE created_at >= NOW() - INTERVAL '90 days'\\nGROUP BY region;"}
\`\`\`

**File**
\`\`\`file
{"name": "regional-revenue-q3.csv", "type": "csv", "size": "18 KB"}
\`\`\`
`;
