/**
 * Excel rendering for the Monthly ESG, Waste and GHG Report — one sheet per
 * template section, so the client can pivot/filter the underlying numbers
 * rather than just read a formatted page. See esg-pdf.tsx for the PDF
 * counterpart; both render from the same aggregated EsgReportData.
 */

import ExcelJS from "exceljs";
import type { EsgReportData } from "@/lib/services/esg-report";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E7DE" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDFEAE5" } };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle" };
  });
}

function styleTotal(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
  });
}

export async function renderEsgReportExcel(data: EsgReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Medi Merchant Database Agent";
  wb.created = new Date(data.generatedAt);

  // --- Summary ---
  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 34 }, { width: 20 }];
  summary.addRow(["Monthly ESG, Waste and GHG Report"]).font = { bold: true, size: 14 };
  summary.addRow([]);
  summary.addRow(["Client", data.hospitalName]);
  summary.addRow(["Reporting period", data.periodLabel]);
  summary.addRow(["Prepared by", "Medi Merchant"]);
  summary.addRow(["Methodology", "UK Government GHG Conversion Factors for Company Reporting 2026"]);
  summary.addRow(["Generated", new Date(data.generatedAt).toLocaleString("en-ZA")]);
  summary.addRow([]);
  const scoreHeader = summary.addRow(["Indicator", "Value"]);
  styleHeader(scoreHeader);
  const scoreRows: [string, string | number][] = [
    ["Items processed", data.itemsRemoved],
    ["Total material processed (t)", Number(data.totalWeightTonnes.toFixed(3))],
    ["Reused - sold + donated (t)", Number(data.totals.reusedTonnes.toFixed(3))],
    ["Recycled (t)", Number(data.totals.recycledTonnes.toFixed(3))],
    ["Landfilled (t)", Number(data.totals.landfillTonnes.toFixed(3))],
    ["Landfill-diversion rate (%)", Number(data.totals.landfillDiversionRatePct.toFixed(1))],
    ["Reported waste-treatment emissions (tCO2e)", Number(data.totals.reportedEmissionsTonnesCo2e.toFixed(3))],
    ["Estimated avoided emissions (tCO2e)", Number(data.totals.avoidedEmissionsTonnesCo2e.toFixed(2))],
    ["Carbon data quality score (%)", Number(data.totals.carbonDataQualityScorePct.toFixed(1))],
  ];
  scoreRows.forEach((r) => summary.addRow(r));

  // --- Waste by route ---
  const route = wb.addWorksheet("Waste by Route");
  route.columns = [
    { header: "Route", key: "route", width: 22 },
    { header: "Items", key: "items", width: 10 },
    { header: "Weight (kg)", key: "kg", width: 14 },
    { header: "Share (%)", key: "share", width: 12 },
    { header: "Reported Emissions (kgCO2e)", key: "co2e", width: 26 },
  ];
  styleHeader(route.getRow(1));
  data.byRoute.forEach((r) =>
    route.addRow({
      route: r.route,
      items: r.items,
      kg: Number(r.weightKg.toFixed(1)),
      share: Number(r.sharePct.toFixed(1)),
      co2e: Number(r.reportedEmissionsKgCo2e.toFixed(2)),
    })
  );
  const routeTotal = route.addRow({
    route: "Total",
    items: data.itemsRemoved,
    kg: Number(data.byRoute.reduce((s, r) => s + r.weightKg, 0).toFixed(1)),
    share: 100,
    co2e: Number(data.byRoute.reduce((s, r) => s + r.reportedEmissionsKgCo2e, 0).toFixed(2)),
  });
  styleTotal(routeTotal);

  // --- Material recovery ---
  const material = wb.addWorksheet("Material Recovery");
  material.columns = [
    { header: "Material", key: "material", width: 30 },
    { header: "Removed (kg)", key: "removed", width: 14 },
    { header: "Reused (kg)", key: "reused", width: 14 },
    { header: "Recycled (kg)", key: "recycled", width: 14 },
    { header: "Landfilled (kg)", key: "landfilled", width: 14 },
    { header: "Other (kg)", key: "other", width: 12 },
  ];
  styleHeader(material.getRow(1));
  data.byMaterial.forEach((m) =>
    material.addRow({
      material: m.material,
      removed: Number(m.removedKg.toFixed(1)),
      reused: Number(m.reusedKg.toFixed(1)),
      recycled: Number(m.recycledKg.toFixed(1)),
      landfilled: Number(m.landfilledKg.toFixed(1)),
      other: Number(m.otherKg.toFixed(1)),
    })
  );

  // --- Reported GHG emissions (waste treatment) ---
  const emissions = wb.addWorksheet("Reported GHG Emissions");
  emissions.columns = [
    { header: "Material", key: "material", width: 30 },
    { header: "Route", key: "route", width: 14 },
    { header: "Mass (t)", key: "mass", width: 12 },
    { header: "2026 Factor (kgCO2e/t)", key: "factor", width: 20 },
    { header: "Emissions (kgCO2e)", key: "emissions", width: 18 },
  ];
  styleHeader(emissions.getRow(1));
  data.wasteTreatment.forEach((w) =>
    emissions.addRow({
      material: w.materialCategory,
      route: w.route,
      mass: Number(w.massTonnes.toFixed(4)),
      factor: Number(w.factorKgCo2ePerTonne.toFixed(3)),
      emissions: Number(w.emissionsKgCo2e.toFixed(2)),
    })
  );
  const emissionsTotal = emissions.addRow({
    material: "Total waste treatment",
    emissions: Number(data.wasteTreatment.reduce((s, w) => s + w.emissionsKgCo2e, 0).toFixed(2)),
  });
  styleTotal(emissionsTotal);

  // --- Avoided emissions (circular economy) ---
  const avoided = wb.addWorksheet("Avoided Emissions");
  avoided.getCell("A1").value = "Indicative benefit — not verified carbon savings; not deducted from reported Scope 1/2/3 emissions.";
  avoided.getCell("A1").font = { italic: true, color: { argb: "FFA8721F" } };
  avoided.mergeCells("A1:D1");
  avoided.columns = [
    { header: "Activity", key: "activity", width: 26 },
    { header: "Items", key: "items", width: 10 },
    { header: "Mass (t)", key: "mass", width: 12 },
    { header: "Avoided Emissions (tCO2e)", key: "avoided", width: 24 },
  ];
  styleHeader(avoided.getRow(2));
  data.avoidedEmissions.forEach((a) =>
    avoided.addRow({
      activity: a.activity,
      items: a.items,
      mass: Number(a.massTonnes.toFixed(3)),
      avoided: Number(a.avoidedCo2eTonnes.toFixed(3)),
    })
  );
  const avoidedTotal = avoided.addRow({
    activity: "Total estimated benefit",
    avoided: Number(data.avoidedEmissions.reduce((s, a) => s + a.avoidedCo2eTonnes, 0).toFixed(3)),
  });
  styleTotal(avoidedTotal);

  // --- Data quality ---
  const quality = wb.addWorksheet("Data Quality");
  quality.columns = [
    { header: "Data Source", key: "source", width: 30 },
    { header: "Share of Reported Weight (%)", key: "share", width: 26 },
    { header: "Quality Rating", key: "rating", width: 16 },
  ];
  styleHeader(quality.getRow(1));
  const sourceLabel: Record<string, string> = {
    ewaste_sheet: "Recorded weight (Ewaste reference)",
    ai_estimated: "AI-estimated weight",
    unmatched: "Unmatched item",
  };
  const ratingLabel: Record<string, string> = { ewaste_sheet: "High", ai_estimated: "Low", unmatched: "Unacceptable" };
  data.dataQuality.forEach((d) =>
    quality.addRow({
      source: sourceLabel[d.source],
      share: Number(d.shareOfWeightPct.toFixed(1)),
      rating: ratingLabel[d.source],
    })
  );

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
