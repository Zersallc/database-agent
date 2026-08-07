"use client";

import Editor from "@monaco-editor/react";

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const lineCount = code.split("\n").length;
  const height = Math.min(400, Math.max(60, lineCount * 19 + 16));

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        <span>{language || "text"}</span>
      </div>
      <Editor
        height={height}
        language={language}
        value={code}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: "on",
          folding: false,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
