# Database Agent API — v1

The contract is [`openapi/v1.yaml`](../../openapi/v1.yaml). It is the source of
truth: routes implement it, CI diffs it, and if this document and the spec ever
disagree, the spec is right.

## Five-minute quickstart

The dev server runs with no credentials and no `.env`. It seeds a local
workspace on first request — an admin user, a playbook, and a sample dataset you
can query immediately.

```bash
npm run dev
```

```bash
curl -s localhost:3000/api/v1/health | jq
```

```bash
curl -s localhost:3000/api/v1/connections | jq '.data[] | {id, name, engine}'
```

Ask a question. Create a conversation, then create a run on it:

```bash
CONN=$(curl -s localhost:3000/api/v1/connections | jq -r '.data[0].id')
CONV=$(curl -s -X POST localhost:3000/api/v1/conversations -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -d "{\"connection_id\":\"$CONN\"}" | jq -r .id)
curl -s -X POST "localhost:3000/api/v1/conversations/$CONV/runs" -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"content":"How many customers are on each plan?"}' | jq -r .content
```

Add `"stream": true` to that last body to get `text/event-stream` instead.

Without `ANTHROPIC_API_KEY` set, runs return the setup notice rather than a real
answer. Everything else works.

## Conventions

Decided once, applied to every endpoint. Consistency here is most of the
developer experience — an integrator should be able to guess the next endpoint's
shape correctly.

| | |
|---|---|
| Field names | `snake_case`, everywhere |
| Timestamps | RFC 3339 / ISO 8601, UTC — `2026-08-08T14:05:22Z` |
| IDs | Opaque prefixed strings: `conn_`, `conv_`, `msg_`, `run_`, `qry_`, `skl_`, `usr_`, `file_` |
| Resource type | Every object carries `object` (`"connection"`, `"run"`, …) |
| Lists | `{data, has_more, next_cursor}` |
| Errors | One shape, always. See below |
| Creates | Require `Idempotency-Key` |

Do not parse an ID to learn its type — check `object`. The prefix exists so a
log line is readable, not as an API guarantee.

## Authentication

```
Authorization: Bearer <api key>
```

The key determines the tenant. Nothing in a request body can change which
workspace you are reading — a caller cannot reach another tenant's data by
editing a payload.

In development, a request with no key resolves to the local workspace as an
admin. This is refused outright in production, regardless of configuration.

`GET /v1/me` returns the tenant, user, role, and scopes for the calling key.
It is the first call worth making.

### Scopes and roles

Scopes are per key; roles are per user. An endpoint's required scope is listed
on its operation in the spec.

| Role | Can |
|---|---|
| `admin` | Everything, including managing users and roles |
| `member` | Read everything; create connections, run queries and agent runs, edit the playbook |
| `viewer` | Read only. A run executes SQL, so viewers cannot start one |

## Pagination

```
GET /v1/conversations?limit=25&order=desc
```

```json
{ "data": [ ... ], "has_more": true, "next_cursor": "eyJzIjoi..." }
```

Pass `next_cursor` back as `cursor`. Cursors are opaque — do not parse or
construct them. A cursor encodes the `order` it was created with; using it with
a different `order` returns `400 invalid_cursor` rather than silently skipping
rows.

Cursor pagination rather than offsets because rows arrive constantly: `?page=2`
would drop or duplicate records whenever something lands at the head of the list
while you are paging.

## Errors

Every failure, from every endpoint, is this shape:

```json
{
  "code": "sql_not_read_only",
  "message": "This connection is read-only and the statement is not provably a read...",
  "details": { "allow_writes": false },
  "request_id": "req_01K2M9X4QF7B3N",
  "docs_url": "https://docs.example.com/api/v1/errors#sql_not_read_only"
}
```

- **`code`** is stable and machine-readable. Branch on it. New codes are added
  within v1, so treat an unrecognized code as generic rather than failing.
- **`message`** is for a human debugging. It may be reworded at any time — never
  parse it.
- **`request_id`** traces the request end to end. Include it in support tickets.

A `200` carrying `{"error": ...}` is a bug. Status codes mean what they say.

Validation failures list every problem at once, so a request with three mistakes
does not take three round trips:

```json
{
  "code": "validation_failed",
  "message": "engine must be one of: postgres, mysql, bigquery, demo (and 1 other problem).",
  "details": { "fields": [
    { "path": "engine", "issue": "must be one of: postgres, mysql, bigquery, demo" },
    { "path": "max_rows", "issue": "must be between 1 and 50000" }
  ] },
  "request_id": "req_01K2M9X4QF7B3N"
}
```

