# A4 Implementation Report

## 1. Objective

Implement the service/route integration layer for media connections: let an
authenticated, authorized caller create, list, update (including
enable/disable), and delete a media connection through the application's real
API boundary — reusing the authorization, retrieval and provenance machinery
A2/A2b already built, not re-implementing or redesigning any of it. A4 does
not touch semantic routing, tool selection, prompt wording, or any other part
of the A3 follow-up, and does not deploy anything.

## 2. Starting Repository State

Branch `media-connections`, HEAD `46ee7ff` (A2b, "Keep a ledger of what a run
really retrieved..."), unchanged throughout this work. `git status` at the
start showed only the pre-existing A3 working-tree state (uncommitted
`evals/`, `tests/`, `.gitignore` changes from the prior session) — nothing
from A4 was present yet.

Confirmed before writing any code, by direct inspection:

- **`MediaConnectionDoc`** already existed in `lib/services/connections.ts`
  (added in A1/A2), with `isMediaConnection`, `listMediaConnections`, and the
  database-side guards (`isDatabaseConnection`, `assertDatabaseConnection`)
  that keep it invisible to every SQL path.
- **No write path existed for it anywhere.** `createMediaConnection`,
  `updateMediaConnection`, `deleteMediaConnection` did not exist in the
  repository outside of test/eval fixtures writing directly into the
  in-memory store (`stores().documents.put(...)`).
- **`resolveSources` (`lib/services/sources.ts`) was already wired into the
  real chat path** — `lib/services/runs.ts:167` calls it, and
  `app/api/v1/conversations/[conversation_id]/runs/route.ts` (the route the
  live chat UI calls) drives it. This was the single biggest finding of the
  pre-implementation survey: A4 did not need to wire `search_documents` into
  production at all — that already worked, gated correctly by
  `MEDIA_CONNECTIONS_ENABLED`, for any `MediaConnectionDoc` that existed. The
  actual gap was narrower and entirely upstream: nothing could put such a
  record into the store outside of a test.
- The deprecated `POST /api/chat` route does **not** pass `libraries` to
  `runAgent` and is not called by any current frontend code (grep-confirmed);
  it is dead, not a second production path, and was left untouched.
- The Database Mapping admin page is 100% PostgreSQL-only today (by A1's
  deliberate design) and was not touched — A5's job.
- No CRUD tests existed for the *existing* database connection routes either
  (`app/api/companies/[id]/connections/*`), because those routes depend on a
  real NextAuth session and Prisma with no injection seam — verified only via
  Docker smoke in A1, not by `npm test`. This shaped the design decision in
  §6 below.

## 3. A4 Scope Implemented

- Service-layer CRUD for media connections in `lib/services/connections.ts`:
  `createMediaConnection`, `updateMediaConnection`, `deleteMediaConnection`,
  `findMediaConnection`, `requireMediaConnection`, `serializeMediaConnection`,
  plus a cross-kind, case-insensitive name-uniqueness check and a
  `library_ref` safety-charset validator.
- Five new v1 API routes exposing that CRUD:
  `GET`/`POST /api/v1/companies/{company_id}/media-connections` and
  `GET`/`PATCH`/`DELETE /api/v1/companies/{company_id}/media-connections/{connection_id}`.
- Developer-only, cross-company authorization on every one of those routes,
  reusing the existing `requireDeveloperRole` gate (see §6).
- Audit logging on create/update/delete (`media_connection.created/updated/deleted`).
- OpenAPI documentation for all five endpoints in `openapi/v1.yaml`, verified
  against `scripts/check-api-compat.mjs` (additive only, zero breaking
  changes, every documented path has a route file).
- Test coverage for the service layer, the resolveSources integration, and
  the routes' authorization gate (29 new tests, all passing).

**Explicitly not done** (see §15 and §16): semantic routing changes, a
connectivity "test" action for media connections (the DB family's equivalent
of `POST .../test`), UI (A5), enabling the feature flag anywhere, deployment,
or live verification against a running syslab-server through the new routes.

## 4. Files Changed

Modified:
- `lib/services/connections.ts` (+212 lines) — the new CRUD functions.
- `lib/services/media-server.ts` (+8) — `SUPPORTED_MEDIA_SERVER_REFS`.
- `lib/services/audit.ts` (+3) — three new `AuditAction` members.
- `openapi/v1.yaml` (+210) — the new paths, schemas, and a "Media
  connections" tag.
- `tests/sources.test.ts` (+9/-3) — added the new route file to the
  `listMediaConnections`-callers tripwire's allowlist (see §6).

Created:
- `app/api/v1/companies/[company_id]/media-connections/route.ts`
- `app/api/v1/companies/[company_id]/media-connections/[connection_id]/route.ts`
- `tests/media-connections-routes.test.ts` (29 tests)
- `evals/results/a4-implementation-report.md` (this file)

Nothing under `lib/agent/`, `lib/services/sources.ts`, `lib/services/document-search.ts`,
`lib/services/media-flag.ts`, any `evals/` file, any `tests/media-connections-floor.test.ts`
tripwire other than the one in §6, or any prompt/routing/fixture/grader file was
touched. The five pre-existing uncommitted files from the A3 session
(`.gitignore`, `evals/README.md`, `evals/cases/index.ts`, `evals/grade.ts`,
`evals/harness.ts`, `evals/run.ts`, `evals/types.ts`, `tests/helpers/render-answer.ts`)
are unchanged by this work — `git diff --stat HEAD` shows exactly the files
listed above plus that untouched pre-existing set.

## 5. Architecture / Data Flow

```
Developer (signed-in session, no API key)
  -> POST /api/v1/companies/{company_id}/media-connections
       requireDeveloperRole(principal)      [lib/api/require-developer.ts, unmodified]
       requireCompany(company_id)           [new, Prisma existence check]
       v.validate(body, CREATE)             [lib/api/validate.ts, unmodified]
       createMediaConnection(company_id, input)   [new]
         -> validates name/server_ref/library_ref
         -> writes a MediaConnectionDoc, media.alias_id = the new connection's own id
         -> stores().documents.put("connections", company_id, doc)
       recordAuditEvent(media_connection.created)  [unmodified function, new action]

... later, in a real chat run (already-existing A2 path, untouched) ...

runs.ts -> resolveSources({tenantId, userId})   [lib/services/sources.ts, unmodified]
  -> resolveLibraries: if MEDIA_CONNECTIONS_ENABLED, listMediaConnections(tenantId)
     filtered by isMediaConnectionActive, each mapped through searchFor(connection)
  -> runAgent(..., libraries)
     -> model may call search_documents -> resolveLibrary -> library.search(query)
        -> document-search.ts's closure -> RetrievalClient.retrieve() -> syslab-server
```

A4 added everything above the blank line. Everything below it is A2/A2b,
unchanged, and was already reachable from the real chat route before this
work — A4 only made it possible to get a real `MediaConnectionDoc` into the
store other than by hand.

## 6. Authentication and Authorization

**Design decision, and why.** Two existing patterns could have hosted this:
the session-based admin console family (`app/api/companies/[id]/connections/*`,
gated by `requireAdminSession` — Admin *or* Developer) and the Bearer-key v1
API (gated by `Principal`/scopes). Neither fit directly:

- The plan requires media connection CRUD to be **Developer-only**, which is
  *stricter* than `requireAdminSession` (Admin+Developer). The admin console
  family also has no automated test coverage at all today (§2) — `auth()`
  has no injection seam, so its role gate cannot be exercised by `npm test`,
  only by Docker/manual smoke.
- The plain v1 API's `Principal.tenantId` is singular and derived from the
  caller's own session — it cannot express "a Developer acting on a
  *different* company," which media connection management requires.

The existing precedent that already solves exactly this — Developer-only,
cross-company, and fully unit-testable — is **AI Feedback**
(`app/api/v1/ai-feedback/*`), which uses `defineRoute` + the already-built,
already-tested `requireDeveloperRole(principal)`
(`lib/api/require-developer.ts`, **not modified**). That function
unconditionally rejects any Bearer API key (`apiKeyId !== null`) regardless
of role, and requires the caller's real database role to be exactly
`"Developer"` — reusing it rather than inventing a parallel "who is a
Developer" check was the direct application of A4's own stated principle
("preserve the application/source resolver... do not create competing
implementations") to the authorization layer.

Cross-company targeting is done the same way the *existing* admin-console
family already does it for database connections: an explicit `company_id`
path segment, not `principal.tenantId`. Every handler checks
`requireDeveloperRole` **before** `requireCompany` (a Prisma existence
check), so an unauthorized caller never learns whether a `company_id` is
real — the same discipline `notFound()`'s own docstring already states for
this codebase.

Scopes (`connections:read`/`connections:write`) are reused rather than
inventing `media_connections:*` scopes: since `requireDeveloperRole` already
excludes every API key and a Developer's session principal always carries
every scope (`ROLE_SCOPES.admin`), the scope check is a second, defense-in-depth
layer only — a Bearer key lacking `connections:write` is rejected at the
scope layer before `requireDeveloperRole` even runs (verified by test, §12).

**Verified:** every route rejects a Bearer API key of any role with
`403 insufficient_role` (never reaching the tenant/service layer — confirmed
by asserting the record was not created/modified). A low-scope key is
rejected earlier still, at `403 insufficient_scope`.

**Not verified:** the "a real signed-in Developer succeeds" path. This is not
a gap A4 introduced — it is the same, pre-existing limitation AI Feedback's
own Developer-only routes have (confirmed by reading `tests/ai-feedback.test.ts`,
which tests `requireDeveloperRole` as a bare function, never through a full
HTTP request with a real session). Reaching it requires a live NextAuth
session and a real Prisma-backed user with role `Developer`; `auth()` calls
`next/headers` internals that only exist inside Next's own request-handling
runtime, not when a route handler is invoked directly from `node:test` — the
same reason every existing v1 route test in this repository always supplies
a Bearer token and never exercises the credential-less path. This is a
property of the test environment, not of the code, and applies equally to
every Developer-only route in the app, old and new.

## 7. Connection and Source Resolution

No competing resolver was created. `resolveSources` (`lib/services/sources.ts`)
is untouched. The new routes write through the same `connections` collection
`resolveSources` already reads via `listMediaConnections` — a media
connection created through the new `POST` route is picked up by
`resolveSources` with no further wiring, confirmed by test (§12).

`alias_id` is set by the server to the new connection's own generated id and
is **never accepted from a request body** — this matches the approved plan
decision ("key = the connection's own id... each company has its own key")
and is enforced structurally: `CreateMediaConnectionInput` has no `alias_id`
field at all, so there is no code path by which a caller's value could reach
it. `serializeMediaConnection` also excludes `media.alias_id` from every
response (verified by test).

`library_ref` remains exactly what the plan specifies: a Developer-typed,
opaque note. It is validated against a loose safety charset
(`[A-Za-z0-9 ._-:/]`, ≤200 chars) at write time — this charset did not exist
before A4 (nothing previously wrote this field outside test fixtures) and is
new, additive validation, not a change to how the field is read: routing,
auth and the prompt still never look at it (unchanged, `lib/services/sources.ts`
and `lib/agent/libraries.ts` untouched).

`server_ref` must be one of `SUPPORTED_MEDIA_SERVER_REFS` (`["default"]`
today, in `lib/services/media-server.ts`, the file that already owned this
concept via `resolveMediaServer`) — rejecting an unresolvable reference at
creation time rather than letting it silently fail every search later.

Name uniqueness (case-insensitive, across both database and media
connections in a tenant — the approved plan decision) is enforced in
`createMediaConnection`/`updateMediaConnection`. It is **not** retrofitted
into the existing `createConnection`/`updateConnection` (database) — see
§16, this is a deliberate, documented scope boundary, not an oversight.

## 8. Retrieval Integration

Untouched. No change to `lib/services/document-search.ts`,
`lib/services/media-server.ts`'s `resolveMediaServer`, `lib/services/retrieval-client.ts`,
or the `/api/v1/retrieve` contract. A4 only added a way to create the
`MediaConnectionDoc` record that chain already knew how to consume. No
embeddings, chunking, ranking, or RRF logic was added anywhere in
database-agent, and syslab-server itself was not touched.

## 9. Error Handling

Route-level validation errors (`v.validate`) produce `400 validation_failed`
with a field-level `details.fields` array, matching every other v1 route.
Service-layer validation (empty name, unsupported `server_ref`, malformed
`library_ref`, name collision) throws `ApiError` directly with the same
`details.fields` shape, so a caller sees one consistent error format whether
the problem was caught by the generic body validator or the media-specific
business rule. An unknown `company_id` or `connection_id` is `404 not_found`,
worded indistinguishably from "not yours," consistent with `notFound()`'s
existing contract. A name collision is `409 resource_conflict`.

No new sanitized-error *category* was needed: these are all synchronous
validation/authorization failures in the application, not retrieval failures
— the existing `DocumentSearchCategory` (`not_configured`/`not_linked`/`auth`/
`unavailable`/`timeout`) governs failures *inside* a search call, which A4
does not touch (§8). One real gap the survey surfaced but which is out of
A4's scope: there is no sanitized-category *union* for database connection
errors the way there is for media ones — database errors map directly onto
the generic `ErrorCode` space via `translateConnectorError`. This predates
A4 and was not changed.

## 10. Audit Logging

Three new `AuditAction` values: `media_connection.created`, `.updated`,
`.deleted`, added to the existing `AuditAction` union in
`lib/services/audit.ts` (the function itself, `recordAuditEvent`, is
unmodified). Called from all three mutating routes, with `actor: { id: principal.userId }`
(the caller's user id; a v1 `Principal` has no email field, unlike a NextAuth
session, so unlike the admin-console family's audit calls this omits
`actor.email` — `recordAuditEvent` treats it as optional). Metadata is
deliberately minimal: `{ name, enabled, library_ref }` — never `alias_id`,
never anything from `server_ref`'s resolved configuration (there is none to
log; `server_ref` itself is just the literal string `"default"`, not a
secret).

`DELETE` is idempotent (204 even for an absent connection, matching
`/v1/connections/{connection_id}`), so its audit call reads the record
*before* deleting and only logs if something was actually found — an
idempotent replay of a delete that already happened does not produce a
duplicate audit entry with a real target.

One pre-existing bug was found and **deliberately not fixed**, to keep this
change additive: `app/api/companies/[id]/connections/[connectionId]/route.ts`'s
`PATCH` logs `action: "connection.created"` instead of `"connection.updated"`
(there is no `"connection.updated"` value in `AuditAction` at all today). The
new `media_connection.updated` route was written correctly from the start
rather than copying that bug; fixing the existing one is flagged in §16 as a
follow-up, since touching that file was not otherwise part of A4's scope.

## 11. PostgreSQL Regression Assessment

No file under `lib/connectors/`, `lib/services/queries.ts`,
`app/api/companies/[id]/connections/*`, `app/api/v1/connections/*`, or any
`ConnectionDoc`-handling code path was changed. `isDatabaseConnection`,
`assertDatabaseConnection`, `listConnections`, `findConnection`,
`requireConnection`, `createConnection`, `updateConnection`, `deleteConnection`,
`readCredentials`, `connectorOptions`, `testConnection`, and `getSchema` are
all byte-for-byte unchanged in `lib/services/connections.ts` — the diff to
that file is a pure insertion of new, separate functions between existing
ones (verified by reading the diff, not just assuming it from the edit
description).

The full existing test suite (973 tests, including every PostgreSQL-path
test) was run unmodified except for the one tripwire allowlist addition in
§6, and passes: **968 pass, 5 skipped (live, pre-existing), 0 fail.** No
PostgreSQL-path test needed to change.

## 12. Test Results

```
npm test
  973 tests, 968 pass, 0 fail, 5 skipped (live, unrelated to A4)

npx tsc --noEmit -p .
  clean, 0 errors

npx eslint <every file A4 touched>
  clean, 0 problems

npx eslint .  (whole project)
  17 pre-existing problems (7 errors, 10 warnings), all in files A4 never
  touched (React UI components, evals/ scripts, other pre-existing test
  files carried over from the A3 session) — 0 new problems.

npm run api:check
  "No breaking changes. Every documented endpoint has a route handler."
  The 5 new media-connections endpoints show as additive ("endpoint was
  added"), alongside pre-existing un-baselined additive diffs from
  model-providers/keys/ai-feedback that predate A4 and were not touched.

npm run build
  Compiled successfully; both new routes appear in the route manifest as
  dynamic (ƒ) endpoints, matching every other v1 API route.
```

New test file `tests/media-connections-routes.test.ts` (29 tests): CRUD
correctness and validation (`createMediaConnection`/`updateMediaConnection`/
`deleteMediaConnection`/`findMediaConnection`/`requireMediaConnection`) —
alias_id assignment, name trimming, cross-kind case-insensitive uniqueness
(including tenant isolation — the same name is allowed in a different
tenant), `server_ref`/`library_ref` validation, enable/disable, explicit
description clearing, deletion idempotency and collection-kind safety
(deleting a media connection never touches a database connection sharing the
same collection); `serializeMediaConnection` excluding `alias_id`; an
integration group proving a connection created through `createMediaConnection`
is (and, once disabled or deleted, is not) picked up by the real, unmodified
`resolveSources`; and a route-authorization group proving every one of the
five new endpoints rejects a Bearer API key regardless of role, with the
target record provably untouched afterward.

## 13. Live Verification

**Not performed**, and explicitly out of scope for this pass. Exercising the
new routes against a real signed-in Developer session requires the same
Docker/manual-smoke setup A1 used to verify the admin console's session-gated
routes (a running app, real Postgres, a real NextAuth login) — this was not
run in this session. No live call was made to syslab-server through the new
routes either; the retrieval path itself was already live-verified in A2/A2b/A3
and is unchanged. `MEDIA_CONNECTIONS_ENABLED` was not set anywhere and no
`.env` file was touched.

## 14. Security / Secret Review

- `media.alias_id` is never accepted as input and never appears in any
  response (`serializeMediaConnection` omits it; verified by test).
- No `server_ref` resolution (URL/token) happens anywhere in this change —
  A4 never calls `resolveMediaServer` or `RetrievalClient`. Those stay
  exactly as A2 built them.
- Audit metadata contains only `name`, `enabled`, `library_ref` — never
  `alias_id`, never anything server/credential-related.
- Grepped the diff for anything resembling a token, URL, or credential:
  none found. No `.env*` file was modified.
- `requireDeveloperRole` closes the one path a model or a lower-privileged
  caller could otherwise use to enumerate or create connections in another
  company's workspace: every route checks it first, before any
  company-existence or tenant-scoped lookup runs.

## 15. Deferred A3 Routing Follow-Up

Not touched, as instructed. No file under `lib/agent/prompt.ts`,
`lib/agent/index.ts`, `lib/agent/libraries.ts`, or any routing/tool-selection
logic was read for editing purposes in this task, let alone changed. The
open question from A3's Final Acceptance Review (why the model sometimes
answers a document question with no tool call) remains exactly where it was
left — this phase did not depend on it and did not attempt to narrow it.

