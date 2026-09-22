/**
 * The Document libraries tab's form logic.
 *
 * This project has no DOM test runner and A5 was not allowed to add one, so
 * what is asserted here is the part of the tab that can be wrong silently:
 * which request body a form produces, which form is refused before it is sent,
 * what a failed request says out loud, and who is offered the tab at all. The
 * component around these functions is a thin shell over them.
 *
 * Two of these are security-shaped rather than cosmetic. `alias_id` and any
 * server address must never be something a Developer can type, and the tab
 * must never present itself as the thing keeping a non-Developer out.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESCRIPTION_MAX_CHARS,
  EMPTY_MEDIA_FORM,
  LIBRARY_REF_MAX_CHARS,
  NAME_MAX_CHARS,
  SERVER_REF_OPTIONS,
  RETRY_AFTER_FALLBACK_MS,
  RETRY_AFTER_MAX_MS,
  canManageDocumentLibraries,
  classifyFailure,
  createBody,
  createRequestInit,
  deleteRequestInit,
  describeApiError,
  describeStatus,
  formFromConnection,
  newIdempotencyKey,
  nextIdempotencyKey,
  patchRequestInit,
  retryAfterMs,
  updateBody,
  validateMediaForm,
  type MediaConnectionWire,
  type MediaFormState,
} from "@/components/database-mapping/media-connection-form";

function form(overrides: Partial<MediaFormState> = {}): MediaFormState {
  return { ...EMPTY_MEDIA_FORM, companyId: "cmp_1", name: "Sustainability reports", ...overrides };
}

function wire(overrides: Partial<MediaConnectionWire> = {}): MediaConnectionWire {
  return {
    id: "conn_media_1",
    object: "connection",
    kind: "media",
    name: "Sustainability reports",
    description: "Annual ESG filings",
    enabled: false,
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    media: { library_ref: "esg-2024", server_ref: "default" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("who sees the Document libraries tab", () => {
  it("offers it to a Developer only", () => {
    assert.equal(canManageDocumentLibraries("Developer"), true);
    for (const role of ["Admin", "User", "Viewer", "", null, undefined]) {
      assert.equal(canManageDocumentLibraries(role), false, `${role} must not be offered the tab`);
    }
  });
});

describe("creating a library", () => {
  it("starts switched off, and says so explicitly in the body", () => {
    assert.equal(EMPTY_MEDIA_FORM.enabled, false);
    // Not merely absent: the API's own default is `true`, so leaving `enabled`
    // out would create an enabled library before an operator has linked it.
    assert.equal(createBody(form()).enabled, false);
  });

  it("sends only the fields a Developer is allowed to choose", () => {
    const body = createBody(form({ description: "Annual ESG filings", libraryRef: "esg-2024" }));
    assert.deepEqual(body, {
      name: "Sustainability reports",
      description: "Annual ESG filings",
      library_ref: "esg-2024",
      server_ref: "default",
      enabled: false,
    });
    // The alias is the server's business; nothing in this form can name one.
    assert.equal("alias_id" in body, false);
    assert.equal(JSON.stringify(body).includes("alias"), false);
  });

  it("trims, and omits blank optional fields rather than sending empty strings", () => {
    const body = createBody(form({ name: "  Reports  ", description: "   ", libraryRef: "  " }));
    assert.equal(body.name, "Reports");
    assert.equal("description" in body, false);
    assert.equal("library_ref" in body, false);
  });

  it("offers only server names this deployment is configured for", () => {
    assert.deepEqual(Object.keys(SERVER_REF_OPTIONS), ["default"]);
    // A URL is not a choice the UI can express, so it cannot become one.
    assert.equal(validateMediaForm(form({ serverRef: "https://syslab.internal" })), "Pick a document server.");
  });
});

/**
 * The defect these cover shipped: the create request went out with no
 * `Idempotency-Key`, and the POST route is declared `idempotent: true`, so the
 * API rejected every single "Add library" with a 400 before the handler ran.
 * The body was correct and fully tested — nothing looked at the headers.
 */
describe("the headers each request actually carries", () => {
  it("sends an Idempotency-Key on create, because the API requires one", () => {
    const request = createRequestInit(form(), "key-abc");
    assert.equal(request.method, "POST");
    assert.equal(request.headers["Idempotency-Key"], "key-abc");
    assert.equal(request.headers["Content-Type"], "application/json");
  });

  it("carries a key that is actually present, not an empty string", () => {
    const key = newIdempotencyKey();
    assert.equal(typeof key, "string");
    assert.ok(key.length > 0);
    // The API refuses anything longer than 255 characters.
    assert.ok(key.length <= 255);
    assert.equal(createRequestInit(form(), key).headers["Idempotency-Key"], key);
  });

  it("mints a different key for each new submission", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    assert.equal(keys.size, 50);
  });

  it("still sends the same body it did before", () => {
    const request = createRequestInit(form({ description: "Annual ESG filings" }), "key-abc");
    assert.deepEqual(JSON.parse(request.body ?? "{}"), createBody(form({ description: "Annual ESG filings" })));
  });

  it("does not send an Idempotency-Key where the API does not ask for one", () => {
    // PATCH and DELETE are not declared idempotent on the media routes.
    const patch = patchRequestInit({ enabled: true });
    assert.equal(patch.method, "PATCH");
    assert.equal("Idempotency-Key" in patch.headers, false);
    assert.equal(patch.headers["Content-Type"], "application/json");

    const remove = deleteRequestInit();
    assert.equal(remove.method, "DELETE");
    assert.equal("Idempotency-Key" in remove.headers, false);
    // No body, so no content type to declare either.
    assert.equal(remove.body, undefined);
  });
});

