/**
 * Form logic for the Document libraries tab, kept out of the component so it
 * can be tested directly — the same split `components/chat/blocks/chart/
 * adapt-option.ts` uses, and for the same reason: this project has no DOM
 * test runner, so anything worth asserting has to be a plain function.
 *
 * Every limit here mirrors `lib/services/connections.ts`. The service is the
 * real boundary and re-checks all of it; these copies exist only so a
 * Developer sees the problem before a round trip, never as the enforcement.
 */

import { isDeveloperRole } from "@/lib/roles";

/** The wire shape of `serializeMediaConnection` — note there is no `alias_id`. */
export type MediaConnectionWire = {
  id: string;
  object: string;
  kind: string;
  name: string;
  description: string | null;
  enabled: boolean;
  status: string;
  status_checked_at: string | null;
  status_detail: string | null;
  media: { library_ref: string | null; server_ref: string };
  created_at: string;
  updated_at: string;
};

export const NAME_MAX_CHARS = 120;
export const DESCRIPTION_MAX_CHARS = 2000;
export const LIBRARY_REF_MAX_CHARS = 200;

/** Mirrors `LIBRARY_REF_PATTERN` in lib/services/connections.ts. */
export const LIBRARY_REF_PATTERN = /^[A-Za-z0-9 ._\-:/]*$/;

/**
 * Mirrors `SUPPORTED_MEDIA_SERVER_REFS`. A Developer picks a configured
 * deployment by name; the URL and token behind that name are deployment
 * configuration the browser never sees and never sends.
 */
export const SERVER_REF_OPTIONS: Record<string, string> = {
  default: "Default document server",
};

export type MediaFormState = {
  companyId: string;
  name: string;
  description: string;
  libraryRef: string;
  serverRef: string;
  enabled: boolean;
};

/**
 * A new library starts disabled: the syslab-side library and its alias link
 * are an operator step that has not happened yet at the moment this record is
 * created, so switching it on by default would advertise a source the agent
 * cannot actually search.
 */
export const EMPTY_MEDIA_FORM: MediaFormState = {
  companyId: "",
  name: "",
  description: "",
  libraryRef: "",
  serverRef: "default",
  enabled: false,
};

export function formFromConnection(connection: MediaConnectionWire, companyId: string): MediaFormState {
  return {
    companyId,
    name: connection.name,
    description: connection.description ?? "",
    libraryRef: connection.media.library_ref ?? "",
    serverRef: connection.media.server_ref,
    enabled: connection.enabled,
  };
}

/** The first problem a Developer should fix, or null when the form is submittable. */
export function validateMediaForm(
  form: MediaFormState,
  options: { requireCompany?: boolean } = {}
): string | null {
  if (options.requireCompany && !form.companyId) return "Pick a company.";

  const name = form.name.trim();
  if (!name) return "Name is required.";
  if (name.length > NAME_MAX_CHARS) return `Name must be at most ${NAME_MAX_CHARS} characters.`;

  if (form.description.trim().length > DESCRIPTION_MAX_CHARS) {
    return `Description must be at most ${DESCRIPTION_MAX_CHARS} characters.`;
  }

  const libraryRef = form.libraryRef.trim();
  if (libraryRef.length > LIBRARY_REF_MAX_CHARS) {
    return `Library reference must be at most ${LIBRARY_REF_MAX_CHARS} characters.`;
  }
  if (!LIBRARY_REF_PATTERN.test(libraryRef)) {
    return "Library reference may only contain letters, digits, spaces, and . _ - : /";
  }

  if (!(form.serverRef in SERVER_REF_OPTIONS)) return "Pick a document server.";

  return null;
}

/**
 * The POST body. `enabled` is always sent explicitly rather than left to the
 * API's own default, so "create it switched off" is a decision this form
 * states rather than one it inherits.
 */
export function createBody(form: MediaFormState) {
  const description = form.description.trim();
  const libraryRef = form.libraryRef.trim();
  return {
    name: form.name.trim(),
    ...(description ? { description } : {}),
    ...(libraryRef ? { library_ref: libraryRef } : {}),
    server_ref: form.serverRef,
    enabled: form.enabled,
  };
}

/**
 * The PATCH body. A field left blank is omitted, not sent as an empty string:
 * the API cannot currently clear `description` or `library_ref` (an omitted
 * and an explicitly-empty field reach the service the same way), so omitting
 * keeps the stored value rather than silently appearing to erase it. The form
 * says so next to those fields.
 *
 * `server_ref` and the alias are fixed at creation and are not sent at all.
 */
export function updateBody(form: MediaFormState) {
  const description = form.description.trim();
  const libraryRef = form.libraryRef.trim();
  return {
    name: form.name.trim(),
    ...(description ? { description } : {}),
    ...(libraryRef ? { library_ref: libraryRef } : {}),
    enabled: form.enabled,
  };
}

/**
 * A request this tab sends, as method/headers/body rather than as a `fetch`
 * call. Building it here is what makes the headers assertable — the create
 * request shipped without its `Idempotency-Key` and every test passed, because
 * the tests only ever looked at the body.
 */
