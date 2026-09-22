# A5 — Document libraries UI: implementation report

Uncommitted, local only. Nothing pushed, merged, deployed, restarted or
reconfigured. Prepared for independent review by Codex.

> **Revision 2 — Codex review fix.** Codex found a blocking defect: the create
> request omitted `Idempotency-Key`, which the `idempotent: true` POST route
> requires, so **every "Add library" failed with HTTP 400**. Fixed; see §8.
>
> **Revision 3 — second Codex review fix.** The revision-2 retry rule was too
> coarse: it spent the key on *every* error response, including the API's
> "still being processed" 409, so a retry could race the original create. Fixed;
> see §9. The §4 verification table reflects the final code.

## 1. Starting repository state

`database-agent`, branch `media-connections`, HEAD
`7d9065c4c6a9163d2906da5415e01fac07a389fd` ("Add Developer-only service/route
integration for media connections (A4)"), above `46ee7ff` (A2b), `b551b60`
(A2), `6a6641e` (A1). This matches the expected state in the brief.

The working tree already carried the A3 evaluation work, uncommitted:

- 8 modified tracked files — `.gitignore`, `evals/README.md`,
  `evals/cases/index.ts`, `evals/grade.ts`, `evals/harness.ts`,
  `evals/run.ts`, `evals/types.ts`, `tests/helpers/render-answer.ts`
- 33 untracked paths — `evals/analysis/`, nine `evals/cases/media-*.eval.ts`,
  the `evals/*.ts` analysis tooling, five `evals/results/a3-*.md`, and six
  `tests/evals-*.test.ts` / `tests/agent-vouched-scoping.test.ts`

All of it is preserved unchanged; see §7. One detail from it shaped this work:
the uncommitted `.gitignore` change adds `/docs/agent/` under a `# plans`
heading, so that directory is deliberately untracked. Documentation was
therefore placed under `docs/ui/`, not `docs/agent/`, or it would have been
invisible to review and never committable.

`syslab-server` is at `master` `d34c0a9` with one unrelated local modification
(`docs/usage.md`). **Not touched** — no file in that repository was read into a
change, edited, or run.

## 2. Files changed

| File | Status | What it does |
| --- | --- | --- |
| `components/database-mapping/media-connection-form.ts` | new | Pure form logic: field limits mirroring the service, `createBody`/`updateBody`, `validateMediaForm`, `describeApiError`, `describeStatus`, `canManageDocumentLibraries`. No React, no JSX — this is the part the tests drive. |
| `components/database-mapping/DocumentLibrariesSection.tsx` | new | The tab itself: company picker, list, create/edit/enable-disable/remove dialogs, loading / empty / error+retry / saving / deleting states. |
| `components/database-mapping/DatabaseMappingPage.tsx` | modified | Wraps the existing page body in `Tabs` (**Databases** / **Document libraries**) and gates the second tab on the session role. +67 / −33; every database handler, column and dialog is byte-identical, only the JSX wrapper moved. |
| `tests/media-connections-ui.test.ts` | new | 20 tests over the logic module. |
| `docs/ui/document-libraries.md` | new | Operator/Developer documentation and the Project A limitations. |

No API route, service, schema, prompt, agent, retrieval or OpenAPI file was
touched. `openapi/v1.yaml` is unchanged because A5 adds no endpoint.

## 3. A5 behavior delivered

**Role.** The tab renders only for a `Developer` (`canManageDocumentLibraries`,
which is `isDeveloperRole`). `/database-mapping` is admin-gated, so an Admin can
open the page and sees only **Databases**. This is presentation: every request
goes to a route guarded by `requireDeveloperRole`, which re-reads the role from
Postgres and rejects API keys outright. The UI never decides authorization.

**Company.** A Developer picks a company at the top of the tab; the list, and
every mutation, is scoped to `/api/v1/companies/{company_id}/media-connections`
with the company as a server-authorized path segment. The company list comes
from the existing `/api/companies`, which already returns all companies for a
Developer and only the caller's own company for anyone else.

**Create.** Company, required name, optional description, optional
`library_ref`, `server_ref` limited to the configured `default`, and **enabled
defaulting to false** — sent explicitly as `enabled: false` rather than left to
the API's own `true` default, so a library is never advertised before an
operator has provisioned and linked it. The dialog says that provisioning step
is separate and still pending.

**Edit.** Name, description, `library_ref`, enabled. No server, no alias —
neither is sent in the PATCH body at all.

**Enable/disable.** A switch in the row, sending only `{enabled}`.

**Remove.** Confirmation dialog stating the agent loses the library immediately
and that retiring it on the document server is a separate operator task.

**Flag.** Not represented as a live/not-live indicator, because the browser has
no safe way to read `MEDIA_CONNECTIONS_ENABLED` and the brief said not to add an
endpoint for it without first arguing the need. The wording therefore makes no
claim about deployment availability: `enabled` is described as "Offer to the
agent", with a note that on its own it does not mean search is running. The
consequence — a Developer can switch a library on and see nothing change in
chat, with no in-product explanation — is recorded in §6 and in the docs.

**Status.** `"unknown"` is rendered as **Not checked**, never as anything that
could read as a successful probe, since no media connectivity check exists.

**Separation from SQL.** No Test, Refresh Tables, Assign, credentials, host,
port, engine, or column controls appear on media rows. The database tab keeps
all of them and is otherwise untouched.

## 4. Verification

All commands run from the `database-agent` checkout at the state described in
§7.

| # | Command | Kind | Outcome |
| --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | automated | **Pass** — no output. |
| 2 | `npx tsx --test tests/media-connections-ui.test.ts` | automated | **Pass** — 35/35. |
| 3 | `npm test` | automated | **Pass** — 1008 tests, 1003 pass, **0 fail**, 5 skipped. Exactly +35 over A4's 973/968/5; the 5 skips are the pre-existing live-integration tests, unchanged. |
| 4 | `npx eslint` on the three new files | automated | **Pass** — "No issues found". |
| 5 | `npx eslint components/database-mapping/ tests/media-connections-ui.test.ts` | automated | **1 error**, pre-existing — see below. |
| 6 | `npx eslint .` | automated | 7 errors, 10 warnings. |
| 7 | `npm run build` | automated | **Pass** — exit 0, `/database-mapping` still prerendered. |
| 8 | `npm run api:check` | automated | **Pass** — "No breaking changes. Every documented endpoint has a route handler." |
| 9 | Signed-in Developer / unauthorized-role HTTP+UI check | **not performed** | See below. |

**On the one lint error (#5, #6).** It is
`react-hooks/set-state-in-effect` on `DatabaseMappingPage.tsx` line 182,
`useEffect(() => { load(); }, [load])` — pre-existing code A5 did not modify.
Proven by linting the committed file in isolation: at HEAD it reports the same
error at line 172, and my insertions moved it to 182. The same rule already
fires in `UsersPage.tsx` and `AiFeedbackListPage.tsx`; it is the house
fetch-on-mount pattern throughout this codebase.

The accounting is exact:

- HEAD with the A3 working tree stashed: **7 errors, 5 warnings**
- Now, A5 + A3 present: **7 errors, 10 warnings**
- The A3 untracked work linted alone: **0 errors, 5 warnings**

So A5 contributes **0 new errors and 0 new warnings**. The new section
deliberately avoids adding an eighth instance of that rule by deriving
`loading` during render from a request key instead of setting it in the effect
body.

**On #9, not performed.** The Docker daemon is not running on this machine, and
the only configured local environment (`.env.local`) is shared deployment
configuration. Exercising create / edit / delete against it would modify real
data, which the brief forbids, and starting `next dev` also rewrites
`AGENTS.md` into the working tree. I did not start Docker, start a server,
alter configuration, or run a request against a live deployment. **No claim is
made that the tab has been exercised in a browser.** What is verified is the
type-level wiring, the production build, and the logic the component delegates
to. A reviewer with a local stack should confirm, at minimum: the tab is absent
for an Admin, present for a Developer; a create lands disabled; and a direct
`curl` to the collection route as a non-Developer session returns 403.

## 5. Security and regression review

- **No secret, URL or credential** reaches the new code. A scan of both new
  components and the doc for `alias_id`, `RETRIEVAL_TOKEN`, `RETRIEVAL_BASE_URL`,
  bearer/authorization, tenant id, password and `http(s)://` returns only a
  local React state variable named `reloadToken` and prose in the
  documentation. `server_ref` is chosen from a fixed one-entry map, so a URL is
  not expressible in the UI.
- **`alias_id` is absent end to end.** It is not in the wire type, not in any
  form field, and not in either request body; two tests assert it never appears
  in a create or update body. The A4 serializer already omits it.
- **Authorization is not client-side.** The role check only hides a tab. Tests
  assert `canManageDocumentLibraries` is false for Admin, User, Viewer, empty
  and null, so the tab cannot be shown to a non-Developer by accident — but the
  server refusal is what protects the data, and A4's route tests cover it.
- **Cross-company.** Every request names the company in the path and is
  authorized server-side; the browser never filters a mixed list. A Developer's
  own `principal.tenantId` is not used as the scope.
- **`library_ref` stays a note.** Nothing branches on it; it is displayed under
  the heading "Operator note" and the help text states nothing routes,
  authorizes or searches by it.
- **Error hygiene.** `describeApiError` prefers the API's `details.fields`, then
  its sanitized `message`, then a generic line per status. A non-JSON or
  non-envelope body (tested with an HTML gateway error) yields "Something went
  wrong." rather than echoing transport internals.
- **SQL regression.** The database tab's state, handlers, columns and five
  dialogs are unchanged; the diff moves JSX only. The full suite is green,
  including the media-connections floor and source-resolver tripwire tests that
  exist to catch exactly this kind of boundary erosion.
- **Agent path untouched.** No change to `resolveSources`, prompts, tool
  definitions, routing, provenance or retrieval. The A3 routing follow-up is
  untouched and remains deferred.

## 6. Limitations and deviations

Deviations from the approved plan: **none**. No A4 or API change was needed, so
the §2 checkpoint did not trigger.

Limitations, all documented in `docs/ui/document-libraries.md`:

1. **The deployment flag is invisible in the UI.** A library can be enabled and
   still not searchable if `MEDIA_CONNECTIONS_ENABLED` is off. The UI makes no
   claim either way rather than guessing. Exposing it would need an endpoint,
   which the brief asked me not to add unsolicited.
2. **Provisioning and upload are operator work**, outside this application.
   Creating a record here does not create anything on syslab-server.
3. **Deleting may leave an alias behind** on syslab-server; cleanup is an
   operator step. The confirmation says so.
4. **Status is always `"unknown"`** — there is no media connectivity check, and
   adding one was out of scope. Shown as "Not checked".
5. **Description and `library_ref` cannot be cleared** (A4 limitation). The edit
   form omits a blanked field so the saved value is kept, and says so next to
   the field rather than appearing to erase it. Not fixed: it is an A4 API
   limitation and did not block A5.
6. **Name uniqueness is one-directional** (A4): creating a media connection is
   refused against a database connection's name, but not the reverse.
7. **Access is company-level.** Every user of a company gets the same enabled
   libraries; there is no per-user or per-conversation scoping.
8. **No component-render tests.** This repository has no DOM test runner
   (no jsdom, no Testing Library, no Vitest) and A5 was not allowed to add a
   framework. Following the existing `tests/chart-layout.test.ts` precedent, the
   testable logic was extracted into a module and covered directly; the
   component is a thin shell over it. Click-through behavior, focus management
   and dialog keyboard handling are therefore **not** covered by an automated
   test — they rely on the shared `Dialog`/`AlertDialog` primitives already used
   across the app.
9. **One pre-existing lint error** in `DatabaseMappingPage.tsx` (§4). Left
   alone: unrelated to A5 and fixing it would edit code outside this scope.
10. **A platform-level idempotency flaw, flagged not fixed** (added in revision
    2, §8). `beginIdempotent` claims a key before running the handler and
    releases it only on success, so a failed request parks that key for 24
    hours. The UI works around it by minting a fresh key after a server refusal.
    The proper fix is in `lib/api/idempotency.ts`, which is shared platform code
    outside both A5 and A4 — recommended as a follow-up for you to schedule.

## 7. Rollback and final state

Rollback is one command plus two deletions — nothing is committed, so no
history is involved:

```bash
git checkout -- components/database-mapping/DatabaseMappingPage.tsx
rm components/database-mapping/DocumentLibrariesSection.tsx \
   components/database-mapping/media-connection-form.ts \
   tests/media-connections-ui.test.ts
rm -r docs/ui
```

That returns the tree to the A4 state with the A3 work still in place. Do not
use `git stash`/`git checkout .` broadly here — it would sweep up the
uncommitted A3 work.

**Final `git status --short`** — A5 adds exactly one modified file and four new
paths; the rest is the untouched A3 tree:

```
 M .gitignore                                  <- A3, untouched
 M components/database-mapping/DatabaseMappingPage.tsx   <- A5
 M evals/README.md                             <- A3, untouched
 M evals/cases/index.ts                        <- A3, untouched
 M evals/grade.ts                              <- A3, untouched
 M evals/harness.ts                            <- A3, untouched
 M evals/run.ts                                <- A3, untouched
 M evals/types.ts                              <- A3, untouched
 M tests/helpers/render-answer.ts              <- A3, untouched
?? components/database-mapping/DocumentLibrariesSection.tsx   <- A5
?? components/database-mapping/media-connection-form.ts       <- A5
?? docs/ui/                                                   <- A5
?? tests/media-connections-ui.test.ts                         <- A5
?? evals/results/a5-implementation-report.md                  <- A5 (this file)
?? evals/… , tests/evals-*.test.ts, tests/agent-vouched-scoping.test.ts  <- A3, untouched (33 paths)
```

The A5 report file sits in `evals/results/` alongside the A3 and A4 reports
purely to follow the established convention for phase reports; it is not part
of the eval tooling and deleting it changes nothing.

**Diff summary for the A5 change to tracked files:**

```
components/database-mapping/DatabaseMappingPage.tsx | 100 ++++++++++++-------
1 file changed, 67 insertions(+), 33 deletions(-)
```

New untracked A5 files, exact line counts: `DocumentLibrariesSection.tsx` 632,
`media-connection-form.ts` 250, `tests/media-connections-ui.test.ts` 301,
`docs/ui/document-libraries.md` 100. This report is a fifth
(`evals/results/a5-implementation-report.md`).

A3 integrity: 8 modified tracked files and 33 untracked paths, matching the
session start exactly; `git stash list` is empty; `evals/analysis/` is present,
and `evals/results/` holds 26 files — the 25 A3/A4 artifacts that were there at
session start, plus this report.

## 8. Revision 2 — the Idempotency-Key fix

**The defect, confirmed.** `app/api/v1/companies/[company_id]/media-connections/route.ts`
declares `POST` as `idempotent: true`. `defineRoute` therefore routes it through
`runIdempotent`, whose first act is `readIdempotencyKey(request)` — which throws
`ApiError("missing_idempotency_key", …)` when the header is absent, and
`ERROR_CODES` maps that to **400**. The UI sent only `Content-Type`, so **no
create could ever have succeeded**. Codex is right, and this was a genuine
shipping defect, not a style issue.

Why A5's own tests missed it: they asserted request *bodies* and never headers.
That is the real lesson, and the fix closes the category, not just the instance.

**Files changed in this revision** (all A5 scope; no A4 route or service
touched):

| File | Change |
| --- | --- |
| `components/database-mapping/media-connection-form.ts` | Added `MutationRequest`, `newIdempotencyKey`, `nextIdempotencyKey`, and request builders `createRequestInit` / `patchRequestInit` / `deleteRequestInit`. Every request the tab sends is now constructed by a pure function, so its headers are assertable. |
| `components/database-mapping/DocumentLibrariesSection.tsx` | Holds an `idempotencyKey` in state, minted when the Add dialog opens; all four mutations now go through the builders; `submitAdd` distinguishes "no response" from "server refused". |
| `tests/media-connections-ui.test.ts` | +7 tests (20 → 27) over headers and retry-key behavior. |

**Retry semantics, and a subtlety worth Codex's attention.** The instruction was
to reuse the key when the same request is retried. Reusing it unconditionally
would have introduced a second defect, because of how `beginIdempotent` works:
it claims the key *before* running the handler and only resolves that claim by
committing a **success**. A handler that throws leaves the key parked as
`in_progress` for the full 24-hour TTL. So after any rejected create — a
duplicate name, say — reusing the key would make every subsequent attempt fail
with a 409 "still being processed", and the dialog could never recover.

The revision-2 rule therefore distinguished two outcomes: keep the key when
`fetch` itself threw, mint a fresh one when the server answered with an error.

**That two-way split was wrong, and §9 replaces it** — "the server answered with
an error" silently included the API's own "still being processed" 409, which is
the one error where the key must be kept. Read §9 for the rule that actually
ships.

The underlying platform flaw noted here still stands: the clean fix belongs in
`lib/api/idempotency.ts` (release the claim when the handler throws), which is
shared platform code well outside A5 and A4 alike; **flagging it, not touching
it.** Recommend it as a follow-up.

**PATCH and DELETE** are not declared idempotent on these routes, so they
correctly send no key; a test now pins that, so the opposite mistake cannot be
made later either.

**Proof the new test catches the original defect.** I temporarily reverted the
header in `createRequestInit` and re-ran the file: **3 failures**, including
"sends an Idempotency-Key on create, because the API requires one". Restored
and re-verified at 27/27. The test is load-bearing, not decorative.

**Re-verification after the fix** — every check below was run against the final
code:

| Command | Outcome |
| --- | --- |
| `npx tsc --noEmit` | **Pass**, no output |
| `npx tsx --test tests/media-connections-ui.test.ts` | **Pass** — 27/27 |
| `npm test` | **Pass** — 1000 tests, 995 pass, **0 fail**, 5 pre-existing skips |
| `npx eslint` on the three A5 files | **Pass** — "No issues found" |
| `npx eslint .` | 7 errors, 10 warnings — **unchanged**, still 0 attributable to A5 |
| `npm run build` | **Pass** — "Compiled successfully" |
| `npm run api:check` | **Pass** — no breaking changes |

**Still not performed:** the live signed-in browser check (§4 #9). Docker is
still not running, so the fix is verified by type-checking, the header tests and
the build — **not** by an actual successful create against a running API. Given
this defect was precisely the kind a live check would have caught immediately, a
reviewer with a local stack should confirm one real "Add library" round trip
before this is considered done.

A3 work, HEAD and staging are unchanged by this revision: HEAD is still
`7d9065c`, nothing is staged, `git stash list` is empty, and the A3 tree is
still 8 modified tracked files and 33 untracked paths.

## 9. Revision 3 — the in-progress 409 race

**The defect, confirmed.** Codex is right, and this one was mine to get right in
revision 2. `beginIdempotent` answers a request whose key is still claimed with
`ApiError("resource_conflict", …, { retryAfter: 2 })` — a **409 carrying
`Retry-After`**. Revision 2 classified every error response as `refused` and
minted a fresh key, so the next attempt went out under a *new* key while the
original create was still running. Because `createMediaConnection` checks the
name and writes the record as two separate operations, those two creates can
interleave between the check and the write and both succeed, which is exactly
the duplicate the name check exists to prevent.

**What separates the two 409s.** Status is not enough: an in-progress conflict,
a reused-key conflict and a duplicate-name conflict are all 409, and the first
two are both coded `resource_conflict`. The discriminator is the header —
`errorResponse` emits `Retry-After` only when the `ApiError` carried
`retryAfter`, and on these routes only the in-progress conflict does. Verified
by reading `lib/api/errors.ts`, `lib/api/http.ts:59` and `lib/api/rate-limit.ts`:
the only other source of `Retry-After` is rate limiting, which is a 429 and
which runs *before* idempotency, so its key was never claimed.

**The rule that now ships**, in `nextIdempotencyKey`:

| Outcome | Key | Why |
| --- | --- | --- |
| `no-response` — `fetch` threw | **kept** | The create may have happened; a retry must replay, not duplicate. |
| `in-progress` — 409 + `Retry-After` | **kept** | A new key would race the original create. |
| `refused` — any other error | replaced | The API answered definitively, and the old key is parked for 24h. |

`submitAdd` now loops: on `in-progress` it waits exactly as long as
`Retry-After` asks and retries **with the same key**, up to
`MAX_IN_PROGRESS_WAITS` (3). If the original is still running after that, it
stops and tells the Developer to try again shortly — still holding the key, so
pressing the button picks up the original request's answer rather than starting
a rival one. `retryAfterMs` clamps to 10s and falls back to 2s for a missing,
zero, negative or HTTP-date value, so a bad header cannot hang the dialog or
produce a `NaN` timeout.

**Files changed in this revision** (A5 scope only; no A4 route or service
touched):

| File | Change |
| --- | --- |
| `media-connection-form.ts` | Added `classifyFailure`, `retryAfterMs`, `RETRY_AFTER_FALLBACK_MS`, `RETRY_AFTER_MAX_MS`, `FailedResponse`; `AttemptOutcome` gains `"in-progress"` and `nextIdempotencyKey` now replaces the key only on `refused`. |
| `DocumentLibrariesSection.tsx` | `submitAdd` retries in a bounded loop, honoring `Retry-After` and holding one key for the whole submission. |
| `tests/media-connections-ui.test.ts` | +8 tests (27 → 35). |

**Proof the new tests catch it.** I removed the in-progress branch from
`classifyFailure` and re-ran: **2 failures** — "reads a still-processing 409 as
in-progress, not as a rejection" and "keeps the key for that response, so the
retry cannot race the original". Restored and re-verified at 35/35.

**Re-verification after this fix**, all against the final code:

| Command | Outcome |
| --- | --- |
| `npx tsc --noEmit` | **Pass**, no output |
| `npx tsx --test tests/media-connections-ui.test.ts` | **Pass** — 35/35 |
| `npm test` | **Pass** — 1008 tests, 1003 pass, **0 fail**, 5 pre-existing skips |
| `npx eslint` on the three A5 files | **Pass** — "No issues found" |
| `npx eslint .` | 7 errors, 10 warnings — **unchanged**, still 0 attributable to A5 |
| `npm run build` | **Pass** — "Compiled successfully" |
| `npm run api:check` | **Pass** — no breaking changes |

**Limitations of this fix, stated honestly.**

1. **The retry loop itself is not covered by an automated test.** What is tested
   is every decision it makes — classification, key selection, wait duration and
   clamping — as pure functions. The `for` loop, the `await delay(...)` and the
   attempt cap live in the component, which this repo cannot render in a test.
2. **Still no live verification.** Docker is not running, so no real create, and
   in particular no real in-progress 409, has been observed end to end. The
   classifier is built from reading `lib/api/idempotency.ts`,
   `lib/api/errors.ts` and `lib/api/http.ts`, not from an observed response.
   This is the second review round to turn on behavior no one has executed; a
   live round trip is the thing most worth doing before approval.
3. **The platform flaw remains** (§6 item 10): the proper fix is to release the
   idempotency claim when a handler throws, in `lib/api/idempotency.ts`. Still
   flagged, still not touched — it is outside both A5 and A4.

HEAD is still `7d9065c`, nothing staged, `git stash list` empty, A3 tree still
8 modified tracked files and 33 untracked paths.

## 10. Revision 4 — the live round trip

**§8 and §9 above said "still no live verification."  That is no longer true.**
A real signed-in Developer, in a real browser, against a real running instance
of this code, completed the full sequence: create disabled → duplicate-name
rejection → edit → enable → disable → delete. Everything below is observed,
not inferred from reading source.

### 10.1 Environment, and how it was chosen

Getting to a safe environment took several wrong turns, recorded here because
they're relevant to trusting the result:

1. `.env.local` initially pointed at `localhost:5433`, a container named
   `dbagent-local-test` — reachable, schema present, **completely empty** (0
   companies).
2. A credential was volunteered for `127.0.0.1:5432` / `syslab_admin`; the
   harness itself refused the command as credential exploration before I could
   run it. Good — investigation showed that host isn't reachable from this
   shell at all (nothing listens on 5432 on the host), and the role
   `syslab_admin` doesn't exist in the one Postgres container that *is*
   reachable (`syslab-webapp-db`), so it was never going to be usable here
   regardless.
3. A second credential, `intaj_vehicle_check`, was confirmed to be a **real
   INTAJ operational SQL database** — one of the three shown in the person's
   screenshot (Vehicle Checks / Journey Register / Observations). Using it as
   the app's own Prisma connection would point the entire control-plane schema
   (`companies`, `users`, `app_documents`, `audit_events`) at a live customer's
   business data with an incompatible schema. **Refused outright** — I did not
   run anything against it. All three `intaj_*` credentials and `syslab_admin`
   were pasted into chat during this process and should be rotated regardless
   of the outcome here.
4. Settled on the original, confirmed-empty `dbagent-local-test` (port 5433).
   One company was seeded — **`INTAJ (test)`**
   (`f783d3bc-81ba-48b9-8443-7695eafc5f19`) — and one `Developer` user
   (`dev@local.test`), via a script that refuses to run unless the `companies`
   table is empty. A pre-existing, unrelated bootstrap `Admin` account with no
   company (`dev@syslab.local`, dated three days before this session — the
   container's data volume evidently predates this session) was left
   untouched; the guard was scoped to "no company exists yet," not "no user
   exists," specifically so it wouldn't need to touch that account.

**This is a real, populated control-plane database — not the memory-driver
default.** `.env.local` in this environment sets `METADATA_DRIVER=postgres`,
so `app_documents` (connections) and `audit_events` are genuine Postgres
tables, and the whole exercise ran through real SQL, real Prisma queries, and
a real NextAuth session — not an in-memory stub. It is, however, a database
containing only test data (my seeded company, that one older bootstrap
account) — not INTAJ's real production tenant, which remained unreached and
untouched throughout.

**`MEDIA_CONNECTIONS_ENABLED=true` in this environment.** That was treated as
a real exposure window (see 10.3), not ignored just because the company is
synthetic — INTAJ (test) has no real users or conversations, so no real
traffic was ever at risk, but the switch was still treated as live search
availability, not a cosmetic toggle.

### 10.2 The sequence, as observed

All timestamps from `audit_events.created_at` (UTC), all against connection
`conn_01M34CFGBX5RCPAP4XWH336RDK`, company `f783d3bc-…-7695eafc5f19`:

| Time (UTC) | Step | What the database shows |
| --- | --- | --- |
| 07:02:09.552 | **Create**, disabled | `media_connection.created`. Row written with `enabled: false`, `status: "unknown"`, `media.alias_id` present in storage and correctly absent from the API's own wire shape. This is the step the two Codex review rounds were about — **the create request the browser actually sent carried its `Idempotency-Key` and succeeded.** |
| — | **Duplicate name** | Second create with the identical name was rejected. Verified by database, not just a UI toast: connection count stayed at 1, audit row count stayed at 1 — the rejected attempt left no row and logged no event, exactly as `createMediaConnection`'s uniqueness check and the route's "only audit after success" ordering both require. |
| 07:07:19.964 | **Edit** | `media_connection.updated`. Name and description changed; `media.alias_id` and `server_ref` were preserved even though the request only touched `library_ref` — confirms the shallow-merge safeguard in `updateMediaConnection` (`changes.media = {...existing.media, library_ref: …}`) works against a real Postgres `patch`, not just the in-memory provider the unit tests run against. |
| 07:08:05.587 | **Enable** | `media_connection.updated`, `enabled: true`. |
| 07:08:21.524 | **Disable** | `media_connection.updated`, `enabled: false`. Confirmed `enabled: false` in the database **before** proceeding to delete, as required. |
| 07:08:43.545 | **Delete** | `media_connection.deleted`. Connection row confirmed gone (`SELECT` returns 0 rows). Delete's audit metadata correctly captured the name as of the moment of deletion. |

**Enabled window: `07:08:05.587` → `07:08:21.524` — 15.9 seconds.** INTAJ (test)
has no other users and no conversations, so nothing could have actually
queried through the window regardless; the number is reported because the
instruction was to keep it short and verify the edges, not because there was
real traffic to protect here.

### 10.3 A defect found and fixed during this verification

**The Add/Edit dialogs could grow taller than the viewport, taking the
Cancel/Save footer off-screen with them.** Reported directly by the person
mid-test, after the error banner from the duplicate-name step pushed the
dialog past the screen edge.

Root cause: [`DialogContent`](components/ui/dialog.tsx#L56) is centered with
`top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` and has **no
`max-height` and no scroll region of its own** — a popup taller than the
viewport overflows both edges equally, since centering doesn't clip. This is a
pre-existing gap in the shared primitive that every dialog in the app uses;
A5's Add dialog is simply the tallest one that exists today (more help text
under `library_ref`, the server picker and the enabled switch than any
existing dialog stacks up), so it was the one to expose it.

**Fix, scoped entirely to A5's own file:** capped the scrollable form-fields
region in both the Add and Edit dialogs at `max-h-[60vh] overflow-y-auto`,
leaving `DialogHeader` and `DialogFooter` outside that region so the
Cancel/Save buttons stay pinned and reachable regardless of content height —
the same convention already used by the existing Columns dialog on the
Databases tab
([DatabaseMappingPage.tsx:838](components/database-mapping/DatabaseMappingPage.tsx#L838),
`max-h-96 overflow-y-auto` around just its inner list). **The shared
`components/ui/dialog.tsx` primitive was not touched** — fixing it there would
affect every dialog in the app (Settings, Companies, AI Feedback, the database
dialogs on this same page), which is outside A5's file scope. The gap remains
in the shared primitive for anyone whose dialog content grows tall enough to
hit it next; flagging it as a platform follow-up, not fixing it there.

Re-verified after the fix: `tsc` clean, `eslint` on the changed file clean.
Re-tested live by the person immediately after (create → duplicate-name
rejection again): dialog fit, Cancel reachable. This fix is **not** covered by
an automated test — this repo has no DOM renderer to assert dialog geometry
against (the same limitation noted for the retry loop in §9.1).

**Files changed in this revision:** `DocumentLibrariesSection.tsx` only
(+8/−2 lines, two `className` edits). No other file touched.

### 10.4 Idempotency, observed vs. inferred

`KV_DRIVER` is unset in this environment → **memory**, confirmed by reading
`.env.local` for it directly (not assumed). So:

- The **create** step is a genuine, positive observation: the browser sent
  `Idempotency-Key`, the claim was taken in the dev server's in-memory KV
  store, the handler ran once, and the row exists. That directly confirms the
  fix from revision 2.
- The **in-progress 409 branch specifically** (revision 3's fix) was **not**
  independently observed here — forcing it needs a genuine race (two
  overlapping requests under one key), which this manual, one-click-at-a-time
  sequence does not produce. What *was* observed is that the **duplicate-name
  409** (a different branch, `classifyFailure` → `"refused"`) was handled
  correctly end to end: fresh key, no stuck state, immediately retryable. The
  in-progress branch remains verified by the 35 focused tests plus reading
  `lib/api/idempotency.ts`, not by an observed race in this session.
- Because the store is memory-backed, nothing from any idempotency claim
  persists in Postgres — there is no idempotency table to show you, and
  restarting the dev server clears all of it. The "records that cannot be
  cleaned up" are exactly the five `audit_events` rows in 10.2, not anything
  idempotency-related.

### 10.5 Document search — explicitly separate, and not attempted (as of this revision — see §11)

Per the person's own framing: an unlinked library can verify switch and source
exposure (done, 10.2–10.3) but a successful RAG answer needs a provisioned
SysLab library, a linked alias, and a test document — none of which exist for
`conn_01M34CFGBX5RCPAP4XWH336RDK` or for this environment's
`RETRIEVAL_BASE_URL`. No `search_documents` call was made, no conversation was
run, and no claim is made about retrieval working. That remains exactly as
scoped out from the start: A5 connects the UI to the existing, unmodified
retrieval path; it does not stand up a retrieval backend to test against.

**This was true when written. §11 covers a later, separately-authorized
exercise that did stand up a temporary link and did exercise this path —
read that section for the actual result rather than treating this one as
final.**

### 10.6 Final state

- Connection record: created, edited, enabled, disabled, deleted — confirmed
  absent by direct query after deletion.
- Company `INTAJ (test)` remains in the local test database (a disposable
  artifact of this verification, not of the shipped feature) along with the
  seeded `dev@local.test` Developer account and the pre-existing, untouched
  `dev@syslab.local` bootstrap Admin.
- **5 audit rows persist, append-only, as expected**: created, updated
  (edit), updated (enable), updated (disable), deleted — all correctly
  scoped to `company_id = f783d3bc-…`, all with `actor_id` populated
  (confirmed by direct query) even though `actor_email` is null on every row.
  That null is **pre-existing A4 route behavior** — the route only ever passes
  `actor: { id: principal.userId }` to `recordAuditEvent`, never an email — not
  something A5 introduced or is in scope to change.
- No other company's connections, no production data, and no real webapp
  instance were touched at any point in this revision.

### 10.7 What this settles, and what it doesn't

**Settled:** the exact defect this whole review cycle was about — a real
browser create with a real `Idempotency-Key` — succeeds against a real
Postgres-backed deployment of this code, not just against unit tests or a
mocked fetch. The shallow-merge safeguard on edit, the audit trail, the
enable/disable cycle and the pre-delete state check all match what the code
promises, observed rather than assumed.

**Not settled by this:** the in-progress-409 race path specifically (still
test-only verification, see 10.4); document search (out of scope by design,
see 10.5); and everything already listed in §6 as a Project A limitation
(operator provisioning, connectivity status, the one-directional name
uniqueness, PATCH's inability to clear a field). Those stand as before.

HEAD is still `7d9065c`, nothing staged, committed, pushed or deployed. A3
tree unchanged. This revision changed one file
(`DocumentLibrariesSection.tsx`, the dialog-sizing fix) beyond what revision 3
already had; everything else in this section is verification, not code.

## 11. A separately-authorized retrieval/citation exercise, and what it adds to A5

After §10, the person separately and explicitly authorized standing up a
**temporary** link between a second local media connection
(`"A5 chat test"`, `conn_01M34DEWB635NZN0CRGHBDCW0P`) and an **already
existing** syslab-server test tenant (`wravtrzwm6qy` — the same one prior
project history, and this repo's own `tests/retrieval-integration-live.test.ts`,
already use) — no new tenant, no document upload, one alias row created and
later removed. Full authorization, exact commands, and cleanup are recorded in
project memory, not repeated verbatim here; this section states only what it
means **for A5 specifically**.

**No code changed for this.** It exercised A5's already-built, already-shipped
UI and the unmodified retrieval path underneath it — nothing here is a new A5
change, only new evidence about the existing one.

**What it adds:** a real browser chat turn, through `"A5 chat test"` while
enabled, produced a genuine Sources block citing real files
(`contract_03/01/07/04/49.pdf`), which is only possible if `search_documents`
was actually called and A2b's `checkSources` validated the citations against
real tool results. Combined with §10's CRUD round trip, this is now
first-hand, observed evidence — not inferred from source reading — that the
entire path A5 exists to enable (create a library → enable it → the agent
searches it → a citable answer comes back) works end to end through the real
UI, at least once, against a real (non-INTAJ) corpus.

**What it still doesn't show, stated as plainly as in the original request:**

- **Not SQL-vs-document routing.** No working database connection existed in
  this environment at the time (§ Part 1 in project memory — blocked on
  `intaj_journey_plan`'s Docker-internal host, unresolved, now deprioritized
  by the person's own instruction), so there was nothing for the model to
  choose *between*. This exercised the document path in isolation.
- **Not INTAJ, and not production.** The corpus is the project's pre-existing
  shared SEC test set; the company is the same synthetic `INTAJ (test)` from
  §10; nothing here touched real INTAJ data or the real deployed site.
- **One discrepancy, disclosed rather than smoothed over:** a direct
  `RetrievalClient` call with the identical query returned passages from only
  2 of the 5 cited files. The likely explanation — the model split the
  question into more than one search — is consistent with how the citation
  mechanism works (it cannot cite a file no real tool call returned) but was
  **not independently confirmed**; this session had no server-log access to
  see the actual tool-call queries made.

**Cleanup confirmed complete, specific to A5's own record:** `"A5 chat test"`
was disabled (confirmed `enabled: false` by direct query) before the alias was
removed, and the alias removal was itself confirmed by re-listing syslab-
server's mappings afterward. The connection record itself was deliberately
**left in place, disabled** — unlike §10's connection, which was deleted — so
if the person wants to repeat or extend this later, the record is already
there. It is inert: disabled, unlinked, offers nothing to the agent.

**One out-of-scope finding surfaced by this exercise, deferred, not fixed:**
the first-ever feedback report filed on a document-only run revealed that
`components/ai-feedback/AiFeedbackDetailPage.tsx` has never rendered tool-call
step data — only SQL query data — even though the server-side snapshot
(`lib/services/ai-feedback.ts`) has always captured it. Confirmed as
pre-existing (`git diff --stat HEAD -- components/ai-feedback app/api/v1/ai-feedback`
is empty — nothing in A1 through A5 touched this file), not a regression from
this work. The person said to log it for later rather than fix it now; it is
not an A5 deliverable and nothing was changed.

Repo state after this section: unchanged from §10's — HEAD `7d9065c`, nothing
staged/committed/pushed/deployed, A3 tree intact.
