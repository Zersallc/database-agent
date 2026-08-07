import { NextRequest, NextResponse } from "next/server";

type Message = {
  role: "user" | "assistant";
  content: string;
};

// Exercises every content handler the frontend knows how to render.
const DEMO_REPLY = `Database and AI integration isn't connected yet, so here's a demo of the rendering pipeline instead.

\`\`\`status
{"title": "How I got this", "steps": [{"label": "Connected to database", "status": "done"}, {"label": "Found relevant tables", "status": "done"}, {"label": "Ran query", "status": "done"}, {"label": "Created visualization", "status": "done"}]}
\`\`\`

**SQL** — press Execute to run it against the mock executor.

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

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as {
    messages: Message[];
    connectionId?: string;
  };
  const lastUserMessage = messages[messages.length - 1]?.content ?? "";

  // TODO: replace with a real LLM call + database query once credentials are provided.
  const reply = `You asked: "${lastUserMessage}"\n\n${DEMO_REPLY}`;

  return NextResponse.json({ reply });
}
