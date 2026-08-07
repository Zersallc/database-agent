"use client";

import { useState } from "react";
import { CopyIcon, LightbulbIcon, LoaderIcon, PlayIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "./CodeBlock";
import { TableBlock } from "./TableBlock";
import { mockExecute, mockExplain, type QueryResult } from "./sql/mockExecute";

export function SQLBlock({ sql }: { sql: string }) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      setResult(await mockExecute(sql));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="my-3 not-prose">
      <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-b-0 border-border bg-muted/60 px-2 py-1.5">
        <Badge variant="outline">SQL</Badge>
        <Button size="xs" onClick={run} disabled={running}>
          {running ? <LoaderIcon className="animate-spin" /> : <PlayIcon />}
          {running ? "Running…" : "Execute"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setExplain((prev) => (prev ? null : mockExplain(sql)))}
        >
          <LightbulbIcon />
          Explain
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => navigator.clipboard.writeText(sql)}
        >
          <CopyIcon />
          Copy
        </Button>
        {result && (
          <Badge variant="secondary">
            {result.rowCount} rows · {result.executionTimeMs} ms
          </Badge>
        )}
      </div>

      <CodeBlock
        code={sql}
        language="sql"
        showHeader={false}
        className="my-0 rounded-t-none"
      />

      {explain && (
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {explain}
        </pre>
      )}

      {result && <TableBlock columns={result.columns} rows={result.rows} />}
    </div>
  );
}
