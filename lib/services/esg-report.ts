/**
 * ESG/GHG report aggregation.
 *
 * Report is the base — it already resolves Hospital Name and dates through
 * its own VLOOKUP-equivalent pipeline, so re-deriving them from Inventory +
 * Register would just be redoing work AppSheet already did. The one gap
 * Report has is a reliable item join key (its "Description" column is free
 * text); Inventory's "Item" column is the same ID item_sustainability is
 * keyed by, so it's used as a bridge, not a data source in its own right.
 *
 * Quantity comes from Inventory."Quantity", not Report's per-route quantity
 * columns — those columns (Donation/Scrap/Recycle/Sold Quantity) turned out
 * to have inconsistent, partial coverage in production data, including for
 * rows whose Type they supposedly match, whereas Inventory."Quantity" is
 * populated on effectively every row regardless of Type. Likewise dates:
 * Inventory."DateTime" is actually an edit timestamp (verified: identical to
 * "Last Edited DateTime" and different from Report."Date uplifted" on every
 * sampled row) — Report."Date uplifted" is used instead, since it is
 * populated on 100% of rows regardless of Type.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type EsgReportScope =
  | { kind: "hospital"; hospitalName: string }
  | { kind: "group"; hospitalGroup: string };

export type EsgReportParams = {
  scope: EsgReportScope;
  year: number;
  /** 1-12. Omit for the full calendar year. */
  month?: number;
};

type BaseRow = {
  type: string;
  qty: number;
  weight_kg: number | null;
  volume_m3: number | null;
  material_category: string | null;
  co2e_kg: number | null;
  weight_source: string | null;
};

export type RouteRow = {
  route: string;
  items: number;
  weightKg: number;
  sharePct: number;
  reportedEmissionsKgCo2e: number;
};

export type MaterialRow = {
  material: string;
  removedKg: number;
  reusedKg: number;
  recycledKg: number;
  landfilledKg: number;
  otherKg: number;
};

export type WasteTreatmentRow = {
  materialCategory: string;
  route: "Recycled" | "Landfill";
  massTonnes: number;
  factorKgCo2ePerTonne: number;
  emissionsKgCo2e: number;
};

export type AvoidedEmissionRow = {
  activity: string;
  items: number;
  massTonnes: number;
  avoidedCo2eTonnes: number;
};

export type DataQualityRow = {
  source: "ewaste_sheet" | "ai_estimated" | "unmatched";
  shareOfWeightPct: number;
};

