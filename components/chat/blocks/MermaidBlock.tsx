"use client";

import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import { useDarkMode } from "@/hooks/use-dark-mode";
import {
  downloadElementAsPdf,
  downloadSvg,
  downloadSvgAsPng,
  safeFilename,
} from "@/lib/export";
import { BlockToolbar } from "./BlockToolbar";

/**
 * mermaid's grammar rejects a literal `(`/`)` inside unquoted `[...]`/`{...}`
 * node text or `|...|` edge text (it conflicts with the parens that denote a
 * round/cylinder node shape) -- e.g. `A[Text (detail)]` fails to parse, while
 * `A["Text (detail)"]` is fine. The model writes plain parenthetical asides
 * constantly ("(PPE)", "(~5m)") with no reason to know that rule, and one bad
 * label used to fail the whole diagram. Quote just the labels that need it.
 */
function sanitizeMermaidChart(chart: string): string {
  const quote = (inner: string) => `"${inner.replace(/"/g, '\\"')}"`;
  const quoteIfRisky = (delimiterOpen: string, delimiterClose: string) => (match: string, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed === "" || /^".*"$/.test(trimmed)) return match;
    // A label that is itself fully wrapped in parens, e.g. the `(cylinder)`
    // in `[(cylinder)]`, is shape syntax, not text -- leave it alone.
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) return match;
    if (!/[()]/.test(inner)) return match;
    return `${delimiterOpen}${quote(inner)}${delimiterClose}`;
  };
  return chart
    .replace(/\[([^[\]]*)\]/g, quoteIfRisky("[", "]"))
    .replace(/\{([^{}]*)\}/g, quoteIfRisky("{", "}"))
    .replace(/\|([^|]*)\|/g, quoteIfRisky("|", "|"));
}

export function MermaidBlock({
  chart,
  name = "diagram",
}: {
  chart: string;
  name?: string;
}) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isDark = useDarkMode();
  // Exports target the diagram only, so the toolbar never lands in the file.
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      // Without this, mermaid swallows a parse/render error and resolves with
      // its own oversized built-in "syntax error" diagram instead of
      // rejecting — our .catch() below never fires, so that big error graphic
      // renders as if it were real output. It also skips cleaning up the temp
      // node it appends to document.body on that path, which can then collide
      // with the next render attempt and only clear on a full page refresh.
      // suppressErrorRendering makes it clean up and actually reject instead.
      suppressErrorRendering: true,
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
      .render(`mermaid-${rawId}`, sanitizeMermaidChart(chart))
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

  const base = safeFilename(name, "diagram");
  // Scoped to the diagram wrapper, not the whole block — the toolbar's own
  // icons are SVGs too and would otherwise win the query.
  const findSvg = () =>
    (diagramRef.current?.querySelector("svg") as SVGElement | null) ?? null;

  return (
    <div className="my-3 not-prose">
      <BlockToolbar
        className="rounded-t-lg"
        exports={[
          {
            label: "SVG",
            onSelect: () => {
              const el = findSvg();
              if (el) downloadSvg(el, `${base}.svg`);
            },
          },
          {
            label: "PNG image",
            onSelect: () => {
              const el = findSvg();
              if (el) downloadSvgAsPng(el, `${base}.png`);
            },
          },
          {
            label: "PDF",
            onSelect: () =>
              diagramRef.current &&
              downloadElementAsPdf(diagramRef.current, `${base}.pdf`),
          },
        ]}
      />
      <div
        ref={diagramRef}
        className="overflow-x-auto rounded-b-lg border border-border bg-card p-4 [&_svg]:mx-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
