import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import { SUPPORTED_ENGINES } from "@/lib/connectors";
import {
  createConnection,
  listConnections,
  serializeConnection,
  type ConnectionStatus,
} from "@/lib/services/connections";

export const runtime = "nodejs";

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

const CREATE = v.object({
  name: v.string({ min: 1, max: 120 }),
  engine: v.oneOf(SUPPORTED_ENGINES),
  credentials: v.optional(CREDENTIALS),
  allow_writes: v.withDefault(v.boolean(), false),
  max_rows: v.withDefault(v.integer({ min: 1, max: 50000 }), 1000),
  default_schema: v.optional(v.string({ max: 255 })),
});

export const GET = defineRoute({
  scopes: ["connections:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    const params = readListParams(url);
    const status = url.searchParams.get("status") as ConnectionStatus | null;
    const page = await listConnections(principal.tenantId, params, {
      status: status ?? undefined,
    });
    return {
      body: {
        data: page.data.map(serializeConnection),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

export const POST = defineRoute({
  scopes: ["connections:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const doc = await createConnection(principal.tenantId, input);
    return {
      status: 201,
      body: serializeConnection(doc),
      headers: { Location: `/api/v1/connections/${doc.id}` },
    };
  },
});
