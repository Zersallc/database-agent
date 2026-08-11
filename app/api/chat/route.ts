/**
 * `POST /api/chat` — deprecated.
 *
 * This was the workspace's only endpoint before the v1 API existed, and the
 * chat UI still calls it. It keeps working, unchanged, for the whole runway.
 *
 * The replacement is `POST /api/v1/conversations/{id}/runs`, which does
 * everything this does plus persistence, a trace with query IDs, streaming, and
 * idempotency. The migration is in docs/api/versioning.md.
 *
 * Two things this deliberately does *not* do: change its request or response
 * shape, and start writing conversation records. A deprecated endpoint that
 * quietly alters its behavior is worse than one that is simply old — the whole
 * point of the runway is that nothing breaks until the sunset date.
 */

import { runAgent } from "@/lib/agent";
import { authenticate } from "@/lib/api/auth";
import {
  deprecationHeaders,
  recordDeprecatedUsage,
  type Deprecation,
} from "@/lib/api/deprecation";
import { toApiError } from "@/lib/api/errors";
import { newRequestId } from "@/lib/api/ids";
import { readJson } from "@/lib/api/validate";
import { getSchema, type ConnectionDoc } from "@/lib/services/connections";
import { resolveModelClient } from "@/lib/services/model-providers";
import { buildAgentContext } from "@/lib/services/playbook";
import { runQuery, toQueryResult } from "@/lib/services/queries";
import { stores } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEPRECATION: Deprecation = {
  deprecatedAt: new Date("2026-08-08T00:00:00Z"),
  // Nine months. Long enough that anyone who integrated against this has time
  // to move without dropping planned work, which is the only kind of runway
  // that actually keeps the promise.
  sunsetAt: new Date("2027-05-08T00:00:00Z"),
  successor: "/api/v1/conversations/{conversation_id}/runs",
  reason:
    "POST /api/chat is deprecated; use POST /api/v1/conversations/{conversation_id}/runs. Sunset 2027-05-08.",
};

type LegacyMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string; mimeType: string }[];
};

type LegacyRequest = {
  messages?: LegacyMessage[];
  connectionId?: string;
  playbookContext?: string;
  enabledSkills?: string[];
  responseDetail?: "concise" | "balanced" | "detailed";
};

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const headers = {
    ...deprecationHeaders(DEPRECATION),
    "X-Request-Id": requestId,
    "Cache-Control": "no-store",
  };

  try {
    const principal = await authenticate(request);
    recordDeprecatedUsage("POST /api/chat", DEPRECATION, {
      requestId,
      tenantId: principal.tenantId,
      userAgent: request.headers.get("user-agent"),
    });

    const payload = (await readJson(request)) as LegacyRequest;
    const messages = payload.messages ?? [];
    const question = messages[messages.length - 1]?.content ?? "";
    const history = messages.slice(0, -1).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const connection = await resolveConnection(principal.tenantId, payload.connectionId);

    // The legacy client assembles the playbook itself and sends it along. Honor
    // what it sent; fall back to the server-side playbook when it sent nothing.
    const playbookContext =
      payload.playbookContext?.trim() || (await buildAgentContext(principal.tenantId));

    let schema = null;
    if (connection) {
      try {
        schema = (await getSchema(principal.tenantId, connection)).tables;
      } catch {
        schema = [];
      }
    }

    const resolved = await resolveModelClient(principal.tenantId, principal.userId);

    let reply = "";
    for await (const event of runAgent({
      question,
      history,
      playbookContext,
      responseDetail: payload.responseDetail ?? "balanced",
      client: resolved?.client ?? null,
      connection: connection
        ? {
            name: connection.name,
            engine: connection.engine,
            schema,
            execute: async (sql: string) => {
              const query = await runQuery(principal.tenantId, connection, {
                sql,
                userId: principal.userId,
              });
              if (query.status === "failed") {
                throw new Error(query.error?.message ?? "The query failed.");
              }
              return { queryId: query.id, result: toQueryResult(query) };
            },
          }
        : null,
    })) {
      if (event.type === "completed") reply = event.content;
      if (event.type === "failed") throw event.error;
    }

    return Response.json({ reply }, { headers });
  } catch (error) {
    const apiError = toApiError(error);
    // The legacy shape is `{reply}`, and the old client renders whatever it
    // gets. Returning the error as a reply keeps a failure visible in the UI
    // instead of showing the client's generic "something went wrong".
    return Response.json(
      { reply: `**Something went wrong.**\n\n${apiError.message}`, error: apiError.toBody(requestId) },
      { status: apiError.status, headers }
    );
  }
}

/**
 * The legacy client sends hardcoded connection IDs from its mock data, which do
 * not exist server-side. Rather than failing, fall back to the workspace's first
 * connection — which on a fresh install is the sample dataset, so the demo keeps
 * working exactly as it did.
 */
async function resolveConnection(
  tenantId: string,
  connectionId?: string
): Promise<ConnectionDoc | null> {
  const { documents } = stores();

  if (connectionId) {
    const exact = await documents.get<ConnectionDoc>("connections", tenantId, connectionId);
    if (exact) return exact;
  }

  const [first] = await documents.list<ConnectionDoc>("connections", tenantId, {
    orderBy: "created_at",
    order: "asc",
    limit: 1,
  });
  return first ?? null;
}
