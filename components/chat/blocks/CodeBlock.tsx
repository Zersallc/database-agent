"use client";

import { useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDarkMode } from "@/hooks/use-dark-mode";
import {
  downloadElementAsPdf,
  downloadText,
  safeFilename,
} from "@/lib/export";
import { cn } from "@/lib/utils";
import { BlockToolbar } from "./BlockToolbar";

/** Keeps Monaco's theme in sync with the app's light/dark class. */
export function useMonacoTheme(): "vs" | "vs-dark" {
  return useDarkMode() ? "vs-dark" : "vs";
}

export function editorHeight(code: string) {
  return Math.min(400, Math.max(60, code.split("\n").length * 19 + 16));
}

/** Best-guess file extension for a Monaco language id. */
const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  yaml: "yml",
  markdown: "md",
  shell: "sh",
};

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
  // Exports target the editor only, so the toolbar never lands in the file.
  const contentRef = useRef<HTMLDivElement>(null);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const extension = EXTENSIONS[language] ?? (language || "txt");
  const base = safeFilename(language || "snippet", "snippet");

  return (
    <div
      className={cn(
        "my-3 overflow-hidden rounded-lg border border-border not-prose",
        className
      )}
    >
      {showHeader && (
        <BlockToolbar
          className="rounded-none border-x-0 border-t-0"
          exports={[
            {
              label: `.${extension} file`,
              onSelect: () =>
                downloadText(code, `${base}.${extension}`, "text/plain"),
            },
            {
              label: "PDF",
              onSelect: () =>
                contentRef.current &&
                downloadElementAsPdf(contentRef.current, `${base}.pdf`),
            },
          ]}
        >
          <span className="text-xs text-muted-foreground">
            {language || "text"}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy code">
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </BlockToolbar>
      )}
      <div ref={contentRef}>
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
    </div>
  );
}