export type EsgReportData = {
  scopeLabel: string;
  scope: EsgReportScope;
  /** Hospitals with at least one covered transaction, out of the total in scope. Only meaningful for group scope. */
  hospitalsCovered: { withActivity: number; totalInGroup: number } | null;
  year: number;
  month: number | null;
  periodLabel: string;
  generatedAt: string;
  itemsRemoved: number;
  totalWeightTonnes: number;
  byRoute: RouteRow[];
  byMaterial: MaterialRow[];
  wasteTreatment: WasteTreatmentRow[];
  avoidedEmissions: AvoidedEmissionRow[];
  dataQuality: DataQualityRow[];
  totals: {
    reusedTonnes: number;
    recycledTonnes: number;
    landfillTonnes: number;
    landfillDiversionRatePct: number;
    reportedEmissionsTonnesCo2e: number;
    avoidedEmissionsTonnesCo2e: number;
    carbonDataQualityScorePct: number;
  };
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * UK DESNZ 2026 "Waste disposal" factors (kg CO2e per kg, converted from the
 * published per-tonne figures). Paper and wood are biodegradable and carry
 * much higher landfill factors than inert/metal/plastic materials, because
 * decomposition in landfill generates methane — everything else clusters
 * around the same low landfill figure.
 */
const WASTE_FACTORS: Record<string, { recycled: number; landfill: number }> = {
  "Electrical items - IT": { recycled: 0.0046536, landfill: 0.0090069 },
  "Electrical items - small": { recycled: 0.0046536, landfill: 0.0090069 },
  "Electrical items - large": { recycled: 0.0046536, landfill: 0.0090069 },
  "Electrical items - fridges & freezers": { recycled: 0.0046536, landfill: 0.0090069 },
  "Steel / scrap metal": { recycled: 0.0046536, landfill: 0.0090069 },
  Aluminium: { recycled: 0.0046536, landfill: 0.0090069 },
  Plastic: { recycled: 0.0046536, landfill: 0.0090069 },
  Glass: { recycled: 0.0046536, landfill: 0.0090069 },
  Wood: { recycled: 0.0046536, landfill: 0.92537 },
  "Paper / board": { recycled: 0.0046536, landfill: 1.164513 },
  Concrete: { recycled: 0.0046536, landfill: 0.00127043 },
};
const DEFAULT_WASTE_FACTOR = { recycled: 0.0046536, landfill: 0.0090069 };

/** Types that represent the item's life ending, in the waste stream. */
const WASTE_TYPES = new Set(["Scrap", "Recycling", "Land Fill"]);
/** Types that represent the item's life being extended (avoided-manufacturing benefit applies). */
const REUSE_TYPES = new Set(["Donation", "Sale"]);

function periodRange(year: number, month?: number) {
  if (month) {
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
  }
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

export async function aggregateEsgReport(params: EsgReportParams): Promise<EsgReportData> {
  const { scope, year, month } = params;
  const { start, end } = periodRange(year, month);

  const scopeFilter =
    scope.kind === "hospital"
      ? Prisma.sql`r."Hospital Name" = ${scope.hospitalName}`
      : Prisma.sql`r."Hospital Name" IN (
          SELECT "Hospital Name" FROM "Hospitals"
          WHERE "Hospital Group" = ${scope.hospitalGroup} AND "Hospital Name" IS NOT NULL
        )`;

  const rows = await prisma.$queryRaw<(BaseRow & { hospital_name: string })[]>(Prisma.sql`
    SELECT
      r."Type" AS type,
      r."Hospital Name" AS hospital_name,
      i."Quantity" AS qty,
      s.weight_kg,
      s.volume_m3,
      s.material_category,
      s.co2e_kg,
      s.weight_source
    FROM "Report" r
    JOIN "Inventory" i ON r."ID" = i."ID"
    LEFT JOIN item_sustainability s ON i."Item" = s.item_id
    WHERE ${scopeFilter}
      AND r."Type" IS NOT NULL
      AND r."Type" != 'Removal'
      AND r."Date uplifted" >= ${start}
      AND r."Date uplifted" < ${end}
      AND i."Quantity" IS NOT NULL
  `);

  let hospitalsCovered: EsgReportData["hospitalsCovered"] = null;
  let scopeLabel: string;
  if (scope.kind === "hospital") {
    scopeLabel = scope.hospitalName;
  } else {
    const totalInGroup = await prisma.hospital.count({
      where: { hospitalGroup: scope.hospitalGroup, hospitalName: { not: null } },
    });
    const withActivity = new Set(rows.map((r) => r.hospital_name)).size;
    hospitalsCovered = { withActivity, totalInGroup };
    scopeLabel = `${scope.hospitalGroup} (${withActivity} of ${totalInGroup} hospitals with activity)`;
  }

  const itemsRemoved = rows.reduce((sum, r) => sum + (r.qty ?? 0), 0);
  const totalWeightKg = rows.reduce((sum, r) => sum + (r.weight_kg ?? 0) * (r.qty ?? 0), 0);

  // --- By route ---
  const routeMap = new Map<string, { items: number; weightKg: number; emissionsKgCo2e: number }>();
  for (const r of rows) {
    const weight = (r.weight_kg ?? 0) * r.qty;
    const bucket = routeMap.get(r.type) ?? { items: 0, weightKg: 0, emissionsKgCo2e: 0 };
    bucket.items += r.qty;
    bucket.weightKg += weight;
    if (WASTE_TYPES.has(r.type)) {
      const factors = (r.material_category && WASTE_FACTORS[r.material_category]) || DEFAULT_WASTE_FACTOR;
      const factor = r.type === "Land Fill" ? factors.landfill : factors.recycled;
      bucket.emissionsKgCo2e += weight * factor;
    }
    routeMap.set(r.type, bucket);
  }
  const byRoute: RouteRow[] = [...routeMap.entries()]
    .sort((a, b) => b[1].weightKg - a[1].weightKg)
    .map(([route, v]) => ({
      route,
      items: v.items,
      weightKg: v.weightKg,
      sharePct: totalWeightKg > 0 ? (v.weightKg / totalWeightKg) * 100 : 0,
      reportedEmissionsKgCo2e: v.emissionsKgCo2e,
    }));

  // --- By material ---
  const materialMap = new Map<string, MaterialRow>();
  for (const r of rows) {
    const key = r.material_category ?? "Unmatched / not yet catalogued";
    const weight = (r.weight_kg ?? 0) * r.qty;
    const m = materialMap.get(key) ?? {
      material: key, removedKg: 0, reusedKg: 0, recycledKg: 0, landfilledKg: 0, otherKg: 0,
    };
    m.removedKg += weight;
    if (REUSE_TYPES.has(r.type)) m.reusedKg += weight;
    else if (r.type === "Recycling") m.recycledKg += weight;
    else if (r.type === "Land Fill") m.landfilledKg += weight;
    else m.otherKg += weight;
    materialMap.set(key, m);
  }
  const byMaterial = [...materialMap.values()].sort((a, b) => b.removedKg - a.removedKg);

  // --- Waste-treatment emissions (Section 5 — reported Scope 3) ---
  const wtMap = new Map<string, WasteTreatmentRow>();
  for (const r of rows) {
    if (!WASTE_TYPES.has(r.type)) continue;
    const material = r.material_category ?? "Unmatched / not yet catalogued";
    const route: "Recycled" | "Landfill" = r.type === "Land Fill" ? "Landfill" : "Recycled";
    const factors = (r.material_category && WASTE_FACTORS[r.material_category]) || DEFAULT_WASTE_FACTOR;
    const factorPerKg = route === "Landfill" ? factors.landfill : factors.recycled;
    const massKg = (r.weight_kg ?? 0) * r.qty;
    const key = `${material}::${route}`;
    const row = wtMap.get(key) ?? {
      materialCategory: material, route, massTonnes: 0, factorKgCo2ePerTonne: factorPerKg * 1000, emissionsKgCo2e: 0,
    };
    row.massTonnes += massKg / 1000;
    row.emissionsKgCo2e += massKg * factorPerKg;
    wtMap.set(key, row);
  }
  const wasteTreatment = [...wtMap.values()].sort((a, b) => b.emissionsKgCo2e - a.emissionsKgCo2e);
  const reportedEmissionsKgCo2e = wasteTreatment.reduce((sum, r) => sum + r.emissionsKgCo2e, 0);

  // --- Avoided emissions (Section 6 — circular economy, Donation/Sale only) ---
  const avoidedMap = new Map<string, { items: number; massKg: number; avoidedKg: number }>();
  for (const r of rows) {
    if (!REUSE_TYPES.has(r.type)) continue;
    const activity = r.type === "Donation" ? "Equipment donated" : "Equipment sold for reuse";
    const bucket = avoidedMap.get(activity) ?? { items: 0, massKg: 0, avoidedKg: 0 };
    bucket.items += r.qty;
    bucket.massKg += (r.weight_kg ?? 0) * r.qty;
    bucket.avoidedKg += (r.co2e_kg ?? 0) * r.qty;
    avoidedMap.set(activity, bucket);
  }
  const avoidedEmissions: AvoidedEmissionRow[] = [...avoidedMap.entries()].map(([activity, v]) => ({
    activity,
    items: v.items,
    massTonnes: v.massKg / 1000,
    avoidedCo2eTonnes: v.avoidedKg / 1000,
  }));
  const avoidedEmissionsKgCo2e = [...avoidedMap.values()].reduce((sum, v) => sum + v.avoidedKg, 0);

  // --- Data quality ---
  const qualityWeight = { ewaste_sheet: 0, ai_estimated: 0, unmatched: 0 };
  for (const r of rows) {
    const weight = (r.weight_kg ?? 0) * r.qty;
    if (r.weight_source === "ewaste_sheet") qualityWeight.ewaste_sheet += weight;
    else if (r.weight_source === "ai_estimated") qualityWeight.ai_estimated += weight;
    else qualityWeight.unmatched += weight;
  }
  const dataQuality: DataQualityRow[] = (["ewaste_sheet", "ai_estimated", "unmatched"] as const)
    .filter((k) => qualityWeight[k] > 0)
    .map((source) => ({
      source,
      shareOfWeightPct: totalWeightKg > 0 ? (qualityWeight[source] / totalWeightKg) * 100 : 0,
    }));
  // Measured (real Ewaste weight) counts as High confidence, AI-estimated as Low,
  // matching the template's own suggested-score weighting (100% / 40%).
  const carbonDataQualityScorePct = totalWeightKg > 0
    ? ((qualityWeight.ewaste_sheet * 1.0 + qualityWeight.ai_estimated * 0.4) / totalWeightKg) * 100
    : 0;

  const reusedTonnes = byRoute
    .filter((r) => REUSE_TYPES.has(r.route))
    .reduce((sum, r) => sum + r.weightKg, 0) / 1000;
  const recycledTonnes = (routeMap.get("Recycling")?.weightKg ?? 0) / 1000;
  const landfillTonnes = (routeMap.get("Land Fill")?.weightKg ?? 0) / 1000;
  const totalTonnes = totalWeightKg / 1000;
  const landfillDiversionRatePct = totalTonnes > 0
    ? ((reusedTonnes + recycledTonnes) / totalTonnes) * 100
    : 0;

  return {
    scopeLabel,
    scope,
    hospitalsCovered,
    year,
    month: month ?? null,
    periodLabel: month ? `${MONTH_NAMES[month - 1]} ${year}` : `${year}`,
    generatedAt: new Date().toISOString(),
    itemsRemoved,
    totalWeightTonnes: totalTonnes,
    byRoute,
    byMaterial,
    wasteTreatment,
    avoidedEmissions,
    dataQuality,
    totals: {
      reusedTonnes,
      recycledTonnes,
      landfillTonnes,
      landfillDiversionRatePct,
      reportedEmissionsTonnesCo2e: reportedEmissionsKgCo2e / 1000,
      avoidedEmissionsTonnesCo2e: avoidedEmissionsKgCo2e / 1000,
      carbonDataQualityScorePct,
    },
  };
}
