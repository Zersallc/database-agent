import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import {
  getReportSettings,
  serializeReportSettings,
  updateReportSettings,
} from "@/lib/services/report-settings";

export const runtime = "nodejs";

/** Logos are small brand marks, not photos. 1 MB is generous. */
const MAX_LOGO_BYTES = 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

const UPDATE = v.object({
  company_name: v.optional(v.string({ min: 1, max: 200 })),
  // Provide both to set a new logo. Omit both to leave the current logo
  // untouched. Set remove_logo instead to fall back to the default mark.
  logo_base64: v.optional(v.string({ max: 2_000_000, trim: false })),
  logo_mime_type: v.optional(v.string({ max: 100 })),
  remove_logo: v.optional(v.boolean()),
});

export const GET = defineRoute({
  scopes: ["report_settings:read"],
  rateLimit: "read",
  handler: async ({ principal }) => {
    const doc = await getReportSettings(principal.tenantId);
    return { body: serializeReportSettings(doc) };
  },
});

export const PATCH = defineRoute({
  scopes: ["report_settings:write"],
  rateLimit: "write",
  handler: async ({ principal, body }) => {
    const input = v.validate(body, UPDATE);

    if (input.logo_base64) {
      const bytes = Buffer.from(input.logo_base64, "base64");
      if (bytes.byteLength === 0) {
        throw new ApiError("invalid_request", "'logo_base64' is not valid base64.");
      }
      if (bytes.byteLength > MAX_LOGO_BYTES) {
        throw new ApiError(
          "payload_too_large",
          `The logo is ${(bytes.byteLength / 1024).toFixed(0)} KB; the limit is ${(MAX_LOGO_BYTES / 1024).toFixed(0)} KB.`
        );
      }
      if (!input.logo_mime_type || !ALLOWED_LOGO_TYPES.has(input.logo_mime_type)) {
        throw new ApiError("invalid_request", "'logo_mime_type' must be image/png or image/jpeg.");
      }
    }

    const doc = await updateReportSettings(principal.tenantId, {
      companyName: input.company_name,
      logoBase64: input.remove_logo ? null : input.logo_base64,
      logoMimeType: input.remove_logo ? null : input.logo_mime_type,
    });
    return { body: serializeReportSettings(doc) };
  },
});
