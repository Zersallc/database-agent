/**
 * Chart layout adaptation.
 *
 * The agent writes ECharts specs blind. It has no idea how wide the chat column
 * is, so it leaves `title`, `legend`, and pie geometry at their defaults — and
 * at those defaults the title lands under the label lines, outside labels run
 * past the card border, and the legend sits on top of the plot. Whatever the
 * screen shows is what the PNG and PDF contain, so a broken layout ships to
 * whoever the reader forwards it to.
 *
 * The split this file draws: **content belongs to the model, geometry belongs
 * to us.** Title text, series data, colors, names and value formatters pass
 * through untouched. Anything positional — `title.top`, `legend.bottom`,
 * `grid`, `series.center`, `series.radius`, label visibility, font sizes — is
 * computed from the measured container width and overwritten.
 *
 * Height is an output, not an input. A chart is as tall as its content needs at
 * the width it was given, and when that would exceed `MAX_HEIGHT` the plot band
 * absorbs the shortfall — the ring and its type shrink rather than the card
 * growing without bound.
 *
 * Everything here is pure so it can be tested without a DOM. `ChartBlock` owns
 * the measuring and the ResizeObserver.
 */

export type ChartFamily = "pie" | "cartesian" | "other";

export type AdaptedChart = {
  option: Record<string, unknown>;
  /** Pixel height the chart host should take at this width. */
  height: number;
};

/** Never render shorter than this — below it nothing is legible. */
const MIN_HEIGHT = 260;
/**
 * Never render taller than this. A chart that fills the viewport pushes the
 * answer's prose off screen, and the reader loses the thread of what they asked.
 */
const MAX_HEIGHT = 560;
/** Floor for the plot band once the title and legend have taken their cut. */
const MIN_PLOT_HEIGHT = 140;

/**
 * Below this width a ring of outside labels cannot be drawn without either
 * truncating every label to uselessness or crossing the leader lines. Narrower
 * than this, slice names move to the legend and the slices carry percentages.
 */
const OUTSIDE_LABEL_MIN_WIDTH = 560;
/** Past this many slices, outside labels collide no matter how wide the card is. */
const OUTSIDE_LABEL_MAX_SLICES = 6;

/** Rough advance width of a character as a fraction of font size. */
const CHAR_WIDTH_RATIO = 0.58;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ECharts accepts a bare object or an array almost everywhere. Normalize to one. */
function firstOf(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}

function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

// ---------------------------------------------------------------------------
// Reading the incoming spec
// ---------------------------------------------------------------------------

type Series = Record<string, unknown>;

function seriesOf(option: Record<string, unknown>): Series[] {
  const raw = option.series;
  if (Array.isArray(raw)) return raw.filter(isRecord);
  return isRecord(raw) ? [raw] : [];
}

export function familyOf(option: Record<string, unknown>): ChartFamily {
  const series = seriesOf(option);
  if (series.some((s) => s.type === "pie")) return "pie";
  if (series.some((s) => s.type === "bar" || s.type === "line" || s.type === "scatter")) {
    return "cartesian";
  }
  // A spec with an x-axis is cartesian even when the series type is implicit,
  // which is common in model output.
  return option.xAxis ? "cartesian" : "other";
}

/**
 * The labels a legend would have to render.
 *
 * A pie's legend names its slices and a cartesian chart's names its series —
 * different places in the spec, same question being asked.
 */
function legendLabels(option: Record<string, unknown>, family: ChartFamily): string[] {
  const series = seriesOf(option);

  if (family === "pie") {
    const data = series[0]?.data;
    if (!Array.isArray(data)) return [];
    return data.map((entry, index) =>
      isRecord(entry) && typeof entry.name === "string" ? entry.name : `Slice ${index + 1}`
    );
  }

  return series
    .map((s) => (typeof s.name === "string" ? s.name : ""))
    .filter((name) => name.length > 0);
}

/**
 * The inner/outer ratio of an incoming radius, so a donut stays a donut after
 * we recompute its size. Only the ratio survives — the absolute values were
 * written without knowing the container.
 */
