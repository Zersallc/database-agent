import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { createFile, serializeFile } from "@/lib/services/files";

export const runtime = "nodejs";

const CREATE = v.object({
  name: v.string({ min: 1, max: 255 }),
  mime_type: v.string({ min: 1, max: 255 }),
  content: v.string({ min: 1, trim: false }),
});

/**
 * Base64 in a JSON body rather than multipart.
 *
 * Attachments here are screenshots and small CSVs, and one consistent content
 * type across the whole API is worth more to an integrator than the ~33% size
 * overhead. If large uploads become a real use case, the successor is a
 * presigned direct-to-storage flow, not multipart on this endpoint.
 */
export const POST = defineRoute({
  scopes: ["files:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const doc = await createFile(principal.tenantId, {
      name: input.name,
      mimeType: input.mime_type,
      contentBase64: input.content,
      userId: principal.userId,
    });
    return {
      status: 201,
      body: await serializeFile(doc),
      headers: { Location: `/api/v1/files/${doc.id}` },
    };
  },
});
