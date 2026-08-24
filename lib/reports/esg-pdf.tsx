/**
 * PDF rendering for the Monthly ESG, Waste and GHG Report.
 *
 * Mirrors the client's own template structure (see the "Monthly ESG, Waste
 * and GHG Report" reference document): cover, executive summary, scorecard,
 * waste by route, material recovery, reported emissions, avoided emissions,
 * data quality. Sections that have no data source in Postgres (Social &
 * Governance indicators, Exceptions, manual Approval signoff) are omitted
 * rather than shipped as empty placeholders — this is a generated report,
 * not a form to fill in by hand.
 */

import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { EsgReportData } from "@/lib/services/esg-report";

const COLORS = {
  ink: "#16241f",
  muted: "#4c5951",
  accent: "#1f6f63",
  accentBg: "#dfeae5",
  amber: "#a8721f",
  amberBg: "#f3e6cf",
  border: "#cfd6c7",
  headerBg: "#e3e7de",
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, color: COLORS.ink, fontFamily: "Helvetica" },
  wordmark: { fontSize: 9, letterSpacing: 2, color: COLORS.accent, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 18, marginTop: 4, marginBottom: 10, fontFamily: "Helvetica-Bold" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", borderTop: 1, borderColor: COLORS.border, marginBottom: 16 },
  metaCell: { width: "50%", padding: 8, borderBottom: 1, borderRight: 1, borderColor: COLORS.border },
  metaLabel: { fontSize: 7, letterSpacing: 1, color: COLORS.muted, marginBottom: 2 },
  metaValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  sectionHead: { flexDirection: "row", alignItems: "baseline", gap: 6, borderBottom: 1.5, borderColor: COLORS.ink, marginTop: 18, marginBottom: 8, paddingBottom: 4 },
  sectionNum: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLORS.accent },
  sectionTitle: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  para: { fontSize: 9.5, lineHeight: 1.5, marginBottom: 6 },
  muted: { color: COLORS.muted, fontSize: 8.5 },
  table: { borderTop: 1, borderLeft: 1, borderColor: COLORS.border, marginBottom: 8 },
  tr: { flexDirection: "row" },
  th: { backgroundColor: COLORS.headerBg, fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 0.5, padding: 5, borderRight: 1, borderBottom: 1, borderColor: COLORS.border, color: COLORS.muted },
  td: { fontSize: 8.5, padding: 5, borderRight: 1, borderBottom: 1, borderColor: COLORS.border },
  tdNum: { fontSize: 8.5, padding: 5, borderRight: 1, borderBottom: 1, borderColor: COLORS.border, textAlign: "right" },
  totalRow: { backgroundColor: COLORS.headerBg, fontFamily: "Helvetica-Bold" },
  amberBox: { backgroundColor: COLORS.amberBg, borderWidth: 1, borderColor: COLORS.amber, padding: 10, marginBottom: 8 },
  amberLabel: { fontSize: 7.5, letterSpacing: 1, color: COLORS.amber, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7.5, color: COLORS.muted, textAlign: "center", borderTop: 1, borderColor: COLORS.border, paddingTop: 6 },
});

