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
import { useWorkspace } from "@/lib/chat-store";
import { useSettings } from "@/lib/settings-store";
import { BlockToolbar } from "./BlockToolbar";
import { CodeBlock } from "./CodeBlock";
import { TableBlock } from "./TableBlock";
import { executeQuery, type QueryResult } from "./sql/execute";

/** Shown instead of results when there is nothing to run the query against. */
const NO_CONNECTION =
  "No database is attached to this conversation, so this query was not run.";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "The query could not be run.";
}

export function SQLBlock({
  sql,
  name = "query",
  autoRun = false,
}: {
  sql: string;
  name?: string;
  /** Set only for the newest message — see `Markdown`. */
  autoRun?: boolean;
}) {
  const { autoRunSql: autoRunSetting } = useSettings();
  // Both must hold: the setting is on, and this block is in the newest message.
  const autoRunSql = autoRunSetting && autoRun;
  const { activeConversation, activeConnection } = useWorkspace();
  // The conversation's own connection first: that is the database the agent
  // answered against, and re-running its SQL somewhere else would compare two
  // different things while looking like one.
  const connectionId = activeConversation.connectionId || activeConnection.id || "";
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  // Start in the running state when auto-run is on, so the effect below only
  // ever sets state from its callback.
  const [running, setRunning] = useState(autoRunSql && Boolean(connectionId));
  // Collapsed by default — the SQL is how the answer was produced, not the
  // answer itself. The reader who wants to check the work can expand it.
  const [open, setOpen] = useState(false);
  // Exports target the content only, so the toolbar never lands in the file.
  const contentRef = useRef<HTMLDivElement>(null);
  // Which (connection, statement) pair auto-run has already fired for. When the
  // result was fabricated in the browser a repeat cost nothing; now every one is
  // a real query against the customer's database, and React re-runs this effect
  // on remount, on StrictMode's double-invoke, and once more when the store
  // settles and `connectionId` goes from "" to real. Six executions were
  // observed for a single block before this.
  const autoRan = useRef<string | null>(null);

  async function run() {
    if (!connectionId) {
      setResult(null);
      setError(NO_CONNECTION);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      setResult(await executeQuery(connectionId, sql));
    } catch (failure) {
      setResult(null);
      setError(reason(failure));
    } finally {
      setRunning(false);
    }
  }

  // The database's own plan. The previous version returned a canned plan with
  // invented costs and row estimates, which read as a real one.
  async function toggleExplain() {
    if (explain !== null) {
      setExplain(null);
      return;
    }
    if (!connectionId) {
      setError(NO_CONNECTION);
      return;
    }
    setExplain("Running EXPLAIN…");
    try {
      const plan = await executeQuery(
        connectionId,
        `EXPLAIN ${sql.trim().replace(/;\s*$/, "")}`
      );
      const text = plan.rows
        .map((row) => row.map((c) => String(c ?? "")).join(" "))
        .join("\n");
      setExplain(text || "The database returned no plan for this statement.");
    } catch (failure) {
      setExplain(reason(failure));
    }
  }

  // "Auto-run generated SQL" in settings — execute without waiting for a click.
  // Nothing is set synchronously here: `running` starts true when auto-run is
  // on and there is somewhere to run, and the missing-connection message is
  // derived below rather than stored.
  useEffect(() => {
    if (!autoRunSql || !connectionId) return;
    const attempt = `${connectionId}\u0000${sql}`;
    if (autoRan.current === attempt) return;
    autoRan.current = attempt;
    let cancelled = false;
    let settled = false;
    executeQuery(connectionId, sql).then(
      (next) => {
        settled = true;
        if (cancelled) return;
        setResult(next);
        setError(null);
        setRunning(false);
      },
      (failure) => {
        settled = true;
        if (cancelled) return;
        setResult(null);
        setError(reason(failure));
        setRunning(false);
      }
    );
    return () => {
      cancelled = true;
      // An attempt torn down before it answered has produced nothing, so it
      // must not count as "already run" — StrictMode's double-invoke cancels
      // the first pass, and leaving the mark set would strand the block with
      // no result at all.
      if (!settled) autoRan.current = null;
    };
  }, [autoRunSql, sql, connectionId]);

  // Auto-run with nothing attached is a failure to report, not a silent no-op.
  const shownError = error ?? (autoRunSql && !connectionId ? NO_CONNECTION : null);

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
              {result.truncated ? `first ${result.rowCount} rows` : `${result.rowCount} rows`} ·{" "}
              {result.executionTimeMs} ms
            </Badge>
          )}
          {shownError && !running && (
            <Badge variant="destructive" className="ml-auto">
              not run
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
              onClick={() => void toggleExplain()}
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

            {shownError && (
              <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {shownError}
              </p>
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
