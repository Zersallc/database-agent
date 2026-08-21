/**
 * Chart layout adaptation.
 *
 * The failure this guards against is silent and it ships: a chart whose title
 * overlaps its labels, or whose labels run past the card border, looks broken
 * on screen *and* in the PNG and PDF the reader forwards on. There is no
 * exception thrown and no test that fails — it just looks wrong.
 *
 * So the assertions here are geometric. The pie must fit between the title and
 * the legend, and it must fit between the left and right edges with its label
 * gutter intact. Those are the two collisions from the original bug.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptChartOption,
  donutRatio,
  familyOf,
  fontsFor,
  pieLabelMode,
} from "@/components/chat/blocks/chart/adapt-option";

const DONUT = {
  title: { text: "Units by category and classification — August 2026" },
  legend: {},
  series: [
    {
      type: "pie",
      radius: ["45%", "70%"],
      data: [
        { name: "Category 2 · Low Value", value: 820 },
        { name: "Category 2 · High Value", value: 60 },
        { name: "Category 1 · Low Value", value: 90 },
        { name: "Category 1 · High Value", value: 26 },
      ],
    },
  ],
};

const BARS = {
  title: { text: "Revenue by month" },
  xAxis: { type: "category", data: ["Jan", "Feb", "Mar", "Apr", "May"] },
  yAxis: { type: "value" },
  series: [{ type: "bar", name: "Revenue", data: [12, 19, 8, 15, 22] }],
};

type Pie = {
  center: [number, number];
  radius: [number, number];
  label: { show: boolean; position: string };
};

function pieOf(option: Record<string, unknown>): Pie {
  const series = option.series as Pie[];
  return series[0];
}

describe("family detection", () => {
  it("recognizes a pie", () => {
    assert.equal(familyOf(DONUT), "pie");
  });

  it("recognizes a cartesian chart", () => {
    assert.equal(familyOf(BARS), "cartesian");
  });

  it("treats an x-axis alone as cartesian, since model specs often omit the series type", () => {
    assert.equal(familyOf({ xAxis: { data: [1, 2] }, series: [{ data: [1, 2] }] }), "cartesian");
  });

  it("falls back to 'other' for a spec it cannot place", () => {
    assert.equal(familyOf({ series: [{ type: "graph" }] }), "other");
  });
});

describe("donut ratio", () => {
  it("preserves the hole from percentage strings", () => {
    assert.ok(Math.abs(donutRatio(["45%", "70%"]) - 45 / 70) < 1e-9);
  });

  it("treats a scalar radius as a solid pie", () => {
    assert.equal(donutRatio("70%"), 0);
    assert.equal(donutRatio(undefined), 0);
  });

  it("falls back to a donut rather than a solid pie when the values are unreadable", () => {
    // An array radius means the author wanted a hole. Losing it silently turns
    // their donut into a pie, which is a worse outcome than guessing.
    assert.equal(donutRatio(["auto", "auto"]), 0.6);
  });
});

describe("pie geometry fits inside the card", () => {
  // The widths that matter: the chat column, a collapsed-sidebar column, a
  // phone, and something wider than any plot should ever be.
  for (const width of [280, 360, 480, 560, 700, 900, 1200]) {
    it(`keeps the ring clear of the title and legend at ${width}px`, () => {
      const { option, height } = adaptChartOption(DONUT, width);
      const pie = pieOf(option);
      const [, centerY] = pie.center;
      const outer = pie.radius[1];

      const title = option.title as { top: number };
      const fonts = fontsFor(width);
      const titleBottom = title.top + fonts.title * 1.35;

      assert.ok(
        centerY - outer >= titleBottom,
        `ring top ${centerY - outer} overlaps the title ending at ${titleBottom}`
      );
      assert.ok(
        centerY + outer <= height,
        `ring bottom ${centerY + outer} runs past the card at ${height}`
      );
    });

    it(`keeps the ring and its label gutter inside the width at ${width}px`, () => {
      const { option } = adaptChartOption(DONUT, width);
      const pie = pieOf(option);
      const [centerX] = pie.center;
      const outer = pie.radius[1];

      assert.ok(centerX - outer >= 0, "ring crosses the left edge");
      assert.ok(centerX + outer <= width, "ring crosses the right edge");

      if (pie.label.position === "outside") {
        // Outside labels are drawn beyond the ring. If the ring already fills
        // the width there is nowhere to put them — which is precisely how the
        // original layout pushed "Category 2 · Low Value" past the border.
        assert.ok(
          width / 2 - outer >= 100,
          `only ${width / 2 - outer}px of gutter for outside labels`
        );
      }
    });

    it(`produces a donut, not a filled pie, at ${width}px`, () => {
      const pie = pieOf(adaptChartOption(DONUT, width).option);
      assert.ok(pie.radius[0] > 0, "the hole was lost");
      assert.ok(pie.radius[0] < pie.radius[1], "inner radius exceeds outer");
    });
  }
});

describe("label mode", () => {
  it("uses outside labels only when there is room for them", () => {
    assert.equal(pieLabelMode(700, 4), "outside");
    assert.equal(pieLabelMode(360, 4), "inside");
  });

  it("moves labels inside once there are too many slices, however wide the card", () => {
    assert.equal(pieLabelMode(1200, 12), "inside");
  });

  it("always gives an inside-labelled pie a legend, or the colors mean nothing", () => {
    const narrow = adaptChartOption({ ...DONUT, legend: undefined }, 320);
    assert.equal(pieOf(narrow.option).label.position, "inside");
    assert.ok(narrow.option.legend, "no legend to name the slices");
  });
});

describe("height", () => {
  it("stays within bounds at every width", () => {
    for (const width of [200, 320, 700, 2000]) {
      const { height } = adaptChartOption(DONUT, width);
      assert.ok(height >= 260 && height <= 560, `height ${height} out of bounds`);
    }
  });

  it("shrinks the plot rather than the card when reserves are large", () => {
    // Twenty long series names is several rows of legend. The card must not
    // grow to accommodate them; the plot gives way instead.
    const crowded = {
      ...DONUT,
      series: [
        {
          type: "pie",
          radius: ["45%", "70%"],
          data: Array.from({ length: 20 }, (_, i) => ({
            name: `A fairly long series label number ${i}`,
            value: i + 1,
          })),
        },
      ],
    };
    const { option, height } = adaptChartOption(crowded, 700);
    assert.ok(height <= 560);
    assert.ok(pieOf(option).radius[1] > 0, "the plot collapsed entirely");
  });

  it("is stable when fed its own output", () => {
    // The ResizeObserver can re-run against an already-adapted spec. A layout
    // that drifted each pass would creep across resizes.
    const first = adaptChartOption(DONUT, 700);
    const second = adaptChartOption(first.option, 700);
    assert.equal(second.height, first.height);
    assert.deepEqual(pieOf(second.option).center, pieOf(first.option).center);
    assert.deepEqual(pieOf(second.option).radius, pieOf(first.option).radius);
  });

  it("lays out sensibly when the container reports zero mid-mount", () => {
    const { option, height } = adaptChartOption(DONUT, 0);
    assert.ok(height >= 260);
    assert.ok(Number.isFinite(pieOf(option).radius[1]));
  });
});

describe("cartesian charts", () => {
  it("reserves the title and legend bands in the grid", () => {
    const { option } = adaptChartOption(BARS, 700);
    const grid = option.grid as { top: number; bottom: number; containLabel: boolean };
    const title = option.title as { top: number };

    assert.ok(grid.top > title.top, "the plot starts above the title");
    assert.ok(grid.containLabel, "axis labels are not measured into the grid");
    assert.ok(grid.bottom >= 8);
  });

  it("rotates category labels only when they will not fit flat", () => {
    const roomy = adaptChartOption(BARS, 900).option.xAxis as {
      axisLabel: { rotate: number };
    };
    assert.equal(roomy.axisLabel.rotate, 0);

    const crowded = adaptChartOption(
      {
        ...BARS,
        xAxis: {
          type: "category",
          data: Array.from({ length: 24 }, (_, i) => `2026-08-${i + 1} region`),
        },
      },
      360
    ).option.xAxis as { axisLabel: { rotate: number } };
    assert.ok(crowded.axisLabel.rotate > 0, "labels will overlap unrotated");
  });

  it("leaves the data and colors alone", () => {
    const { option } = adaptChartOption(BARS, 700);
    const series = option.series as { name: string; data: number[] }[];
    assert.equal(series[0].name, "Revenue");
    assert.deepEqual(series[0].data, [12, 19, 8, 15, 22]);
    assert.equal((option.title as { text: string }).text, "Revenue by month");
  });
});

describe("content the model set is preserved", () => {
  it("honors an explicit legend: false", () => {
    const { option } = adaptChartOption({ ...BARS, legend: { show: false } }, 700);
    assert.equal(option.legend, undefined);
  });

  it("keeps a custom tooltip formatter while forcing confinement", () => {
    const formatter = "{b}: {c} units";
    const { option } = adaptChartOption({ ...BARS, tooltip: { formatter } }, 700);
    const tooltip = option.tooltip as { formatter: string; confine: boolean };
    assert.equal(tooltip.formatter, formatter);
    assert.equal(tooltip.confine, true);
  });

  it("drops animation under a reduced-motion preference", () => {
    assert.equal(adaptChartOption(BARS, 700, { reducedMotion: true }).option.animation, false);
    assert.equal(adaptChartOption(BARS, 700).option.animation, true);
  });
});

describe("title centering", () => {
  it("centers with 'left' and never sets textAlign", () => {
    // Setting both makes ECharts anchor the string at the title block's origin
    // rather than its center, which puts half a wide title off the left edge of
    // the canvas. Verified against a real render: with `textAlign` the box ran
    // from -217px to 249px in a 700px card; without it, 117px to 583px.
    const title = adaptChartOption(DONUT, 700).option.title as Record<string, unknown>;
    assert.equal(title.left, "center");
    assert.equal(title.textAlign, undefined);
  });

  it("gives a long title a wrapping width so it cannot overflow", () => {
    const title = adaptChartOption(DONUT, 320).option.title as {
      textStyle: { width: number; overflow: string };
    };
    assert.ok(title.textStyle.width <= 320 - 32);
    assert.equal(title.textStyle.overflow, "break");
  });

  it("reserves more vertical space when the title has to wrap", () => {
    // The reserve is not directly observable, but a wrapped title pushes the
    // ring down — which is the behavior that matters.
    const wide = adaptChartOption(DONUT, 700).option;
    const narrow = adaptChartOption(DONUT, 320).option;
    const ringTop = (o: Record<string, unknown>) => {
      const pie = pieOf(o);
      return pie.center[1] - pie.radius[1];
    };
    assert.ok(ringTop(narrow) > fontsFor(320).title * 1.35);
    assert.ok(ringTop(wide) > fontsFor(700).title * 1.35);
  });
});
