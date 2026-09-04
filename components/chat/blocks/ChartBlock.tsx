"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { useDarkMode } from "@/hooks/use-dark-mode";
import {
  downloadCSV,
  downloadDataUrl,
  downloadElementAsPdf,
  safeFilename,
  type CellValue,
} from "@/lib/export";
import { adaptChartOption } from "./chart/adapt-option";
import { BlockToolbar } from "./BlockToolbar";

// Brand ramp, so AI-generated charts match the workspace even when the spec
// doesn't name colors.
const BRAND_PALETTE = ["#008CF0", "#49ACF2", "#006EBD", "#224F70", "#004170"];

type Series = { name?: string; data?: unknown[] };

/**
 * Flattens the chart spec back into rows so a chart can be exported as data,
 * not just as a picture. Handles the common `xAxis.data` + `series[].data`
 * shape; anything more exotic falls back to a single value column.
 */
function seriesToTable(option: Record<string, unknown>): {
  columns: string[];
  rows: CellValue[][];
} {
  const xAxis = option.xAxis as { data?: unknown[] } | undefined;
  const categories = (xAxis?.data ?? []) as CellValue[];
  const series = (option.series ?? []) as Series[];

  const columns = [
    "category",
    ...series.map((s, i) => s.name ?? `series ${i + 1}`),
  ];
  const length = Math.max(
    categories.length,
    ...series.map((s) => s.data?.length ?? 0)
  );

  const rows = Array.from({ length }, (_, i) => [
    categories[i] ?? i,
    ...series.map((s) => (s.data?.[i] ?? null) as CellValue),
  ]);

  return { columns, rows };
}

export function ChartBlock({
  option,
  name = "chart",
}: {
  option: Record<string, unknown>;
  name?: string;
}) {
  /** The measured box. Its width is the input to the layout; its height is the output. */
  const hostRef = useRef<HTMLDivElement>(null);
  // Exports target the content only, so the toolbar never lands in the file.
  const contentRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [height, setHeight] = useState(320);
  const isDark = useDarkMode();

  // `Markdown.tsx` re-parses every fenced block on every render, so `option`
  // arrives as a fresh object identity each time — which during streaming means
  // once per token. Keying on the serialized spec collapses that back to one
  // effect run per distinct chart, instead of disposing and re-initializing
  // ECharts on every delta.
  const optionKey = JSON.stringify(option);
  const spec = useMemo(
    () => JSON.parse(optionKey) as Record<string, unknown>,
    [optionKey]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = echarts.init(host, isDark ? "dark" : undefined);
    chartRef.current = chart;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let lastWidth = 0;

    const apply = (width: number) => {
      // Height changes are ours — re-laying out on the resize they trigger
      // would be an infinite loop. Only a genuine width change matters.
      if (width <= 0 || width === lastWidth) return;
      lastWidth = width;

      const adapted = adaptChartOption(spec, width, { reducedMotion });
      setHeight(adapted.height);
      chart.setOption(
        {
          backgroundColor: "transparent",
          color: BRAND_PALETTE,
          ...adapted.option,
        },
        // The previous layout's geometry must not survive into the new one.
        { notMerge: true }
      );
      // Sized explicitly rather than read back from the DOM: React has not
      // committed the new height yet at this point.
      chart.resize({ width, height: adapted.height });
    };

    apply(host.clientWidth);

    // The window `resize` event this replaces missed every container-only
    // change — collapsing the sidebar, opening a panel, a phone rotating into
    // a different column width.
    const observer = new ResizeObserver((entries) => {
      apply(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [spec, isDark]);

  const base = safeFilename(name, "chart");

  return (
    <div className="my-3 not-prose">
      <BlockToolbar
        className="rounded-t-lg"
        exports={[
          {
            label: "PNG image",
            onSelect: () => {
              const chart = chartRef.current;
              if (!chart) return;
              // ECharts' own export is sharper than rasterizing the DOM.
              downloadDataUrl(
                chart.getDataURL({
                  type: "png",
                  pixelRatio: 2,
                  backgroundColor: isDark ? "#08131c" : "#ffffff",
                }),
                `${base}.png`
              );
            },
          },
          {
            label: "CSV data",
            onSelect: () => {
              const { columns, rows } = seriesToTable(spec);
              downloadCSV(columns, rows, `${base}.csv`);
            },
          },
          {
            label: "PDF",
            onSelect: () =>
              contentRef.current &&
              downloadElementAsPdf(contentRef.current, `${base}.pdf`),
          },
        ]}
      />
      <div
        ref={contentRef}
        className="rounded-b-lg border border-border bg-card p-2"
      >
        <div
          ref={hostRef}
          className="w-full transition-[height] duration-200 ease-out motion-reduce:transition-none"
          style={{ height }}
        />
      </div>
    </div>
  );
}
