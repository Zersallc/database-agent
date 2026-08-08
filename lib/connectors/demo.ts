/**
 * The demo connector.
 *
 * A new workspace has no database attached, and an empty product teaches you
 * nothing. This connector gives every deployment one connection that answers
 * immediately: a fixed, realistic schema and deterministic fabricated rows.
 *
 * It is a fixture, not a database. Results are generated from the shape of the
 * query and a seed derived from its text — stable across runs, so a demo is
 * reproducible, and obviously synthetic, so nobody mistakes it for their data.
 * Every response the agent builds on it is labelled as sample data.
 */

import type {
  ConnectorOptions,
  DataSourceConnector,
  ProbeResult,
  QueryResult,
  SchemaTable,
} from "./types";

const SCHEMA: SchemaTable[] = [
  {
    schema: "public",
    name: "customers",
    description: "One row per customer account.",
    row_estimate: 4820,
    columns: [
      { name: "customer_id", data_type: "bigint", nullable: false, primary_key: true, description: null },
      { name: "name", data_type: "text", nullable: false, primary_key: false, description: null },
      { name: "region", data_type: "text", nullable: true, primary_key: false, description: "ISO country code." },
      { name: "plan", data_type: "text", nullable: false, primary_key: false, description: "free, pro, or enterprise." },
      { name: "is_internal", data_type: "boolean", nullable: false, primary_key: false, description: "Exclude from revenue figures." },
      { name: "created_at", data_type: "timestamptz", nullable: false, primary_key: false, description: null },
    ],
  },
  {
    schema: "public",
    name: "orders",
    description: "One row per completed order.",
    row_estimate: 91240,
    columns: [
      { name: "order_id", data_type: "bigint", nullable: false, primary_key: true, description: null },
      { name: "customer_id", data_type: "bigint", nullable: false, primary_key: false, description: "References customers.customer_id." },
      { name: "amount", data_type: "integer", nullable: false, primary_key: false, description: "Cents, not dollars." },
      { name: "status", data_type: "text", nullable: false, primary_key: false, description: "pending, paid, refunded." },
      { name: "created_at", data_type: "timestamptz", nullable: false, primary_key: false, description: null },
    ],
  },
  {
    schema: "public",
    name: "subscriptions",
    description: "Active and cancelled subscriptions.",
    row_estimate: 5130,
    columns: [
      { name: "subscription_id", data_type: "bigint", nullable: false, primary_key: true, description: null },
      { name: "customer_id", data_type: "bigint", nullable: false, primary_key: false, description: null },
      { name: "monthly_amount", data_type: "integer", nullable: false, primary_key: false, description: "Cents." },
      { name: "status", data_type: "text", nullable: false, primary_key: false, description: "active or cancelled." },
      { name: "started_at", data_type: "timestamptz", nullable: false, primary_key: false, description: null },
      { name: "cancelled_at", data_type: "timestamptz", nullable: true, primary_key: false, description: null },
    ],
  },
  {
    schema: "public",
    name: "events",
    description: "Product usage events, partitioned by day. Always filter on event_date.",
    row_estimate: 18400000,
    columns: [
      { name: "event_id", data_type: "uuid", nullable: false, primary_key: true, description: null },
      { name: "customer_id", data_type: "bigint", nullable: true, primary_key: false, description: null },
      { name: "event_name", data_type: "text", nullable: false, primary_key: false, description: null },
      { name: "event_date", data_type: "date", nullable: false, primary_key: false, description: "Partition key." },
    ],
  },
];

const REGIONS = ["US", "GB", "DE", "FR", "JP", "BR", "CA", "AU"];
const PLANS = ["free", "pro", "enterprise"];
const STATUSES = ["paid", "pending", "refunded"];
const NAMES = [
  "Northwind Trading",
  "Acme Analytics",
  "Blue Harbor Ltd",
  "Meridian Labs",
  "Copperline Co",
  "Vantage Systems",
  "Harbour & Co",
  "Lantern Digital",
];

/** Deterministic PRNG (mulberry32) so the same SQL always yields the same rows. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Pulls output column names out of the SELECT list.
 *
 * A real parser would be better and is not warranted — this only has to make
 * the demo's column headers match what was asked for.
 */
function inferColumns(sql: string): string[] {
  const match = /select\s+([\s\S]+?)\s+from\s/i.exec(`${sql} `);
  if (!match) return ["result"];

  const selectList = match[1].replace(/\bdistinct\b/i, "").trim();
  if (selectList === "*") return ["customer_id", "name", "region", "plan", "created_at"];

  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selectList) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts
    .map((part) => {
      const trimmed = part.trim();
      const aliased = /\s+as\s+([a-z0-9_"`]+)\s*$/i.exec(trimmed);
      if (aliased) return aliased[1].replace(/["`]/g, "");
      const tail = trimmed.split(/[\s.]+/).pop() ?? trimmed;
      return tail.replace(/[()"`*]/g, "") || "value";
    })
    .filter(Boolean);
}

function valueFor(column: string, random: () => number, index: number): unknown {
  const name = column.toLowerCase();
  if (/(^|_)id$/.test(name)) return 1000 + index;
  if (name.includes("name")) return NAMES[Math.floor(random() * NAMES.length)];
  if (name.includes("region") || name.includes("country")) {
    return REGIONS[Math.floor(random() * REGIONS.length)];
  }
  if (name.includes("plan") || name.includes("tier")) {
    return PLANS[Math.floor(random() * PLANS.length)];
  }
  if (name.includes("status")) return STATUSES[Math.floor(random() * STATUSES.length)];
  if (name.includes("date") || name.includes("_at")) {
    const daysAgo = Math.floor(random() * 90);
    return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  }
  if (name.includes("revenue") || name.includes("amount") || name.includes("mrr")) {
    return Math.round(random() * 500000) / 100;
  }
  if (name.includes("count") || name.includes("customers") || name.includes("total")) {
    return Math.floor(random() * 5000);
  }
  if (name.includes("rate") || name.includes("pct") || name.includes("percent")) {
    return Math.round(random() * 10000) / 100;
  }
  return Math.round(random() * 1000);
}

export class DemoConnector implements DataSourceConnector {
  readonly engine = "demo" as const;

  constructor(private readonly options: ConnectorOptions) {}

  async probe(): Promise<ProbeResult> {
    return { ok: true, latency_ms: 1, detail: "Sample dataset — no external database." };
  }

  async introspect(): Promise<SchemaTable[]> {
    return structuredClone(SCHEMA);
  }

  async execute(sql: string, options: { maxRows?: number } = {}): Promise<QueryResult> {
    const started = performance.now();
    const random = seededRandom(hash(sql));
    const names = inferColumns(sql);

    const limitMatch = /\blimit\s+(\d+)/i.exec(sql);
    const requested = limitMatch ? Number(limitMatch[1]) : 8 + Math.floor(random() * 12);
    const ceiling = options.maxRows ?? this.options.maxRows;
    const count = Math.min(requested, ceiling);

    const rows = Array.from({ length: count }, (_, index) =>
      names.map((name) => valueFor(name, random, index))
    );

    return {
      columns: names.map((name) => ({ name, data_type: null })),
      rows,
      row_count: rows.length,
      truncated: requested > ceiling,
      duration_ms: Math.max(1, Math.round(performance.now() - started)),
    };
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}
