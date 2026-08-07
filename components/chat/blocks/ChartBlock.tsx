"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useDarkMode } from "@/hooks/use-dark-mode";

// Brand ramp, so AI-generated charts match the workspace even when the spec
// doesn't name colors.
const BRAND_PALETTE = ["#008CF0", "#49ACF2", "#006EBD", "#224F70", "#004170"];

export function ChartBlock({ option }: { option: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  const isDark = useDarkMode();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, isDark ? "dark" : undefined);
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
    };
  }, [option, isDark]);

  return (
    <div className="my-3 rounded-lg border border-border bg-card p-2 not-prose">
      <div ref={ref} className="h-72 w-full" />
    </div>
  );
}