export function donutRatio(radius: unknown): number {
  if (!Array.isArray(radius) || radius.length < 2) return 0;
  const inner = toNumber(radius[0]);
  const outer = toNumber(radius[1]);
  if (inner === null || outer === null || outer === 0) return 0.6;
  return clamp(inner / outer, 0, 0.88);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bands: the title strip, the legend strip, and the plot between them
// ---------------------------------------------------------------------------

export type Fonts = { title: number; subtitle: number; legend: number; label: number };

/**
 * Type scales with the card. A 16px title in a 320px column is a wall of text;
 * the same title at 13px reads fine, and the same chart in a wide column can
 * afford 18px.
 */
export function fontsFor(width: number): Fonts {
  return {
    title: Math.round(clamp(width / 34, 13, 18)),
    subtitle: Math.round(clamp(width / 52, 11, 13)),
    legend: Math.round(clamp(width / 60, 11, 13)),
    label: Math.round(clamp(width / 62, 10, 13)),
  };
}

type Band<T> = { reserve: number; spec: T | null };

function titleBand(option: Record<string, unknown>, width: number, fonts: Fonts): Band<Record<string, unknown>> {
  const incoming = firstOf(option.title);
  const text = typeof incoming?.text === "string" ? incoming.text.trim() : "";
  if (!incoming || !text) return { reserve: 0, spec: null };

  const subtext = typeof incoming.subtext === "string" ? incoming.subtext.trim() : "";
  // The title wraps rather than overflowing, so a long one costs vertical space
  // instead of running off the edge.
  const available = Math.max(120, width - 32);
  const lines = Math.max(1, Math.ceil(textWidth(text, fonts.title) / available));
  const subLines = subtext ? Math.max(1, Math.ceil(textWidth(subtext, fonts.subtitle) / available)) : 0;

  const reserve =
    lines * Math.round(fonts.title * 1.35) +
    subLines * Math.round(fonts.subtitle * 1.4) +
    (subLines ? 6 : 0) +
    20;

  return {
    reserve,
    spec: {
      ...incoming,
      top: 8,
      // `left` alone. Setting `title.textAlign` as well double-applies the
      // centering: ECharts anchors the string at the block origin instead of
      // the block center, which parks half a wide title off the left edge.
      left: "center",
      textStyle: {
        ...(isRecord(incoming.textStyle) ? incoming.textStyle : {}),
        fontSize: fonts.title,
        fontWeight: 600,
        // Wrapping is what keeps a long title inside the card. Without an
        // explicit width ECharts lets it run past both edges.
        width: available,
        overflow: "break",
        lineHeight: Math.round(fonts.title * 1.35),
      },
      ...(subtext
        ? {
            subtextStyle: {
              ...(isRecord(incoming.subtextStyle) ? incoming.subtextStyle : {}),
              fontSize: fonts.subtitle,
              width: available,
              overflow: "break",
            },
          }
        : {}),
    },
  };
}

/**
 * The legend strip, sized to the rows it will actually occupy.
 *
 * Estimating the row count is the whole point: ECharts wraps a bottom legend on
 * its own, and if we do not reserve the space it wraps into the plot. Past
 * `MAX_LEGEND_ROWS` it becomes scrollable instead, because four rows of legend
 * under a 200px plot is a legend with a chart attached.
 */
const MAX_LEGEND_ROWS = 3;

function legendBand(
  option: Record<string, unknown>,
  width: number,
  fonts: Fonts,
  labels: string[],
  required: boolean
): Band<Record<string, unknown>> {
  const incoming = firstOf(option.legend);

  // An explicit `show: false` is a content decision and is honored.
  if (incoming?.show === false) return { reserve: 0, spec: null };
  if (!incoming && !required) return { reserve: 0, spec: null };
  if (labels.length === 0) return { reserve: 0, spec: null };

  const itemWidth = 14;
  const itemGap = 18;
  const available = Math.max(120, width - 24);
  const totalWidth = labels.reduce(
    (sum, label) => sum + itemWidth + 6 + textWidth(label, fonts.legend) + itemGap,
    0
  );

  const wantedRows = Math.max(1, Math.ceil(totalWidth / available));
  const scroll = wantedRows > MAX_LEGEND_ROWS;
  const rows = scroll ? 1 : wantedRows;
  const rowHeight = Math.round(fonts.legend * 1.6);

  return {
    reserve: rows * rowHeight + 18,
    spec: {
      ...(incoming ?? {}),
      show: true,
      type: scroll ? "scroll" : "plain",
      bottom: 6,
      left: "center",
      orient: "horizontal",
      width: available,
      itemWidth,
      itemHeight: 10,
      itemGap,
      icon: "roundRect",
      textStyle: {
        ...(isRecord(incoming?.textStyle) ? incoming.textStyle : {}),
        fontSize: fonts.legend,
        // A legend entry longer than a third of the card is a label, not a
        // legend — truncate it and let the tooltip carry the full name.
        width: Math.round(available / 3),
        overflow: "truncate",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry per family
// ---------------------------------------------------------------------------

/** How tall the plot itself wants to be, before reserves and clamping. */
function wantedPlotHeight(family: ChartFamily, width: number): number {
  if (family === "pie") return clamp(width * 0.55, 220, 400);
  return clamp(width * 0.45, 200, 340);
}

type PieLabelMode = "outside" | "inside";

export function pieLabelMode(width: number, sliceCount: number): PieLabelMode {
  return width >= OUTSIDE_LABEL_MIN_WIDTH && sliceCount <= OUTSIDE_LABEL_MAX_SLICES
    ? "outside"
    : "inside";
}

function layoutPie(
  series: Series[],
  width: number,
  plotTop: number,
  plotHeight: number,
  fonts: Fonts,
  sliceCount: number
): Series[] {
  const mode = pieLabelMode(width, sliceCount);

  // The gutter is the horizontal band on each side reserved for labels and
  // their leader lines. It comes out of the radius, which is why a labelled pie
  // is smaller than an unlabelled one at the same width — as it should be.
  const gutter = mode === "outside" ? clamp(width * 0.26, 120, 200) : 12;

  const outer = Math.floor(
    Math.min(plotHeight / 2, Math.max(40, width / 2 - gutter)) * 0.92
  );
  const centerY = Math.round(plotTop + plotHeight / 2);

  return series.map((s) => {
    if (s.type !== "pie") return s;
    const inner = Math.floor(outer * donutRatio(s.radius));

    return {
      ...s,
      center: [Math.round(width / 2), centerY],
      radius: [inner, outer],
      // Keeps a 0.3% slice pickable instead of collapsing it to a hairline.
      minAngle: 2,
      avoidLabelOverlap: true,
      label:
        mode === "outside"
          ? {
              show: true,
              position: "outside",
              // `alignTo: 'edge'` parks every label against the card edge and
              // lets ECharts route the leader lines, which is what stops them
              // from crossing each other on uneven slice sizes.
              alignTo: "edge",
              edgeDistance: 8,
              width: Math.round(gutter - 24),
              overflow: "truncate",
              ellipsis: "…",
              fontSize: fonts.label,
              lineHeight: Math.round(fonts.label * 1.3),
              formatter: "{b}\n{d}%",
            }
          : {
              show: true,
              position: "inside",
              fontSize: fonts.label,
              fontWeight: 600,
              color: "#fff",
              // A percentage needs room to be readable. Below this the slice is
              // named by the legend and read from the tooltip.
              formatter: (params: { percent?: number }) =>
                (params.percent ?? 0) >= 8 ? `${Math.round(params.percent ?? 0)}%` : "",
            },
      labelLine:
        mode === "outside"
          ? {
              show: true,
              length: 10,
              length2: Math.round(gutter * 0.35),
              maxSurfaceAngle: 80,
            }
          : { show: false },
    };
  });
}

/**
 * Axis label rotation.
 *
 * Twelve month names across a 320px card overlap into an unreadable smear.
 * Rotating costs vertical space, which `containLabel` then takes out of the
 * plot — so we only pay it when the labels genuinely do not fit flat.
 */
function axisRotation(categories: unknown[], plotWidth: number, fontSize: number): number {
  if (categories.length === 0) return 0;
  const longest = categories.reduce<number>(
    (max, entry) => Math.max(max, String(entry ?? "").length),
    0
  );
  const needed = categories.length * (longest * fontSize * CHAR_WIDTH_RATIO + 12);
  return needed > plotWidth ? 35 : 0;
}

function layoutCartesianAxis(
  axis: unknown,
  width: number,
  fonts: Fonts
): unknown {
  const spec = firstOf(axis);
  if (!spec) return axis;

  const categories = Array.isArray(spec.data) ? spec.data : [];
  const rotate = axisRotation(categories, Math.max(120, width - 60), fonts.label);

  const next = {
    ...spec,
    axisLabel: {
      ...(isRecord(spec.axisLabel) ? spec.axisLabel : {}),
      fontSize: fonts.label,
      rotate,
      // Belt and braces: even after rotating, drop any label that would still
      // collide rather than drawing them over each other.
      hideOverlap: true,
    },
  };

  return Array.isArray(axis) ? [next, ...axis.slice(1)] : next;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Rewrites a model-written spec to fit `width`, and reports the height the
 * container should take.
 *
 * Call this on every container resize. It is cheap, pure, and idempotent —
 * feeding its own output back in produces the same layout.
 */
export function adaptChartOption(
  option: Record<string, unknown>,
  width: number,
  opts: { reducedMotion?: boolean } = {}
): AdaptedChart {
  // A container mid-mount reports 0. Lay out for something plausible rather
  // than dividing by it; the ResizeObserver will correct us a frame later.
  const w = Math.max(240, Math.round(width) || 320);

  const fonts = fontsFor(w);
  const family = familyOf(option);
  const series = seriesOf(option);
  const labels = legendLabels(option, family);
  const sliceCount = family === "pie" ? labels.length : 0;

  // A pie whose slice names moved off the ring *must* have a legend, or the
  // colors mean nothing. That is the one case where we add chrome the model
  // did not ask for.
  const legendRequired = family === "pie" && pieLabelMode(w, sliceCount) === "inside";

  const title = titleBand(option, w, fonts);
  const legend = legendBand(option, w, fonts, labels, legendRequired);

  const reserves = title.reserve + legend.reserve;
  const height = Math.round(
    clamp(reserves + wantedPlotHeight(family, w), MIN_HEIGHT, MAX_HEIGHT)
  );
  // When the clamp bites, the plot band is what gives — the chart shrinks
  // inside a bounded card instead of the card growing to fit the chart.
  const plotHeight = Math.max(MIN_PLOT_HEIGHT, height - reserves);
  const plotTop = title.reserve;

  const adapted: Record<string, unknown> = {
    ...option,
    animation: opts.reducedMotion !== true,
    tooltip: {
      trigger: family === "pie" ? "item" : "axis",
      ...(isRecord(option.tooltip) ? option.tooltip : {}),
      // Without this a tooltip near the edge escapes the chat column and is
      // clipped by the scroll container.
      confine: true,
    },
  };

  if (title.spec) adapted.title = title.spec;
  else delete adapted.title;

  if (legend.spec) adapted.legend = legend.spec;
  else delete adapted.legend;

  if (family === "pie") {
    adapted.series = layoutPie(series, w, plotTop, plotHeight, fonts, sliceCount);
  } else if (family === "cartesian") {
    adapted.grid = {
      ...(isRecord(option.grid) ? option.grid : {}),
      top: plotTop + 10,
      bottom: legend.reserve + 8,
      left: 8,
      right: 16,
      // Measures the grid *including* axis labels, so long tick labels eat the
      // plot instead of overflowing the card.
      containLabel: true,
    };
    if (option.xAxis) adapted.xAxis = layoutCartesianAxis(option.xAxis, w, fonts);
    if (option.yAxis) adapted.yAxis = layoutCartesianAxis(option.yAxis, w, fonts);
  }

  return { option: adapted, height };
}
