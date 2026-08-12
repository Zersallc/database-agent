"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRightIcon,
  CopyIcon,
  LightbulbIcon,
  LoaderIcon,
  PlayIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  downloadCSV,
  downloadElementAsPdf,
  downloadText,
  safeFilename,
} from "@/lib/export";
import { useSettings } from "@/lib/settings-store";
import { BlockToolbar } from "./BlockToolbar";
import { CodeBlock } from "./CodeBlock";
import { TableBlock } from "./TableBlock";
import { mockExecute, mockExplain, type QueryResult } from "./sql/mockExecute";

export function SQLBlock({ sql, name = "query" }: { sql: string; name?: string }) {
  const { autoRunSql } = useSettings();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  // Start in the running state when auto-run is on, so the effect below only
  // ever sets state from its callback.
  const [running, setRunning] = useState(autoRunSql);
  // Collapsed by default — the SQL is how the answer was produced, not the
  // answer itself. The reader who wants to check the work can expand it.
  const [open, setOpen] = useState(false);
  // Exports target the content only, so the toolbar never lands in the file.
  const contentRef = useRef<HTMLDivElement>(null);

  async function run() {
    setRunning(true);
    try {
      setResult(await mockExecute(sql));
    } finally {
      setRunning(false);
    }
  }

  // "Auto-run generated SQL" in settings — execute without waiting for a click.
  useEffect(() => {
    if (!autoRunSql) return;
    let cancelled = false;
    mockExecute(sql).then((next) => {
      if (cancelled) return;
      setResult(next);
      setRunning(false);
    });
    return () => {
      cancelled = true;
    };
  }, [autoRunSql, sql]);

  const base = safeFilename(name, "query");

  return (
    <div className="my-3 not-prose">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 data-[panel-open]:rounded-b-none data-[panel-open]:border-b-0">
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-150 data-[panel-open]:rotate-90" />
          <Badge variant="outline">SQL</Badge>
          <span>{open ? "Hide query" : "Show query"}</span>
          {running && <LoaderIcon className="size-3.5 animate-spin" />}
          {result && (
            <Badge variant="secondary" className="ml-auto">
              {result.rowCount} rows · {result.executionTimeMs} ms
            </Badge>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <BlockToolbar
            exports={[
              {
                label: ".sql file",
                onSelect: () => downloadText(sql, `${base}.sql`, "text/plain"),
              },
              ...(result
                ? [
                    {
                      label: "Results CSV",
                      onSelect: () =>
                        downloadCSV(result.columns, result.rows, `${base}-results.csv`),
                    },
                  ]
                : []),
              {
                label: "PDF",
                onSelect: () =>
                  contentRef.current &&
                  downloadElementAsPdf(contentRef.current, `${base}.pdf`),
              },
            ]}
          >
            <Button size="xs" onClick={() => void run()} disabled={running}>
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
              onClick={() => navigator.clipboard.writeText(sql)}
            >
              <CopyIcon />
              Copy
            </Button>
          </BlockToolbar>

          {/* Everything below the toolbar — this is what exports capture.
              Nested toolbars (the results table's) are skipped via
              data-export-ignore. */}
          <div ref={contentRef}>
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

            {result && (
              <TableBlock
                columns={result.columns}
                rows={result.rows}
                name={`${base}-results`}
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
