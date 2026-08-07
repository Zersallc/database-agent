"use client";

/**
 * DRAFT handler — functional but minimal.
 *
 * Renders a read-only side-by-side diff with Monaco. Still to build: inline vs
 * split toggle, per-hunk accept/reject, and diffs of query results rather than
 * just text.
 *
 * This drives Monaco directly instead of using @monaco-editor/react's
 * <DiffEditor>. That wrapper disposes the two text models *before* the diff
 * editor that still holds them, which makes Monaco throw "TextModel got
 * disposed before DiffEditorWidget model got reset"; worse, the throw aborts
 * its own cleanup, and once that is fixed the wrapper refuses to rebuild the
 * editor after React's dev-mode remount, leaving an empty box. Owning the
 * lifecycle here keeps the teardown order correct and rebuilds on every mount.
 */

import { useEffect, useRef } from "react";
import { useMonaco } from "@monaco-editor/react";
import { Badge } from "@/components/ui/badge";
import { editorHeight, useMonacoTheme } from "./CodeBlock";

export type DiffPayload = {
  original: string;
  modified: string;
  language?: string;
  title?: string;
};

export function DiffBlock({ diff }: { diff: DiffPayload }) {
  const monaco = useMonaco();
  const theme = useMonacoTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  const language = diff.language ?? "sql";
  const height = Math.max(
    editorHeight(diff.original),
    editorHeight(diff.modified)
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!monaco || !container) return;

    const original = monaco.editor.createModel(diff.original, language);
    const modified = monaco.editor.createModel(diff.modified, language);
    const diffEditor = monaco.editor.createDiffEditor(container, {
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      theme,
    });
    diffEditor.setModel({ original, modified });

    return () => {
      // Editor first, then the models it was holding.
      diffEditor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [monaco, diff.original, diff.modified, language, theme]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border not-prose">
      <div className="flex items-center gap-2 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">diff</Badge>
        <span>{diff.title ?? diff.language ?? "changes"}</span>
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
