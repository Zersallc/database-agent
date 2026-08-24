/**
 * Report branding: the company name and logo stamped on generated ESG/GHG
 * reports. A singleton per tenant, same shape as the Playbook — one
 * workspace, one set of branding, so it has no ID in the path. Materializes
 * a default (Medi Merchant's own name and logo) on first read rather than
 * 404-ing, since a tenant that never visited Settings should still get a
 * branded report, not a broken one.
 */

import { stores } from "@/lib/providers";

const REPORT_SETTINGS_ID = "report_settings";

export type ReportSettingsDoc = {
  id: string;
  object: "report_settings";
  company_name: string;
  logo_base64: string | null;
  logo_mime_type: string | null;
  updated_at: string;
};

const DEFAULT_COMPANY_NAME = "Medi Merchant";

export function serializeReportSettings(doc: ReportSettingsDoc) {
  return {
    object: doc.object,
    company_name: doc.company_name,
    has_custom_logo: doc.logo_base64 !== null,
    logo_data_url: doc.logo_base64 && doc.logo_mime_type
      ? `data:${doc.logo_mime_type};base64,${doc.logo_base64}`
      : null,
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
    company_name: DEFAULT_COMPANY_NAME,
    logo_base64: null,
    logo_mime_type: null,
    updated_at: new Date().toISOString(),
  };
  return stores().documents.put("report_settings", tenantId, doc);
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