describe("retrying a create", () => {
  it("reuses the key when no response came back, so a retry cannot double-create", () => {
    const key = newIdempotencyKey();
    assert.equal(nextIdempotencyKey(key, "no-response"), key);
    // And the retry really does go out with that same key.
    assert.equal(
      createRequestInit(form(), nextIdempotencyKey(key, "no-response")).headers["Idempotency-Key"],
      key
    );
  });

  it("spends the key once the server has refused, so the dialog can recover", () => {
    // beginIdempotent claims the key before running the handler and only
    // releases it by committing a success, so a refused create leaves that key
    // parked for 24h. Reusing it would 409 every later attempt.
    const key = newIdempotencyKey();
    const next = nextIdempotencyKey(key, "refused");
    assert.notEqual(next, key);
    assert.ok(next.length > 0);
  });

  it("keeps the key while the original request is still running", () => {
    const key = newIdempotencyKey();
    assert.equal(nextIdempotencyKey(key, "in-progress"), key);
  });
});

/**
 * The second review finding. `beginIdempotent` answers a still-running request
 * with 409 + `Retry-After`, and the UI was treating every error response as a
 * spent key. Minting a new key there sends a second create at a first one that
 * is still mid-flight, and because the service checks the name and writes the
 * record as separate steps, that race can produce two libraries with one name.
 *
 * The header is the discriminator: a duplicate-name 409 carries no Retry-After,
 * an in-progress 409 always does.
 */
