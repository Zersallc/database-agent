import { defineRoute } from "@/lib/api/handler";
import { readFileBytes, requireFile, serializeFile } from "@/lib/services/files";

export const runtime = "nodejs";

type Params = { file_id: string };

/**
 * File metadata with a fresh download URL.
 *
 * `?download=true` streams the bytes instead. That path exists for storage
 * drivers that cannot sign URLs — without it, an attachment stored by the
 * memory driver would be unreachable.
 */
export const GET = defineRoute<Params>({
  scopes: ["files:read"],
  rateLimit: "read",
  handler: async ({ principal, params, url }) => {
    const doc = await requireFile(principal.tenantId, params.file_id);

    if (url.searchParams.get("download") === "true") {
      const blob = await readFileBytes(doc);
      if (!blob) {
        const { ApiError } = await import("@/lib/api/errors");
        throw new ApiError(
          "not_found",
          "The file record exists but its contents are missing from storage."
        );
      }
      return new Response(new Uint8Array(blob.body), {
        headers: {
          "Content-Type": doc.mime_type,
          "Content-Length": String(doc.size_bytes),
          // `attachment` rather than `inline`: an uploaded SVG or HTML file
          // rendered in the browser would execute in this origin.
          "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.name)}"`,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return { body: await serializeFile(doc) };
  },
});
