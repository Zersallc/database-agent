# Database Agent

An AI-powered database analysis workspace. Instead of a static KPI dashboard,
users ask questions in a chat interface and the agent answers with tables,
charts, SQL, diagrams and reports drawn from connected databases.

**This branch is frontend only.** There is no backend, database or LLM wired up
yet — `/api/chat` returns a fixed demo response that exercises every renderer, and
the SQL "Execute" button runs a local mock that fabricates plausible rows.

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
Customer → Vercel (React + Next.js frontend) → Google Cloud backend
                                                 ├── AI agents
                                                 ├── Database connections
                                                 ├── Analytics engine
                                                 └── Processing services
```

Only the left half of that diagram exists today.

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
app/                      routes; api/chat is the mock response endpoint
components/app-shell/     sidebar, connection switcher, shell composition
components/chat/          chat workspace, composer, message bubbles, dispatcher
components/chat/blocks/   one component per content handler
components/ui/            shadcn/ui primitives
components/theme/         color-scheme script and toggle
lib/workspace-store.ts    mock conversation + connection state
hooks/                    color-scheme and viewport hooks
```

## Not built yet

Real database connections, agent/LLM integration, auth and tenant isolation,
response streaming, table grouping, and real CSV/Excel/PDF parsing in the file
handler.

## Checks

```bash
npm run lint
```

```bash
npm run build
```

Both should pass. `npm run lint` emits one known warning: the React Compiler
skips memoizing `TableBlock` because TanStack Table is on its
incompatible-library list. That is expected and harmless.
