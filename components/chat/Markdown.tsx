"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TableBlock } from "./blocks/TableBlock";

const ChartBlock = dynamic(
  () => import("./blocks/ChartBlock").then((m) => m.ChartBlock),
  { ssr: false }
);
const CodeBlock = dynamic(
  () => import("./blocks/CodeBlock").then((m) => m.CodeBlock),
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

function safeParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
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
                  className="rounded bg-zinc-100 px-1 py-0.5 text-[0.85em] dark:bg-zinc-800"
                  {...rest}
                >
                  {children}
                </code>
              );
            }

            const lang = (className ?? "").replace("language-", "");

            if (lang === "mermaid") {
              return <MermaidBlock chart={raw} />;
            }

            if (lang === "chart") {
              const spec = safeParseJSON(raw);
              return spec ? (
                <ChartBlock option={spec as Record<string, unknown>} />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "table") {
              const data = safeParseJSON(raw) as {
                columns: string[];
                rows: unknown[][];
              } | null;
              return data ? (
                <TableBlock
                  columns={data.columns}
                  rows={data.rows as never}
                />
              ) : (
                <CodeBlock code={raw} language="json" />
              );
            }

            if (lang === "flow") {
              const data = safeParseJSON(raw) as {
                nodes: never[];
                edges: never[];
              } | null;
              return data ? (
                <FlowBlock nodes={data.nodes} edges={data.edges} />
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
