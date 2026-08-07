"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useDarkMode } from "@/hooks/use-dark-mode";
import {
  downloadCSV,
  downloadDataUrl,
  downloadElementAsPdf,
  safeFilename,
  type CellValue,
} from "@/lib/export";
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
  const ref = useRef<HTMLDivElement>(null);
  // Exports target the content only, so the toolbar never lands in the file.
  const contentRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isDark = useDarkMode();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, isDark ? "dark" : undefined);
    chartRef.current = chart;
    chart.setOption({
      backgroundColor: "transparent",
      color: BRAND_PALETTE,
      ...option,
    });

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [option, isDark]);

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
              const { columns, rows } = seriesToTable(option);
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
        <div ref={ref} className="h-72 w-full" />
      </div>
    </div>
  );
}