## 16. Known Limitations

- **Database-side name uniqueness is not symmetric.** `createMediaConnection`/
  `updateMediaConnection` check the new name against *every* existing
  connection, database or media. `createConnection`/`updateConnection`
  (database, unmodified) do not check against media names. A database
  connection created *after* a media connection with the same name will
  still collide with it silently. Closing this required touching
  `app/api/companies/[id]/connections/route.ts` and `createConnection`
  itself, which was not otherwise part of A4's scope; flagged here as a
  concrete, scoped follow-up rather than fixed opportunistically.
- **Clearing `description`/`library_ref` via the API is not wired**, even
  though the service functions support it (passing `null` explicitly). The
  route's body validator (`lib/api/validate.ts`'s `v.optional`) treats a
  JSON `null` the same as an omitted field, matching this codebase's
  existing convention everywhere else (e.g. `ConnectionUpdate.default_schema`
  has the same limitation) — not a regression A4 introduced, just not
  extended past it.
- **No connectivity "test" action** for a media connection, unlike the
  database family's `POST .../test`. `RetrievalClient` only exposes
  `retrieve()` (no dedicated health endpoint), so a "test" would have to
  issue a real probe query through the search path — feasible without any
  syslab-server change, but was left out to keep this phase's new
  network-touching surface at zero pending a decision on whether it's wanted
  before A5's UI needs it.