function fmt(n: number, decimals = 1): string {
  return n.toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function pct(n: number): string {
  return `${fmt(n, 1)}%`;
}

function Table({ widths, header, rows, totalRow }: {
  widths: number[];
  header: string[];
  rows: (string | number)[][];
  totalRow?: (string | number)[];
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tr}>
        {header.map((h, i) => (
          <Text key={i} style={[styles.th, { width: `${widths[i]}%` }]}>{h}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View style={styles.tr} key={ri}>
          {row.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                typeof cell === "number" || (ci > 0 && /^[\d.,%\-\s]+$/.test(String(cell))) ? styles.tdNum : styles.td,
                { width: `${widths[ci]}%` },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
      {totalRow && (
        <View style={styles.tr}>
          {totalRow.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                ci === 0 ? styles.td : styles.tdNum,
                styles.totalRow,
                { width: `${widths[ci]}%` },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function SectionHead({ num, title }: { num: string; title: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionNum}>{num}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export function EsgReportDocument({ data }: { data: EsgReportData }) {
  const reused = data.byRoute.filter((r) => r.route === "Donation" || r.route === "Sale");
  const reusedTotal = reused.reduce((s, r) => s + r.weightKg, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.wordmark}>MEDI MERCHANT</Text>
        <Text style={styles.title}>Monthly ESG, Waste and GHG Report</Text>

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>{data.scope.kind === "group" ? "CLIENT GROUP" : "CLIENT"}</Text>
            <Text style={styles.metaValue}>{data.scopeLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>REPORTING PERIOD</Text>
            <Text style={styles.metaValue}>{data.periodLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>PREPARED BY</Text>
            <Text style={styles.metaValue}>Medi Merchant</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>METHODOLOGY</Text>
            <Text style={styles.metaValue}>UK Govt GHG Conversion Factors 2026</Text>
          </View>
        </View>
        <Text style={styles.muted}>
          Reporting boundary: equipment and waste collected from {data.scopeLabel} and managed by Medi
          Merchant during {data.periodLabel}. UK Government (DESNZ) factors are applied to South African
          operations, as no directly published South African national equivalent factor set is used.
        </Text>

        <SectionHead num="01" title="Executive Summary" />
        <Text style={styles.para}>
          During {data.periodLabel}, Medi Merchant processed {fmt(data.itemsRemoved, 0)} items, weighing{" "}
          {fmt(data.totalWeightTonnes, 3)} tonnes, from {data.scopeLabel}. Of this material,{" "}
          {fmt(data.totals.reusedTonnes, 3)} tonnes were reused through sale or donation,{" "}
          {fmt(data.totals.recycledTonnes, 3)} tonnes were recycled, and {fmt(data.totals.landfillTonnes, 3)}{" "}
          tonnes were sent to landfill. The resulting landfill-diversion rate was{" "}
          {pct(data.totals.landfillDiversionRatePct)}.
        </Text>
        <Text style={styles.para}>
          Reported waste-treatment emissions were {fmt(data.totals.reportedEmissionsTonnesCo2e, 3)} tCO2e.
          Separately estimated avoided emissions were {fmt(data.totals.avoidedEmissionsTonnesCo2e, 2)} tCO2e.
        </Text>
        <Text style={styles.muted}>
          Avoided emissions are presented as an indicative circular-economy benefit and are not included in
          the reported Scope 3 waste-treatment emissions above.
        </Text>

        <SectionHead num="02" title="Monthly ESG and GHG Scorecard" />
        <Table
          widths={[46, 24, 30]}
          header={["Indicator", "Value", "Data Quality"]}
          rows={[
            ["Items processed", fmt(data.itemsRemoved, 0), "Measured / Estimated"],
            ["Total material processed", `${fmt(data.totalWeightTonnes, 3)} t`, "Measured / Estimated"],
            ["Reused (sold + donated)", `${fmt(data.totals.reusedTonnes, 3)} t`, "Transaction records"],
            ["Recycled", `${fmt(data.totals.recycledTonnes, 3)} t`, "Transaction records"],
            ["Landfilled", `${fmt(data.totals.landfillTonnes, 3)} t`, "Transaction records"],
            ["Landfill-diversion rate", pct(data.totals.landfillDiversionRatePct), "Calculated"],
            ["Reported waste-treatment emissions", `${fmt(data.totals.reportedEmissionsTonnesCo2e, 3)} tCO2e`, "Calculated"],
            ["Estimated avoided emissions", `${fmt(data.totals.avoidedEmissionsTonnesCo2e, 2)} tCO2e`, "Scenario estimate"],
            ["Carbon data quality score", pct(data.totals.carbonDataQualityScorePct), "Calculated"],
          ]}
        />

        <SectionHead num="03" title="Waste by Management Route" />
        <Table
          widths={[30, 14, 18, 18, 20]}
          header={["Route", "Items", "Weight (kg)", "Share", "Reported Emissions (kgCO2e)"]}
          rows={data.byRoute.map((r) => [
            r.route,
            fmt(r.items, 0),
            fmt(r.weightKg, 1),
            pct(r.sharePct),
            fmt(r.reportedEmissionsKgCo2e, 2),
          ])}
          totalRow={[
            "Total",
            fmt(data.itemsRemoved, 0),
            fmt(data.byRoute.reduce((s, r) => s + r.weightKg, 0), 1),
            "100%",
            fmt(data.byRoute.reduce((s, r) => s + r.reportedEmissionsKgCo2e, 0), 2),
          ]}
        />
        <Text style={styles.muted}>
          Reuse (sold + donated) is {fmt(reusedTotal, 1)} kg this period, counted only where a Donation or
          Sale record exists — not simply removal from site.
        </Text>

        <SectionHead num="04" title="Material Recovery" />
        <Table
          widths={[28, 18, 18, 18, 18]}
          header={["Material", "Removed (kg)", "Reused (kg)", "Recycled (kg)", "Landfilled (kg)"]}
          rows={data.byMaterial.map((m) => [
            m.material,
            fmt(m.removedKg, 1),
            fmt(m.reusedKg, 1),
            fmt(m.recycledKg, 1),
            fmt(m.landfilledKg, 1),
          ])}
        />
      </Page>

      <Page size="A4" style={styles.page}>
        <SectionHead num="05" title="Reported GHG Emissions" />
        <Text style={styles.muted}>5.1 Waste-treatment emissions — Sum(material tonnes x UK waste-treatment factor)</Text>
        <View style={{ height: 6 }} />
        {data.wasteTreatment.length > 0 ? (
          <Table
            widths={[30, 18, 16, 18, 18]}
            header={["Material", "Route", "Mass (t)", "2026 Factor (kgCO2e/t)", "Emissions (kgCO2e)"]}
            rows={data.wasteTreatment.map((w) => [
              w.materialCategory,
              w.route,
              fmt(w.massTonnes, 4),
              fmt(w.factorKgCo2ePerTonne, 3),
              fmt(w.emissionsKgCo2e, 2),
            ])}
            totalRow={[
              "Total waste treatment", "", "",
              "",
              fmt(data.wasteTreatment.reduce((s, w) => s + w.emissionsKgCo2e, 0), 2),
            ]}
          />
        ) : (
          <Text style={styles.para}>No Scrap, Recycling or Landfill transactions recorded this period.</Text>
        )}
        <Text style={styles.muted}>
          Factor values are UK Government (DESNZ) 2026 &quot;Waste disposal&quot; category factors, applied
          per the treatment route actually recorded for each transaction.
        </Text>

        <SectionHead num="06" title="Circular Economy and Avoided Emissions" />
        <View style={styles.amberBox}>
          <Text style={styles.amberLabel}>INDICATIVE BENEFIT — NOT VERIFIED CARBON SAVINGS</Text>
          {data.avoidedEmissions.length > 0 ? (
            <Table
              widths={[38, 16, 20, 26]}
              header={["Activity", "Items", "Mass (t)", "Avoided Emissions (tCO2e)"]}
              rows={data.avoidedEmissions.map((a) => [
                a.activity,
                fmt(a.items, 0),
                fmt(a.massTonnes, 3),
                fmt(a.avoidedCo2eTonnes, 3),
              ])}
              totalRow={[
                "Total estimated benefit", "", "",
                fmt(data.avoidedEmissions.reduce((s, a) => s + a.avoidedCo2eTonnes, 0), 3),
              ]}
            />
          ) : (
            <Text style={styles.para}>No Donation or Sale transactions recorded this period.</Text>
          )}
          <Text style={[styles.muted, { marginTop: 4 }]}>
            Avoided emissions use each item&apos;s manufacturing/embodied-carbon factor (UK DESNZ 2026
            &quot;Material use&quot; category) — the emissions avoided by extending the item&apos;s life via
            reuse rather than it being landfilled and replaced.
          </Text>
        </View>
        <Text style={[styles.para, { fontFamily: "Helvetica-Bold", fontSize: 8.5 }]}>
          Required disclosure — estimated avoided emissions:
        </Text>
        <Text style={styles.muted}>- Are not deducted from reported Scope 1, Scope 2 or Scope 3 emissions.</Text>
        <Text style={styles.muted}>- Depend on the selected baseline and displacement assumptions.</Text>
        <Text style={styles.muted}>- Should be labelled as estimates rather than verified carbon savings.</Text>

        <SectionHead num="07" title="Data Quality" />
        <Table
          widths={[50, 25, 25]}
          header={["Data Source", "Share of Reported Weight", "Quality Rating"]}
          rows={data.dataQuality.map((d) => [
            d.source === "ewaste_sheet" ? "Recorded weight (Ewaste reference)" : d.source === "ai_estimated" ? "AI-estimated weight" : "Unmatched item",
            pct(d.shareOfWeightPct),
            d.source === "ewaste_sheet" ? "High" : d.source === "ai_estimated" ? "Low" : "Unacceptable",
          ])}
        />
        <Text style={styles.muted}>
          Carbon Data Quality Score = (100% x Recorded) + (40% x AI-estimated) = {pct(data.totals.carbonDataQualityScorePct)}, reported in section 02.
        </Text>

        <SectionHead num="08" title="Methodology and Limitations" />
        <Text style={styles.para}>
          This report uses the UK Government GHG Conversion Factors for Company Reporting 2026, applied to
          South African operations, as no directly published South African national equivalent factor set is
          used. Waste-treatment emissions are calculated as material mass in tonnes multiplied by the
          matching material-and-treatment factor, using the actual treatment route recorded for each
          transaction. Avoided emissions use a separate, manufacturing-based factor and are disclosed apart
          from reported emissions, per section 06.
        </Text>

        <Text style={styles.footer}>
          Medi Merchant - Database Agent ESG report - generated {new Date(data.generatedAt).toLocaleString("en-ZA")}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderEsgReportPdf(data: EsgReportData): Promise<Buffer> {
  return renderToBuffer(<EsgReportDocument data={data} />);
}
