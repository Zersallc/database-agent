"use client";

export type CellValue = string | number | boolean | null;

function triggerDownload(url: string, filename: string, revoke: boolean) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  if (revoke) URL.revokeObjectURL(url);
}

export function downloadBlob(blob: Blob, filename: string) {
  triggerDownload(URL.createObjectURL(blob), filename, true);
}

export function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8;` }), filename);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  triggerDownload(dataUrl, filename, false);
}

function escapeCSV(value: CellValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(columns: string[], rows: CellValue[][]): string {
  return [
    columns.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ].join("\n");
}

export function downloadCSV(
  columns: string[],
  rows: CellValue[][],
  filename = "export.csv"
) {
  downloadText(toCSV(columns, rows), filename, "text/csv");
}

/**
 * Elements carrying this attribute are chrome, not content — toolbars, export
 * menus, pagination — and are left out of rasterized exports.
 */
export const EXPORT_IGNORE_ATTRIBUTE = "data-export-ignore";

const ignoreElements = (el: Element) =>
  el.hasAttribute(EXPORT_IGNORE_ATTRIBUTE) ||
  Boolean(el.closest(`[${EXPORT_IGNORE_ATTRIBUTE}]`));

/**
 * Rasterizes any element to PNG. Used for blocks with no native export.
 *
 * Imports `html2canvas`, which next.config.ts aliases to `html2canvas-pro` —
 * the original can't parse the oklch/lab colors Tailwind v4 emits.
 */
export async function downloadElementAsPng(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, {
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    scale: 2,
    logging: false,
    ignoreElements,
  });
  downloadDataUrl(canvas.toDataURL("image/png"), filename);
}

export async function downloadElementAsPdf(el: HTMLElement, filename: string) {
  const { default: generatePDF, Margin, Resolution } = await import(
    "react-to-pdf"
  );
  await generatePDF(() => el, {
    filename,
    method: "save",
    resolution: Resolution.MEDIUM,
    page: { margin: Margin.MEDIUM, format: "a4", orientation: "portrait" },
    canvas: { mimeType: "image/png", qualityRatio: 1 },
    // react-to-pdf drives html2canvas internally, so the ignore rule has to be
    // handed down through its overrides.
    overrides: { canvas: { ignoreElements } },
  });
}

/** Mermaid already renders SVG, so this is a straight serialization. */
export function downloadSvg(svg: SVGElement, filename: string) {
  const source = new XMLSerializer().serializeToString(svg);
  downloadText(source, filename, "image/svg+xml");
}

/** Rasterizes an inline SVG to PNG at 2x. */
export function downloadSvgAsPng(svg: SVGElement, filename: string) {
  const rect = svg.getBoundingClientRect();
  const source = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`;

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    downloadDataUrl(canvas.toDataURL("image/png"), filename);
  };
  image.src = url;
}

/** Strips characters that make for awkward filenames. */
export function safeFilename(name: string, fallback = "export"): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}
