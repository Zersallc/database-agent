"use client";

import { useState } from "react";
import Editor from "@monaco-editor/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { cn } from "@/lib/utils";

/** Keeps Monaco's theme in sync with the app's light/dark class. */
export function useMonacoTheme(): "vs" | "vs-dark" {
  return useDarkMode() ? "vs-dark" : "vs";
}

export function editorHeight(code: string) {
  return Math.min(400, Math.max(60, code.split("\n").length * 19 + 16));
}

export function CodeBlock({
  code,
  language,
  className,
  showHeader = true,
}: {
  code: string;
  language: string;
  className?: string;
  showHeader?: boolean;
}) {
  const theme = useMonacoTheme();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        "my-3 overflow-hidden rounded-lg border border-border not-prose",
        className
      )}
    >
      {showHeader && (
        <div className="flex items-center justify-between bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
          <span>{language || "text"}</span>
          <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy code">
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      )}
      <Editor
        height={editorHeight(code)}
        language={language}
        value={code}
        theme={theme}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: "on",
          folding: true,
          wordWrap: "on",
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
