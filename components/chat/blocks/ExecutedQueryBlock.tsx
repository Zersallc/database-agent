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
  defaultOpen = false,
}: {
  query: ExecutedQuery;
  /**
   * Open on the newest message, collapsed in history. A reader watching an
   * answer arrive wants the rows; a reader scrolling back wants the prose. It
   * also removes the model's reason to paste the result set into its reply —
   * data it cannot see on screen is data it will try to show you itself.
   */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const base = safeFilename(query.label ?? "query", "query");

  return (
    <div className="my-3 not-prose">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 data-[panel-open]:rounded-b-none data-[panel-open]:border-b-0">
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

          <div ref={contentRef}>
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

            {!query.error && (
              <TableBlock
                columns={query.columns}
                rows={query.rows}
                name={`${base}-results`}
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