describe("telling the two 409s apart", () => {
  function failure(status: number, headers: Record<string, string> = {}) {
    return { status, headers: { get: (name: string) => headers[name] ?? null } };
  }

  it("reads a still-processing 409 as in-progress, not as a rejection", () => {
    // What beginIdempotent actually sends: ApiError(resource_conflict, …,
    // { retryAfter: 2 }), which errorResponse renders as Retry-After: 2.
    const response = failure(409, { "Retry-After": "2" });
    assert.equal(classifyFailure(response), "in-progress");
  });

  it("keeps the key for that response, so the retry cannot race the original", () => {
    const key = newIdempotencyKey();
    const response = failure(409, { "Retry-After": "2" });
    const next = nextIdempotencyKey(key, classifyFailure(response));
    assert.equal(next, key);
    assert.equal(createRequestInit(form(), next).headers["Idempotency-Key"], key);
  });

  it("waits as long as the server asked", () => {
    assert.equal(retryAfterMs(failure(409, { "Retry-After": "2" })), 2000);
    assert.equal(retryAfterMs(failure(409, { "Retry-After": "5" })), 5000);
  });

  it("still treats a duplicate-name 409 as a rejection, because it has no Retry-After", () => {
    const response = failure(409);
    assert.equal(classifyFailure(response), "refused");
    const key = newIdempotencyKey();
    assert.notEqual(nextIdempotencyKey(key, classifyFailure(response)), key);
  });

  it("treats ordinary errors as rejections", () => {
    for (const status of [400, 403, 404, 422, 500]) {
      assert.equal(classifyFailure(failure(status)), "refused", `${status}`);
    }
    // A 400 would not carry Retry-After, but the status must not alone decide.
    assert.equal(classifyFailure(failure(400, { "Retry-After": "2" })), "refused");
  });

  it("falls back rather than producing NaN from an unusable Retry-After", () => {
    assert.equal(retryAfterMs(failure(409)), RETRY_AFTER_FALLBACK_MS);
    // The API only ever sends delta-seconds, but the header also permits a date.
    assert.equal(retryAfterMs(failure(409, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" })), RETRY_AFTER_FALLBACK_MS);
    assert.equal(retryAfterMs(failure(409, { "Retry-After": "0" })), RETRY_AFTER_FALLBACK_MS);
    assert.equal(retryAfterMs(failure(409, { "Retry-After": "-5" })), RETRY_AFTER_FALLBACK_MS);
  });

  it("does not leave the dialog waiting for minutes on an absurd Retry-After", () => {
    assert.equal(retryAfterMs(failure(409, { "Retry-After": "3600" })), RETRY_AFTER_MAX_MS);
  });
});

describe("form validation, mirroring the service", () => {
  it("passes a filled-in form", () => {
    assert.equal(validateMediaForm(form(), { requireCompany: true }), null);
  });

  it("asks for a company only where one has to be chosen", () => {
    const noCompany = form({ companyId: "" });
    assert.equal(validateMediaForm(noCompany, { requireCompany: true }), "Pick a company.");
    // The edit dialog acts on an already-selected company, so it does not ask.
    assert.equal(validateMediaForm(noCompany), null);
  });

  it("requires a non-blank name", () => {
    assert.equal(validateMediaForm(form({ name: "   " })), "Name is required.");
  });

  it("holds each field to the service's own limit", () => {
    assert.equal(validateMediaForm(form({ name: "x".repeat(NAME_MAX_CHARS) })), null);
    assert.match(validateMediaForm(form({ name: "x".repeat(NAME_MAX_CHARS + 1) })) ?? "", /at most 120/);

    assert.equal(validateMediaForm(form({ description: "x".repeat(DESCRIPTION_MAX_CHARS) })), null);
    assert.match(
      validateMediaForm(form({ description: "x".repeat(DESCRIPTION_MAX_CHARS + 1) })) ?? "",
      /at most 2000/
    );

    assert.equal(validateMediaForm(form({ libraryRef: "a".repeat(LIBRARY_REF_MAX_CHARS) })), null);
    assert.match(
      validateMediaForm(form({ libraryRef: "a".repeat(LIBRARY_REF_MAX_CHARS + 1) })) ?? "",
      /at most 200/
    );
  });

  it("rejects a library reference outside the allowed charset", () => {
    assert.equal(validateMediaForm(form({ libraryRef: "esg-2024/reports_v2:final" })), null);
    for (const bad of ["esg@2024", "esg#1", "esg?x=1", "<script>"]) {
      assert.match(validateMediaForm(form({ libraryRef: bad })) ?? "", /may only contain/, bad);
    }
  });
});

describe("editing a library", () => {
  it("loads the saved values, and never a server-side identifier", () => {
    const loaded = formFromConnection(wire(), "cmp_1");
    assert.deepEqual(loaded, {
      companyId: "cmp_1",
      name: "Sustainability reports",
      description: "Annual ESG filings",
      libraryRef: "esg-2024",
      serverRef: "default",
      enabled: false,
    });
  });

  it("never sends the server or the alias, which are fixed at creation", () => {
    const body = updateBody(formFromConnection(wire(), "cmp_1"));
    assert.equal("server_ref" in body, false);
    assert.equal("alias_id" in body, false);
  });

  it("omits a field the Developer blanked, because the API cannot clear it", () => {
    // Sending `description: ""` would reach the service as "unchanged"
    // anyway. Omitting it keeps the request honest about what it does: the
    // saved value stays, and the dialog says so next to the field.
    const kept = updateBody(formFromConnection(wire(), "cmp_1"));
    assert.equal(kept.description, "Annual ESG filings");
    assert.equal(kept.library_ref, "esg-2024");

    const cleared = updateBody({ ...formFromConnection(wire(), "cmp_1"), description: "", libraryRef: "" });
    assert.equal("description" in cleared, false);
    assert.equal("library_ref" in cleared, false);
  });

  it("carries the switch through", () => {
    assert.equal(updateBody(formFromConnection(wire({ enabled: true }), "cmp_1")).enabled, true);
    assert.equal(updateBody(formFromConnection(wire({ enabled: false }), "cmp_1")).enabled, false);
  });
});

describe("what a failed request says", () => {
  it("names the field the API objected to", () => {
    const message = describeApiError(400, {
      code: "invalid_request",
      message: "Invalid request.",
      details: { fields: [{ path: "library_ref", issue: "contains a character outside the allowed safety charset" }] },
    });
    assert.match(message, /library_ref/);
    assert.match(message, /outside the allowed safety charset/);
  });

  it("passes a name conflict through as the API worded it", () => {
    const message = describeApiError(409, {
      code: "resource_conflict",
      message: "A connection named 'Reports' already exists in this workspace.",
    });
    assert.match(message, /already exists/);
  });

  it("explains a refusal without inventing a reason", () => {
    assert.equal(
      describeApiError(403, null),
      "Your account is not allowed to manage document libraries."
    );
    assert.equal(describeApiError(404, null), "That document library no longer exists.");
    assert.equal(describeApiError(500, null), "Something went wrong.");
  });

  it("shows nothing of the transport when the body is not an error envelope", () => {
    const message = describeApiError(502, "<html>Bad Gateway</html>");
    assert.equal(message, "Something went wrong.");
  });
});

describe("status", () => {
  it("does not let 'unknown' read as a successful check", () => {
    const status = describeStatus(wire({ status: "unknown" }));
    assert.equal(status.label, "Not checked");
    assert.equal(status.muted, true);
    assert.equal(status.label.toLowerCase().includes("connected"), false);
  });

  it("reports a real status as given", () => {
    assert.deepEqual(describeStatus(wire({ status: "connected" })), { label: "connected", muted: false });
    assert.deepEqual(describeStatus(wire({ status: "error" })), { label: "error", muted: true });
  });
});
