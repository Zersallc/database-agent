/**
 * Generated report files (ESG/GHG PDFs and Excel workbooks).
 *
 * These ride the document store rather than the blob store: BLOB_DRIVER is
 * not configured in this deployment (falls back to in-memory, which does not
 * survive a restart or work across Cloud Run instances), while the document
 * store is already Postgres-backed here. Report files are small (tens to a
 * couple hundred KB), so storing bytes as base64 inside a document is a
 * reasonable fit — this is not a general-purpose attachment store.
 */

import { notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { stores } from "@/lib/providers";

export type ReportFileDoc = {
  id: string;
  object: "report_file";
  name: string;
  mime_type: string;
  size_bytes: number;
  content_base64: string;
  created_by: string | null;
  created_at: string;
};

export async function createReportFile(
  tenantId: string,
  input: { name: string; mimeType: string; bytes: Buffer; userId: string | null }
): Promise<ReportFileDoc> {
  const doc: ReportFileDoc = {
    id: newId("reportFile"),
    object: "report_file",
    name: input.name,
    mime_type: input.mimeType,
    size_bytes: input.bytes.byteLength,
    content_base64: input.bytes.toString("base64"),
    created_by: input.userId,
    created_at: new Date().toISOString(),
  };
  return stores().documents.put("reports", tenantId, doc);
}

export async function requireReportFile(tenantId: string, id: string): Promise<ReportFileDoc> {
  const doc = await stores().documents.get<ReportFileDoc>("reports", tenantId, id);
  if (!doc) throw notFound("report_file", id);
  return doc;
}