## Idempotency

Every create requires `Idempotency-Key`. Send any unique string — a UUID is
fine.

- Same key, same body → the original response, plus `Idempotent-Replay: true`.
- Same key, **different** body → `409 idempotency_key_reused`. That is a client
  bug, not a retry, and answering one of the two requests would hide it.
- Same key while the first is still running → `409` with `Retry-After`.

Keys are remembered for 24 hours. Only successful responses are replayed; if a
request failed, the same key is free to be retried.

## Rate limits

Every response carries the limits, not just the `429`:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 583
X-RateLimit-Reset: 1786291200
```

On breach: `429` with `Retry-After` in seconds and
`code: "rate_limit_exceeded"`.

Budgets are per tenant per class, because the costs differ by an order of
magnitude:

| Class | Default | Endpoints |
|---|---|---|
| `read` | 600/min | Listing and fetching |
| `write` | 120/min | Creating and updating |
| `query` | 60/min | SQL execution, schema introspection, connection tests |
| `run` | 30/min | Agent runs |

Override per deployment with `RATE_LIMIT_READ`, `RATE_LIMIT_WRITE`,
`RATE_LIMIT_QUERY`, `RATE_LIMIT_RUN`.

## Choosing which AI answers

`GET /v1/model-providers` lists what the workspace has configured, plus a
`presets` catalogue of known providers with their base URLs and suggested
models — so a client never hardcodes values that would drift from the server's.

```bash
curl -s localhost:3000/api/v1/model-providers | jq '.presets[] | {id, label, base_url}'
```

Adding one (admin only — the choice sets what every question costs and which
company receives the workspace's schema and questions):

```bash
curl -s -X POST localhost:3000/api/v1/model-providers \
  -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"provider":"qwen","model":"qwen-max","api_key":"sk-..."}' | jq
```

```bash
curl -s -X POST localhost:3000/api/v1/model-providers/mprov_.../test | jq
```

`api_key` is write-only. It goes to the secret store and no endpoint returns it;
what comes back is `key_hint` — the last four characters, masked — which is
enough to tell which key is installed. To rotate, `PATCH` a new one. **Omit
`api_key` on a PATCH to leave the stored key alone**: since it cannot be read
back, a form that round-tripped its own mask would overwrite the real key.

Two adapters cover the field:

| `kind` | Providers |
|---|---|
| `anthropic` | Claude. The only path with adaptive thinking and effort levels |
| `openai_compatible` | Qwen, OpenAI, DeepSeek, Groq, Mistral, OpenRouter, Together, Ollama, and anything else speaking Chat Completions — use the `custom` preset with a base URL |

The model must support **tool calling**. The agent answers by calling `run_sql`;
a model without it produces prose about SQL it never ran.

The first provider added becomes the default. `PATCH {"is_default": true}`
switches, which makes comparing two models on the same question a single call.
A workspace with none configured falls back to the environment, and with neither
the agent returns a setup notice rather than an error.

## Streaming a run

`POST /v1/conversations/{id}/runs` with `"stream": true` returns
`text/event-stream`:

```
event: run.created
data: {"type":"run.created","run_id":"run_01K2...","run":{...}}

event: run.step
data: {"type":"run.step","run_id":"run_01K2...","step":{"label":"Ran query","status":"done","query_id":"qry_01K2..."}}

event: run.content_delta
data: {"type":"run.content_delta","run_id":"run_01K2...","delta":"Enterprise "}

event: run.completed
data: {"type":"run.completed","run_id":"run_01K2...","run":{...}}
```

The stream ends with `run.completed` or `run.failed`. New event types may be
added within v1 — ignore types you do not recognize rather than failing.

If the connection drops mid-answer, `GET /v1/runs/{run_id}` tells you what
happened. The run record is written before the agent starts.

## Auditing an answer

Every query the agent runs is persisted. A run's `steps` carry `query_id`s, and
`GET /v1/queries/{query_id}` returns the exact SQL and the exact rows behind a
number in the reply. That is the difference between an answer you can check and
one you have to trust.

## Deprecations

A deprecated endpoint keeps working for its whole runway and says so on every
response:

```
Deprecation: Sat, 08 Aug 2026 00:00:00 GMT
Sunset: Sat, 08 May 2027 00:00:00 GMT
Link: </api/v1/conversations/{conversation_id}/runs>; rel="successor-version"
```

Currently deprecated: `POST /api/chat` → `POST /v1/conversations/{id}/runs`.
See [versioning.md](./versioning.md).