- **The pre-existing `"connection.created"`-on-update audit bug** in the
  database connections route (§10) was found but not fixed, to keep this
  change strictly additive to files A4 did not otherwise need to touch.
- **No `GET` pagination parameters** on the list route
  (`/v1/companies/{company_id}/media-connections`) — it mirrors
  `listMediaConnections`'s own un-paginated, full-scan design (bounded at
  1000 records, same as `resolveSources` relies on already) rather than
  promising cursor support it cannot deliver.
- Live/Docker verification (§13) was not performed in this pass.

## 17. A4 Acceptance Assessment

**Implemented:** media connection CRUD (create/list/get/update-including-enable-disable/delete)
behind Developer-only, cross-company authorization; audit logging on every
mutation; OpenAPI documentation; validation of `name`/`server_ref`/`library_ref`
with cross-kind name uniqueness; secrets (`alias_id`) kept server-side.

**Verified:** full existing test suite green (968/973, 5 pre-existing live
skips, 0 fail); the 29 new tests green; `tsc`, `eslint` (zero new problems),
`npm run build`, and `npm run api:check` (zero breaking changes) all clean;
service-layer correctness including tenant isolation and collection-kind
safety; the authorization gate rejecting every API key regardless of role or
scope, with the underlying record provably untouched; a created connection's
visibility to the real, unmodified `resolveSources` (and its disappearance on
disable/delete); PostgreSQL connection code path byte-for-byte unchanged.

**Not verified:** a real Developer session succeeding through the full HTTP
route (a pre-existing test-environment limitation shared with AI Feedback,
not something this phase could close); anything requiring a live syslab-server
call through the new routes; Docker/manual smoke of the deployed routes.

**Deferred:** the A3 routing follow-up (untouched, as instructed); a
connectivity-test action for media connections; symmetric database-side name
uniqueness; explicit-clear support for `description`/`library_ref` via the
API; the pre-existing audit-action bug on database connection updates. None
of these block A4 or A5; all are named explicitly above rather than left
implicit.

No production code outside `lib/services/connections.ts`, `lib/services/media-server.ts`,
`lib/services/audit.ts`, `openapi/v1.yaml`, and the two new route files was
changed. `MEDIA_CONNECTIONS_ENABLED` remains unset/off; no deployment,
merge, or push occurred; HEAD constraints and the no-secrets/no-generated-junk
review in the commit-discipline checklist were followed before any commit.
