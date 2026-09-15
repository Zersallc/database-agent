"use client";

import { useRef, useState } from "react";
import { ChevronRightIcon, CopyIcon } from "lucide-react";
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
  EXPORT_IGNORE_ATTRIBUTE,
  safeFilename,
} from "@/lib/export";
import { BlockToolbar } from "./BlockToolbar";
import { CodeBlock } from "./CodeBlock";
import { TableBlock } from "./TableBlock";
import type { ExecutedQuery } from "./sql/executed";

/**
 * A query the agent ran, rendered from the query record rather than from
 * anything the model wrote afterwards.
 *
 * There is no Execute button: this already executed, and the rows shown are
 * the rows it returned. That is the whole point of the component — what is on
 * screen is the statement the database received, not a retyping of it.
 */
export function ExecutedQueryBlock({
  query,
  showResults = false,
}: {
  query: ExecutedQuery;
  /**
   * Whether the result table stands outside the collapsible, on screen without
   * a click.
   *
   * Set for the query the answer rests on — the last one of the run. Collapsing
   * the SQL was right; collapsing the rows with it was not, and it left the
   * reader a summary of data they could not see, while the prompt went on
   * telling the model the interface was already showing them every row.
   * Earlier queries in a run are usually schema and value lookups, so they stay
   * folded away rather than putting four tables in one answer.
   */
  showResults?: boolean;
}) {
  // Collapsed by default, on every message including the newest — the SQL is
  // how the answer was produced, not the answer itself. The reader who wants
  // to check the work can expand it.
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const base = safeFilename(query.label ?? "query", "query");

  // One element, rendered in one of two places — beneath the trigger when the
  // rows are the answer, inside the SQL fold when they are working-out.
  const results = query.error ? null : (
    <TableBlock columns={query.columns} rows={query.rows} name={`${base}-results`} />
  );

  return (
    // The export ref sits out here so a PDF still captures the SQL *and* the
    // table, wherever the table is currently rendered.
    <div className="my-3 not-prose" ref={contentRef}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          // A click target, not content — the export ref now encloses it.
          {...{ [EXPORT_IGNORE_ATTRIBUTE]: "" }}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 data-[panel-open]:rounded-b-none data-[panel-open]:border-b-0"
        >
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-150 data-[panel-open]:rotate-90" />
          <Badge variant="outline">SQL</Badge>
          <span>{open ? "Hide query" : "Show query"}</span>
          {query.error ? (
            <Badge variant="destructive" className="ml-auto">
              failed
            </Badge>
          ) : (
            <Badge variant="secondary" className="ml-auto">
              {query.truncated ? `first ${query.rowCount} rows` : `${query.rowCount} rows`} ·{" "}
              {query.executionTimeMs} ms
            </Badge>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <BlockToolbar
            exports={[
              {
                label: ".sql file",
                onSelect: () => downloadText(query.sql, `${base}.sql`, "text/plain"),
              },
              ...(query.error
                ? []
                : [
                    {
                      label: "Results CSV",
                      onSelect: () =>
                        downloadCSV(query.columns, query.rows, `${base}-results.csv`),
                    },
                  ]),
              {
                label: "PDF",
                onSelect: () =>
                  contentRef.current && downloadElementAsPdf(contentRef.current, `${base}.pdf`),
              },
            ]}
          >
            <Button
              size="xs"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(query.sql)}
            >
              <CopyIcon />
              Copy
            </Button>
          </BlockToolbar>

          <CodeBlock
            code={query.sql}
            language="sql"
            showHeader={false}
            className="my-0 rounded-t-none"
          />

          {query.error && (
            <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {query.error}
            </p>
          )}

          {!showResults && results}
        </CollapsibleContent>
      </Collapsible>

      {showResults && results}
    </div>
  );
}
