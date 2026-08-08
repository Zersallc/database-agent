# Versioning and deprecation policy

Once a third party integrates, the shape of this API is frozen by their code,
not ours. This document is the promise we make about that, and the process that
keeps it.

## The version strategy

**Major version in the path — `/v1`, `/v2` — for breaking changes only.**

Everything backward-compatible ships continuously inside the current version.
There is no `v1.1`: minor version churn forces consumers to track releases they
did not need, for changes that could not have broken them.

## What counts as breaking

The left column ships today. The right column needs a new major version.

| Safe — additive, no version bump | Breaking — new version + migration path |
|---|---|
| Add a new optional response field | Remove or rename any field |
| Add a new endpoint | Remove an endpoint |
| Add a new optional request parameter | Make an optional parameter required |
| Add a new enum value *(clients are told to tolerate unknowns — see below)* | Remove an enum value |
| Add a new error `code` within the existing error shape | Change the error shape, or what a status code means |
| Relax a validation constraint | Tighten a validation constraint |
| Add a new event type to a stream | Remove or repurpose an event type |

**The enum caveat.** Adding an enum value is only safe because the spec tells
clients to handle unknown values gracefully, and it says so on every enum that
can grow (`Engine`, `Error.code`, `RunEvent.type`). A client that switches
exhaustively on an enum will still break. That is why new values are announced
in the changelog even though they need no version bump.

Two enums are deliberately conservative: `Engine` lists only engines with a
shipped connector. Listing one speculatively and removing it later would be a
breaking change caused by nothing but optimism.

## The gate

```bash
npm run api:check
```

Diffs `openapi/v1.yaml` against `openapi/v1.released.yaml` — the last shipped
contract — and exits non-zero on anything in the right column. It also verifies
every documented path has a route handler, because an endpoint that is
documented but not built is a promise that 404s.

Wire it into CI as a required check. Review is not a reliable place to catch
"this field became required": it looks like a one-line diff and reads as
harmless.

When a change genuinely ships:

```bash
npm run api:release
```

That accepts the current spec as the new baseline. It is a deliberate act meaning
"this is now published and I am on the hook for it" — not something to run to
make a red build go green.

## The deprecation runway

Never a cliff. Five steps, in order:

1. **Announce.** Changelog entry, email to registered developers, and a
   migration guide published *before* the deprecation headers appear. A
   deprecation a developer first learns about from a response header is a
   deprecation they learn about too late.
2. **Signal.** Every response from the affected endpoint carries:
   - `Deprecation` — an HTTP-date, when it took effect (RFC 9745)
   - `Sunset` — an HTTP-date, when it stops working (RFC 8594)
   - `Link: <successor>; rel="successor-version"` — where to go instead
   - `Warning: 299 - "…"` — a human-readable line for anyone reading a log
3. **Runway.** 9–12 months for anything a third party can call. Long enough that
   a team can absorb the migration into planned work rather than dropping
   something.
4. **Monitor.** Every call to a deprecated endpoint is logged as
   `deprecated_endpoint_called` with the tenant and user agent. Track remaining
   traffic *by consumer* and contact the stragglers directly. Removing an
   endpoint that three named customers still call is a decision, not an
   oversight.
5. **Sunset.** Only after the date has passed and usage is near zero.

A breaking change with no migration path and no runway is not a release. It is a
broken promise.

## Currently deprecated

| Endpoint | Deprecated | Sunset | Replacement |
|---|---|---|---|
| `POST /api/chat` | 2026-08-08 | 2027-05-08 | `POST /api/v1/conversations/{conversation_id}/runs` |

### Migrating off `POST /api/chat`

The old endpoint is stateless: it takes the whole conversation on every call and
returns `{reply}`. The replacement stores the conversation, so you send one
message and it appends both turns.

**Before**

```jsonc
POST /api/chat
{
  "messages": [ /* the whole history, every time */ ],
  "connectionId": "conn_...",
  "playbookContext": "...",   // client assembled this itself
  "responseDetail": "balanced"
}
// -> { "reply": "..." }
```

**After**

```jsonc
// Once per thread:
POST /api/v1/conversations
Idempotency-Key: <uuid>
{ "connection_id": "conn_..." }
// -> { "id": "conv_...", ... }

// Per question:
POST /api/v1/conversations/conv_.../runs
Idempotency-Key: <uuid>
{ "content": "How many customers are on each plan?", "response_detail": "balanced" }
// -> { "id": "run_...", "content": "...", "steps": [...], "usage": {...} }
```

What you gain, and why the endpoint changed rather than being patched:

- **History is server-side.** You stop resending it, and it stops being
  something a client can silently corrupt.
- **The playbook is server-side.** The old endpoint trusted whatever the client
  sent as `playbookContext`, which meant the workspace's own definitions could be
  bypassed by a modified request.
- **Runs are auditable.** `steps` carry `query_id`s that resolve to the exact SQL
  and rows behind each number.
- **Streaming.** `"stream": true` returns server-sent events; the old endpoint
  could only return the whole answer at once.
- **Idempotency.** A retry after a dropped response no longer re-asks the
  question and re-runs its queries.

Until 2027-05-08 the old endpoint keeps its exact request and response shape.
It has not been "improved" — a deprecated endpoint that changes behavior is
worse than one that is merely old.

## Changelog discipline

Every change to `openapi/v1.yaml` gets a changelog entry, including additive
ones. "Additive" means it cannot break a consumer; it does not mean nobody wants
to know about it. A developer who subscribes to the changelog and finds it
incomplete stops subscribing, and then the deprecation announcements stop landing
too.
