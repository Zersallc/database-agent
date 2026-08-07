"use client";

import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "neutral" });

export function MermaidBlock({ chart }: { chart: string }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mermaid
      .render(`mermaid-${rawId}`, chart)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, rawId]);

  if (error) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {chart}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="my-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
