# Database Agent

An AI-powered database analysis workspace. Instead of a static KPI dashboard,
users ask questions in a chat interface and the agent answers with tables,
charts, SQL, diagrams and reports drawn from connected databases.

The backend is a contract-first, multi-tenant API under `/api/v1` — database
connections, agent runs over them, conversations, and the playbook that shapes
every answer. See [`docs/api/`](docs/api/README.md) for the developer-facing
guide and [`openapi/v1.yaml`](openapi/v1.yaml) for the contract itself.

**It runs with no configuration.** Storage, secrets, and the model provider all
default to in-memory or unconfigured, and the workspace seeds itself on first
request. Set `ANTHROPIC_API_KEY` to get real answers; attach a real database to
query one. Without either, the sample dataset and the rendering demo still work.

The chat UI still calls the older `/api/chat`, which now runs the real agent and
is deprecated with a runway to 2027-05-08 — see
[`docs/api/versioning.md`](docs/api/versioning.md).

## Requirements

- **Node.js 20.9 or newer** (Next.js 16 refuses to start on older versions;
  Node 22 LTS is what this was developed against)
- npm

Check with `node -v` before starting.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000>. No sign-in, no environment variables, no
`.env` file — it runs standalone out of the box.

To connect the agent and a real database, copy [`.env.example`](.env.example) to
`.env.local` and see [`docs/backend/configuration.md`](docs/backend/configuration.md).
Cloud SDKs and database drivers are optional dependencies, installed per
deployment — a laptop needs none of them.

## What to try

- **Ask anything** — click a suggestion card or type a question. Every reply is
  the same demo payload; that's expected.
- **Agent status** — a step checklist ("Connecting to database", "Running
  query"…) animates while the response is in flight.
- **SQL handler** — press **Execute** on the SQL block to run the mock executor;
  results come back as a sortable table with a row count and execution time.
  **Explain** toggles a canned query plan.
- **Table handler** — sort by clicking a header, filter with the search box,
  page through results, drag column edges to resize, **Export CSV** to download.
- **Sidebar** — "New chat" starts a fresh conversation; switching between
  conversations preserves each one's messages. Conversations persist across
  reloads via `localStorage`.
- **Connection switcher** — the control at the top of the sidebar swaps between
  four mock databases; the header badge follows your selection.
- **Light / dark** — the moon/sun button in the sidebar footer. Charts,
  diagrams and code editors all follow the active scheme.

To reset the demo state, clear the site's `localStorage` (keys are prefixed
`database-agent:`) or use a private window.

## Architecture

```
Customer → React + Next.js frontend → /api/v1  ── contract: openapi/v1.yaml
                                         │
                       ┌─────────────────┴──────────────────┐
                       │                                    │
              Agent runtime                        Provider layer
              (Claude API, tool use)      ┌────────┼─────────┬──────────┐
                       │                 │        │         │          │
              Connector registry     Documents    KV      Blobs     Secrets
              ┌────────┼────────┐    Firestore  Firestore  GCS      Secret
          Postgres  MySQL  BigQuery   /memory   /memory   /S3/mem   Manager/env
```

Everything in that diagram exists. The bottom row is pluggable: Google Cloud is
the default target, and a tenant who needs their bytes on AWS gets S3 by changing
one environment variable. Databases are per connection, so one workspace can hold
a Postgres primary, a BigQuery warehouse, and a MySQL staging box at once.

### How responses are rendered

The agent replies in markdown. [`components/chat/Markdown.tsx`](components/chat/Markdown.tsx)
inspects each fenced code block and dispatches it to a specialized handler:

| Fence | Handler | Built with |
| --- | --- | --- |
| *(prose)* | Rich text | react-markdown + remark-gfm |
| ` ```sql ` | SQL — execute, explain, copy | Monaco + mock executor |
| ` ```table ` | Table — sort, filter, paginate, export | TanStack Table |
| ` ```chart ` | Chart | Apache ECharts |
| ` ```mermaid ` | Diagram | Mermaid |
| ` ```flow ` | Workflow | React Flow |
| ` ```status ` | Agent progress | custom |
| ` ```diff ` | Diff *(draft)* | Monaco DiffEditor |
| ` ```file ` | File attachment *(draft)* | custom |
| anything else | Code | Monaco |

Adding a handler means adding a case in `Markdown.tsx` and a component under
`components/chat/blocks/`.

### Layout

```
openapi/v1.yaml           the API contract — source of truth
scripts/                  check-api-compat.mjs, the CI breaking-change gate
                          run-tests.mjs, the `npm test` entry point
tests/                    unit tests for the pure logic in lib/

app/api/v1/               route handlers, one per documented path
app/api/chat/             deprecated predecessor, kept working until sunset
lib/api/                  platform primitives: auth, errors, validation,
                          pagination, idempotency, rate limits, route wrapper
lib/providers/            pluggable storage: memory, Google Cloud, AWS
lib/connectors/           pluggable databases + the read-only SQL guard
lib/agent/                the agent loop, prompt assembly, tool use
lib/services/             domain logic between routes and providers

app/                      pages
components/app-shell/     sidebar, connection switcher, shell composition
components/chat/          chat workspace, composer, message bubbles, dispatcher
components/chat/blocks/   one component per content handler
components/ui/            shadcn/ui primitives
components/theme/         color-scheme script and toggle
lib/workspace-store.ts    client-side conversation + connection state
hooks/                    color-scheme and viewport hooks
```

## Not built yet

- **The chat UI still talks to `/api/chat`** and keeps conversations in
  `localStorage`. Moving it onto `/api/v1` — server-side conversations, streamed
  runs, the trace with query IDs — is the next piece of work.
- **API key issuance.** Keys are looked up and enforced, but there is no endpoint
  that mints one yet; development uses open access to the local workspace.
- **Snowflake and Azure Blob Storage.** Both are one interface implementation
  away. Neither is listed in the contract until its driver works.
- Table grouping, and real CSV/Excel/PDF parsing in the file handler.

## Checks

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm run api:check
```

```bash
npm test
```

`api:check` diffs the contract against the last released copy and fails on
anything that would break a consumer — a removed field, a newly required
parameter, a dropped enum value. It also verifies every documented endpoint has
a route handler. Run it in CI as a required check; see
[`docs/api/versioning.md`](docs/api/versioning.md).

`npm test` covers the pure, security-sensitive logic under [`tests/`](tests):
the read-only SQL guard, row ceilings, cursor pagination, request validation,
and idempotency fingerprinting. These are the pieces where a silent regression
is expensive — a guard that stops rejecting `DELETE`, or a cursor that replays
rows — and they are all pure functions, so they need no database and no server.
Tests run on [`node:test`](https://nodejs.org/api/test.html) with
[`tsx`](https://tsx.is) as the TypeScript loader; the only test dependency is
`tsx`. Add a file as `tests/<subject>.test.ts` and it is picked up
automatically. Arguments pass through to the Node test runner:

```bash
npm test -- --test-name-pattern=cursor
```

All should pass. `npm run lint` emits one known warning: the React Compiler
skips memoizing `TableBlock` because TanStack Table is on its
incompatible-library list. That is expected and harmless.
