/**
 * Report branding: the company name and logo stamped on generated ESG/GHG
 * reports. A singleton per tenant, same shape as the Playbook — one
 * workspace, one set of branding, so it has no ID in the path.
 *
 * `company_name`/`logo_base64`/`logo_mime_type` being null means "not
 * customized here" — the effective value then falls back to that tenant's
 * own Company record (name + logo, managed on the Companies admin page),
 * not a hardcoded default. That keeps every company's reports branded as
 * themselves out of the box, and keeps following the Company record if it's
 * renamed or re-logo'd later, without this doc going stale.
 */

import { prisma } from "@/lib/db";
import { stores } from "@/lib/providers";

const REPORT_SETTINGS_ID = "report_settings";

/** Last-resort fallback when the tenant has no Company row at all (local/dev). */
const DEFAULT_COMPANY_NAME = "Workspace";

export type ReportSettingsDoc = {
  id: string;
  object: "report_settings";
  company_name: string | null;
  logo_base64: string | null;
  logo_mime_type: string | null;
  updated_at: string;
};

export type CompanyBranding = {
  name: string;
  logoBase64: string | null;
  logoMimeType: string | null;
};

export async function getCompanyBranding(companyId: string): Promise<CompanyBranding> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, logoBase64: true, logoMimeType: true },
  });
  return {
    name: company?.name ?? DEFAULT_COMPANY_NAME,
    logoBase64: company?.logoBase64 ?? null,
    logoMimeType: company?.logoMimeType ?? null,
  };
}

function effectiveLogo(
  doc: ReportSettingsDoc,
  company: CompanyBranding
): { base64: string; mimeType: string } | null {
  if (doc.logo_base64 && doc.logo_mime_type) {
    return { base64: doc.logo_base64, mimeType: doc.logo_mime_type };
  }
  if (company.logoBase64 && company.logoMimeType) {
    return { base64: company.logoBase64, mimeType: company.logoMimeType };
  }
  return null;
}

function toDataUrl(logo: { base64: string; mimeType: string } | null): string | null {
  return logo ? `data:${logo.mimeType};base64,${logo.base64}` : null;
}

export function serializeReportSettings(doc: ReportSettingsDoc, company: CompanyBranding) {
  return {
    object: doc.object,
    company_name: doc.company_name ?? company.name,
    has_custom_logo: doc.logo_base64 !== null,
    logo_data_url: toDataUrl(effectiveLogo(doc, company)),
    updated_at: doc.updated_at,
  };
}

export async function getReportSettings(tenantId: string): Promise<ReportSettingsDoc> {
  const existing = await stores().documents.get<ReportSettingsDoc>(
    "report_settings",
    tenantId,
    REPORT_SETTINGS_ID
  );
  if (existing) return existing;

  const doc: ReportSettingsDoc = {
    id: REPORT_SETTINGS_ID,
    object: "report_settings",
    company_name: null,
    logo_base64: null,
    logo_mime_type: null,
    updated_at: new Date().toISOString(),
  };
  return stores().documents.put("report_settings", tenantId, doc);
}

/** The name/logo to actually stamp on a rendered report — doc override, else the tenant's Company record. */
export async function getEffectiveBranding(
  tenantId: string
): Promise<{ companyName: string; logoBase64: string | null; logoMimeType: string | null }> {
  const [doc, company] = await Promise.all([getReportSettings(tenantId), getCompanyBranding(tenantId)]);
  const logo = effectiveLogo(doc, company);
  return {
    companyName: doc.company_name ?? company.name,
    logoBase64: logo?.base64 ?? null,
    logoMimeType: logo?.mimeType ?? null,
  };
}

export async function updateReportSettings(
  tenantId: string,
  input: { companyName?: string; logoBase64?: string | null; logoMimeType?: string | null }
): Promise<ReportSettingsDoc> {
  const existing = await getReportSettings(tenantId);
  const changes: Partial<ReportSettingsDoc> = { updated_at: new Date().toISOString() };
  if (input.companyName !== undefined) changes.company_name = input.companyName;
  if (input.logoBase64 !== undefined) changes.logo_base64 = input.logoBase64;
  if (input.logoMimeType !== undefined) changes.logo_mime_type = input.logoMimeType;

  const updated = await stores().documents.patch<ReportSettingsDoc>(
    "report_settings",
    tenantId,
    REPORT_SETTINGS_ID,
    changes
  );
  return updated ?? existing;
}