export type MutationRequest = {
  method: string;
  headers: Record<string, string>;
  body?: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * POST to the media collection is declared `idempotent: true`, so the API
 * rejects a create with no `Idempotency-Key` as a 400 before the handler runs.
 */
export function createRequestInit(form: MediaFormState, idempotencyKey: string): MutationRequest {
  return {
    method: "POST",
    headers: { ...JSON_HEADERS, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(createBody(form)),
  };
}

/** PATCH is not idempotency-gated — sending a key would be refused as unexpected, not required. */
export function patchRequestInit(body: Record<string, unknown>): MutationRequest {
  return { method: "PATCH", headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
}

export function deleteRequestInit(): MutationRequest {
  return { method: "DELETE", headers: {} };
}

/** What happened to an attempt, as far as the browser can tell. */
export type AttemptOutcome = "no-response" | "in-progress" | "refused";

/** Enough of a `Response` to classify it; a real one satisfies this. */
export type FailedResponse = { status: number; headers: { get(name: string): string | null } };

/**
 * Which of the two 409s this is.
 *
 * `beginIdempotent` answers 409 in two quite different situations, both coded
 * `resource_conflict`, and `createMediaConnection` adds a third for a duplicate
 * name. Only one of them — "a request with this key is still being processed" —
 * is raised with `retryAfter`, and `errorResponse` emits `Retry-After` only
 * when that is set. So the header, not the status, is what separates "your
 * first attempt is still running" from "your request was wrong".
 *
 * Getting this wrong is not cosmetic: treating the in-progress 409 as a
 * rejection and minting a new key lets the retry race the original create,
 * whose name check and write are separate operations.
 */
export function classifyFailure(response: FailedResponse): Exclude<AttemptOutcome, "no-response"> {
  if (response.status === 409 && response.headers.get("Retry-After")) return "in-progress";
  return "refused";
}

export const RETRY_AFTER_FALLBACK_MS = 2000;
/** However long the server asks for, the dialog will not sit there for minutes. */
export const RETRY_AFTER_MAX_MS = 10_000;

/** How long to wait before retrying, in milliseconds, from the `Retry-After` header. */
export function retryAfterMs(response: FailedResponse): number {
  const seconds = Number(response.headers.get("Retry-After"));
  // The API always sends delta-seconds. An HTTP-date, a missing header or
  // anything else non-numeric falls back rather than becoming NaN.
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_AFTER_FALLBACK_MS;
  return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
}

/**
 * Which key the next attempt should carry.
 *
 * `no-response` (the fetch itself threw — offline, DNS, connection reset) is
 * the case idempotency exists for: the create may well have happened, so the
 * same key goes out again and the API replays its original answer instead of
 * creating a second library.
 *
 * `in-progress` means the API is still running the *first* request under this
 * key. The key must be kept: a new one would start a second create that races
 * the first, and since the service checks the name and writes the record as
 * two separate steps, that race can produce two libraries with one name.
 *
 * `refused` is the only outcome that spends the key. The API answered and
 * nothing is in doubt — but `beginIdempotent` claims the key *before* running
 * the handler and only clears it by committing a success, so a rejected create
 * leaves that key parked for a day. Reusing it would answer every later
 * attempt with the in-progress 409 and the dialog would never recover.
 */
export function nextIdempotencyKey(current: string, outcome: AttemptOutcome): string {
  return outcome === "refused" ? newIdempotencyKey() : current;
}

type ErrorBody = {
  code?: string;
  message?: string;
  details?: { fields?: { path: string; issue: string }[] };
};

/**
 * Turns a v1 error body into one line for the dialog. Field issues win over
 * the summary message because they name the input to go fix.
 */
export function describeApiError(status: number, body: unknown): string {
  const error = (body ?? {}) as ErrorBody;

  const fields = error.details?.fields;
  if (Array.isArray(fields) && fields.length > 0) {
    return fields.map((field) => `${field.path}: ${field.issue}`).join("; ");
  }
  if (typeof error.message === "string" && error.message) return error.message;

  if (status === 403) return "Your account is not allowed to manage document libraries.";
  if (status === 404) return "That document library no longer exists.";
  if (status === 409) return "A connection with that name already exists in this company.";
  return "Something went wrong.";
}

/**
 * How to label `status` in the table. The API reports `"unknown"` for every
 * media connection today — there is no media connectivity check — so it is
 * shown as "Not checked" rather than anything a reader could mistake for a
 * successful probe.
 */
export function describeStatus(connection: MediaConnectionWire): { label: string; muted: boolean } {
  if (connection.status === "unknown") return { label: "Not checked", muted: true };
  return { label: connection.status, muted: connection.status !== "connected" };
}

/**
 * Whether to show the Document libraries tab at all. This is presentation
 * only — `requireDeveloperRole` on every media route is the actual boundary,
 * and it re-checks the role against the database on each request.
 */
export function canManageDocumentLibraries(role: string | null | undefined): boolean {
  return isDeveloperRole(role);
}
