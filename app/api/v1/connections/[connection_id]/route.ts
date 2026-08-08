import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import {
  deleteConnection,
  requireConnection,
  serializeConnection,
  updateConnection,
} from "@/lib/services/connections";

export const runtime = "nodejs";

type Params = { connection_id: string };

const CREDENTIALS = v.object({
  dsn: v.optional(v.string({ max: 2000 })),
  host: v.optional(v.string({ max: 255 })),
  port: v.optional(v.integer({ min: 1, max: 65535 })),
  database: v.optional(v.string({ max: 255 })),
  username: v.optional(v.string({ max: 255 })),
  password: v.optional(v.string({ max: 1000, trim: false })),
  project_id: v.optional(v.string({ max: 255 })),
  service_account_json: v.optional(v.string({ max: 20000, trim: false })),
  ssl: v.optional(v.boolean()),
});

const UPDATE = v.object({
  name: v.optional(v.string({ min: 1, max: 120 })),
  credentials: v.optional(CREDENTIALS),
  allow_writes: v.optional(v.boolean()),
  max_rows: v.optional(v.integer({ min: 1, max: 50000 })),
  default_schema: v.optional(v.string({ max: 255 })),
});

export const GET = defineRoute<Params>({
  scopes: ["connections:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeConnection(await requireConnection(principal.tenantId, params.connection_id)),
  }),
});

export const PATCH = defineRoute<Params>({
  scopes: ["connections:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    const input = v.validate(body, UPDATE);
    const doc = await updateConnection(principal.tenantId, params.connection_id, input);
    return { body: serializeConnection(doc) };
  },
});

/**
 * Deleting an absent connection returns 204 rather than 404.
 *
 * Delete is idempotent by nature: a client retrying after a dropped response
 * should not have to distinguish "I deleted it" from "someone else already
 * did". Both mean the resource is gone, which is what was asked for.
 */
export const DELETE = defineRoute<Params>({
  scopes: ["connections:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    await deleteConnection(principal.tenantId, params.connection_id);
    return { status: 204 };
  },
});
