"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export function ChartBlock({ option }: { option: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({ backgroundColor: "transparent", ...option });

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option]);

  return (
    <div className="my-3 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div ref={ref} className="h-72 w-full" />
    </div>
  );
}
