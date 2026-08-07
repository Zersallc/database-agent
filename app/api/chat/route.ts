import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const DEMO_REPLY = `Database and AI integration isn't connected yet, so here's a demo of the rendering pipeline instead.

**Table**
\`\`\`table
{"columns": ["Metric", "Value"], "rows": [["Active users", 128], ["Revenue", "$4,200"], ["Errors (24h)", 3]]}
\`\`\`

**Chart**
\`\`\`chart
{"xAxis": {"type": "category", "data": ["Mon", "Tue", "Wed", "Thu", "Fri"]}, "yAxis": {"type": "value"}, "series": [{"type": "bar", "data": [12, 19, 8, 15, 22], "itemStyle": {"color": "#3b82f6"}}]}
\`\`\`

**Code**
\`\`\`sql
SELECT id, name FROM users WHERE active = true;
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
`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages } = (await req.json()) as { messages: Message[] };
  const lastUserMessage = messages[messages.length - 1]?.content ?? "";

  // TODO: replace with a real LLM call + database query once credentials are provided.
  const reply = `You asked: "${lastUserMessage}"\n\n${DEMO_REPLY}`;

  return NextResponse.json({ reply });
}
