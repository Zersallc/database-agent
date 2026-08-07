"use client";

/**
 * DRAFT handler — functional but minimal.
 *
 * Renders a read-only side-by-side diff with Monaco. Still to build: inline vs
 * split toggle, per-hunk accept/reject, and diffs of query results rather than
 * just text.
 */

import { DiffEditor } from "@monaco-editor/react";
import { Badge } from "@/components/ui/badge";
import { editorHeight, useMonacoTheme } from "./CodeBlock";

export type DiffPayload = {
  original: string;
  modified: string;
  language?: string;
  title?: string;
};

export function DiffBlock({ diff }: { diff: DiffPayload }) {
  const theme = useMonacoTheme();
  const height = Math.max(
    editorHeight(diff.original),
    editorHeight(diff.modified)
  );

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border not-prose">
      <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">diff</Badge>
        <span>{diff.title ?? diff.language ?? "changes"}</span>
      </div>
      <DiffEditor
        height={height}
        language={diff.language ?? "sql"}
        original={diff.original}
        modified={diff.modified}
        theme={theme}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
        }}
      />
    </div>
  );
}
