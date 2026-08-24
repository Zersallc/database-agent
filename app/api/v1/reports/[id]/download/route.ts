import { defineRoute } from "@/lib/api/handler";
import { requireReportFile } from "@/lib/services/report-files";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = defineRoute<Params>({
  scopes: ["files:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => {
    const doc = await requireReportFile(principal.tenantId, params.id);
    const bytes = Buffer.from(doc.content_base64, "base64");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `attachment; filename="${doc.name.replace(/"/g, "")}"`,
        "Content-Length": String(doc.size_bytes),
        "Cache-Control": "private, no-store",
      },
    });
  },
});
