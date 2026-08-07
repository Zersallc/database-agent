"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TableBlock } from "./blocks/TableBlock";
import type { AgentStep } from "./blocks/AgentStatusBlock";
import type { DiffPayload } from "./blocks/DiffBlock";
import type { FilePayload } from "./blocks/FileBlock";

const ChartBlock = dynamic(
  () => import("./blocks/ChartBlock").then((m) => m.ChartBlock),
  { ssr: false }
);
const CodeBlock = dynamic(
  () => import("./blocks/CodeBlock").then((m) => m.CodeBlock),
  { ssr: false }
);
const SQLBlock = dynamic(
  () => import("./blocks/SQLBlock").then((m) => m.SQLBlock),
  { ssr: false }
);
const MermaidBlock = dynamic(
  () => import("./blocks/MermaidBlock").then((m) => m.MermaidBlock),
  { ssr: false }
);
const FlowBlock = dynamic(
  () => import("./blocks/FlowBlock").then((m) => m.FlowBlock),
  { ssr: false }
);
const AgentStatusBlock = dynamic(
  () => import("./blocks/AgentStatusBlock").then((m) => m.AgentStatusBlock),
  { ssr: false }
);
const DiffBlock = dynamic(
  () => import("./blocks/DiffBlock").then((m) => m.DiffBlock),
  { ssr: false }
);
const FileBlock = dynamic(
  () => import("./blocks/FileBlock").then((m) => m.FileBlock),
  { ssr: false }
);

function safeParseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert prose-p:my-2 prose-headings:my-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code(props) {
            const { className, children, ...rest } = props;
            const isBlock = /language-/.test(className ?? "");
            const raw = String(children).replace(/\n$/, "");

            if (!isBlock) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 text-[0.85em]"
                  {...rest}
                >
                  {children}
                </code>
              );
            }

            const lang = (className ?? "").replace("language-", "");

            if (lang === "sql") {
              return <SQLBlock sql={raw} />;
            }

            if (lang === "mermaid") {
              return <MermaidBlock chart={raw} />;
            }

            if (lang === "chart") {
              const spec = safeParseJSON<Record<string, unknown>>(raw);
              return spec ? (
                <ChartBlock option={spec} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "table") {
              const data = safeParseJSON<{
                columns: string[];
                rows: never[][];
              }>(raw);
              return data ? (
                <TableBlock columns={data.columns} rows={data.rows} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "flow") {
              const data = safeParseJSON<{ nodes: never[]; edges: never[] }>(raw);
              return data ? (
                <FlowBlock nodes={data.nodes} edges={data.edges} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "status") {
              const data = safeParseJSON<{ title?: string; steps: AgentStep[] }>(
                raw
              );
              return data ? (
                <AgentStatusBlock title={data.title} steps={data.steps} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "diff") {
              const data = safeParseJSON<DiffPayload>(raw);
              return data ? (
                <DiffBlock diff={data} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "file") {
              const data = safeParseJSON<FilePayload>(raw);
              return data ? (
                <FileBlock file={data} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            return <CodeBlock code={raw} language={lang} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
