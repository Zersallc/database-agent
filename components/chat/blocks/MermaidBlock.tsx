"use client";

import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";
import { useDarkMode } from "@/hooks/use-dark-mode";

export function MermaidBlock({ chart }: { chart: string }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isDark = useDarkMode();

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        primaryColor: isDark ? "#12293c" : "#e3f1fd",
        primaryTextColor: isDark ? "#e6eef5" : "#0b1620",
        primaryBorderColor: "#008CF0",
        lineColor: "#49ACF2",
        secondaryColor: isDark ? "#16293a" : "#eff6fc",
        tertiaryColor: isDark ? "#0d1c28" : "#ffffff",
        fontSize: "14px",
      },
    });

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
  }, [chart, rawId, isDark]);

  if (error) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground not-prose">
        {chart}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground not-prose">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="my-3 overflow-x-auto rounded-lg border border-border bg-card p-4 not-prose [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
