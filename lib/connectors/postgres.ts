/**
 * PostgreSQL connector (also covers Cloud SQL, AlloyDB, Redshift-compatible
 * endpoints, and anything else that speaks the wire protocol).
 *
 * `pg` is an optional dependency: a deployment that never attaches a Postgres
 * database should not have to install a Postgres driver.
 */

import { optionalModule } from "@/lib/providers/optional-module";
import { applyRowCeiling } from "./limits";
import type {
  ConnectorOptions,
  DataSourceConnector,
  ProbeResult,
  QueryResult,
  SchemaTable,
} from "./types";
import { ConnectorError } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the driver is loaded at runtime */

/**
 * The OIDs worth naming. `pg` reports column types as numeric OIDs, and a bare
 * number in an API response is useless to a caller; anything unmapped comes
 * back as null rather than a lie.
 */
const TYPE_NAMES: Record<number, string> = {
  16: "boolean",
  20: "bigint",
  21: "smallint",
  23: "integer",
  25: "text",
  700: "real",
  701: "double precision",
  1042: "char",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  1700: "numeric",
  2950: "uuid",
  114: "json",
  3802: "jsonb",
};

const INTROSPECTION_SQL = `
  SELECT c.table_schema,
         c.table_name,
         c.column_name,
         c.data_type,
         c.is_nullable,
         COALESCE(pk.is_primary, false) AS is_primary,
         obj.description AS table_comment,
         col.description AS column_comment
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    LEFT JOIN (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name, true AS is_primary
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.table_schema = c.table_schema
        AND pk.table_name = c.table_name
        AND pk.column_name = c.column_name
    LEFT JOIN pg_catalog.pg_class cls
      ON cls.relname = c.table_name
    LEFT JOIN pg_catalog.pg_description obj
      ON obj.objoid = cls.oid AND obj.objsubid = 0
    LEFT JOIN pg_catalog.pg_description col
      ON col.objoid = cls.oid
     AND col.objsubid = c.ordinal_position
   WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
     AND t.table_type IN ('BASE TABLE', 'VIEW')
   ORDER BY c.table_schema, c.table_name, c.ordinal_position
`;

export class PostgresConnector implements DataSourceConnector {
  readonly engine = "postgres" as const;
  private client: any = null;

  constructor(private readonly options: ConnectorOptions) {}

  private async connect(): Promise<any> {
    if (this.client) return this.client;
    const mod = await optionalModule("pg", "PostgreSQL connections");
    const Client = (mod.default as any)?.Client ?? (mod.Client as any);
    const { credentials } = this.options;

    this.client = new Client(
      credentials.dsn
        ? { connectionString: credentials.dsn, ssl: credentials.ssl === false ? false : { rejectUnauthorized: false } }
        : {
            host: credentials.host,
            port: credentials.port ?? 5432,
            user: credentials.username,
            password: credentials.password,
            database: credentials.database,
            ssl: credentials.ssl === false ? false : { rejectUnauthorized: false },
          }
    );

    try {
      await this.client.connect();
    } catch (cause) {
      this.client = null;
      throw new ConnectorError(
        `Could not connect to PostgreSQL: ${(cause as Error).message}`,
        this.engine,
        { cause }
      );
    }
    return this.client;
  }

  async probe(): Promise<ProbeResult> {
    const started = performance.now();
    try {
      const client = await this.connect();
      await client.query("SELECT 1");
      return { ok: true, latency_ms: Math.round(performance.now() - started), detail: null };
    } catch (error) {
      return { ok: false, latency_ms: null, detail: (error as Error).message };
    }
  }

  async introspect(): Promise<SchemaTable[]> {
    const client = await this.connect();
    const result = await client.query(INTROSPECTION_SQL);
    const tables = new Map<string, SchemaTable>();

    for (const row of result.rows as any[]) {
      const key = `${row.table_schema}.${row.table_name}`;
      let table = tables.get(key);
      if (!table) {
        table = {
          schema: row.table_schema,
          name: row.table_name,
          description: row.table_comment ?? null,
          row_estimate: null,
          columns: [],
        };
        tables.set(key, table);
      }
      table.columns.push({
        name: row.column_name,
        data_type: row.data_type,
        nullable: row.is_nullable === "YES",
        primary_key: Boolean(row.is_primary),
        description: row.column_comment ?? null,
      });
    }

    return [...tables.values()];
  }

  async execute(
    sql: string,
    options: { timeoutMs?: number; maxRows?: number } = {}
  ): Promise<QueryResult> {
    const client = await this.connect();
    const ceiling = options.maxRows ?? this.options.maxRows;
    const started = performance.now();

    try {
      // A server-side timeout, not just a client one: without it a runaway
      // query keeps burning database CPU after we have given up on it.
      if (options.timeoutMs) {
        await client.query(`SET LOCAL statement_timeout = ${Math.floor(options.timeoutMs)}`);
      }

      // Ask for one row past the ceiling so we can say `truncated: true`
      // honestly rather than guessing from a full result.
      const result = await client.query({
        text: applyRowCeiling(sql, ceiling + 1),
        rowMode: "array",
      });

      const rows = result.rows as unknown[][];
      const truncated = rows.length > ceiling;

      return {
        columns: (result.fields as any[]).map((field) => ({
          name: field.name,
          data_type: TYPE_NAMES[field.dataTypeID] ?? null,
        })),
        rows: truncated ? rows.slice(0, ceiling) : rows,
        row_count: truncated ? ceiling : rows.length,
        truncated,
        duration_ms: Math.round(performance.now() - started),
      };
    } catch (cause) {
      throw new ConnectorError((cause as Error).message, this.engine, { cause });
    }
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await client.end().catch(() => {
      // The connection is being discarded either way.
    });
  }
}
