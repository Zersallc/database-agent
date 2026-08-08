/**
 * MySQL connector (also MariaDB and Cloud SQL for MySQL).
 *
 * `mysql2` is an optional dependency.
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

/** mysql2 reports column types as protocol constants; name the common ones. */
const TYPE_NAMES: Record<number, string> = {
  0: "decimal",
  1: "tinyint",
  2: "smallint",
  3: "int",
  4: "float",
  5: "double",
  7: "timestamp",
  8: "bigint",
  9: "mediumint",
  10: "date",
  11: "time",
  12: "datetime",
  13: "year",
  15: "varchar",
  16: "bit",
  245: "json",
  246: "decimal",
  252: "blob",
  253: "varchar",
  254: "char",
};

const INTROSPECTION_SQL = `
  SELECT c.TABLE_SCHEMA   AS table_schema,
         c.TABLE_NAME     AS table_name,
         c.COLUMN_NAME    AS column_name,
         c.COLUMN_TYPE    AS data_type,
         c.IS_NULLABLE    AS is_nullable,
         c.COLUMN_KEY     AS column_key,
         c.COLUMN_COMMENT AS column_comment,
         t.TABLE_COMMENT  AS table_comment,
         t.TABLE_ROWS     AS row_estimate
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
   WHERE c.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
   ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
`;

export class MySqlConnector implements DataSourceConnector {
  readonly engine = "mysql" as const;
  private connection: any = null;

  constructor(private readonly options: ConnectorOptions) {}

  private async connect(): Promise<any> {
    if (this.connection) return this.connection;
    const mod = await optionalModule("mysql2/promise", "MySQL connections");
    const createConnection = (mod.createConnection ?? (mod.default as any)?.createConnection) as (
      config: object
    ) => Promise<any>;
    const { credentials } = this.options;

    try {
      this.connection = await createConnection(
        credentials.dsn
          ? { uri: credentials.dsn }
          : {
              host: credentials.host,
              port: credentials.port ?? 3306,
              user: credentials.username,
              password: credentials.password,
              database: credentials.database,
              ...(credentials.ssl === false ? {} : { ssl: { rejectUnauthorized: false } }),
            }
      );
    } catch (cause) {
      this.connection = null;
      throw new ConnectorError(
        `Could not connect to MySQL: ${(cause as Error).message}`,
        this.engine,
        { cause }
      );
    }
    return this.connection;
  }

  async probe(): Promise<ProbeResult> {
    const started = performance.now();
    try {
      const connection = await this.connect();
      await connection.query("SELECT 1");
      return { ok: true, latency_ms: Math.round(performance.now() - started), detail: null };
    } catch (error) {
      return { ok: false, latency_ms: null, detail: (error as Error).message };
    }
  }

  async introspect(): Promise<SchemaTable[]> {
    const connection = await this.connect();
    const [rows] = await connection.query(INTROSPECTION_SQL);
    const tables = new Map<string, SchemaTable>();

    for (const row of rows as any[]) {
      const key = `${row.table_schema}.${row.table_name}`;
      let table = tables.get(key);
      if (!table) {
        table = {
          schema: row.table_schema,
          name: row.table_name,
          description: row.table_comment || null,
          row_estimate: row.row_estimate === null ? null : Number(row.row_estimate),
          columns: [],
        };
        tables.set(key, table);
      }
      table.columns.push({
        name: row.column_name,
        data_type: row.data_type,
        nullable: row.is_nullable === "YES",
        primary_key: row.column_key === "PRI",
        description: row.column_comment || null,
      });
    }

    return [...tables.values()];
  }

  async execute(
    sql: string,
    options: { timeoutMs?: number; maxRows?: number } = {}
  ): Promise<QueryResult> {
    const connection = await this.connect();
    const ceiling = options.maxRows ?? this.options.maxRows;
    const started = performance.now();

    try {
      const [rows, fields] = await connection.query({
        sql: applyRowCeiling(sql, ceiling + 1),
        rowsAsArray: true,
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      });

      const values = (rows as unknown[][]) ?? [];
      const truncated = values.length > ceiling;

      return {
        columns: ((fields as any[]) ?? []).map((field) => ({
          name: field.name,
          data_type: TYPE_NAMES[field.type] ?? null,
        })),
        rows: truncated ? values.slice(0, ceiling) : values,
        row_count: truncated ? ceiling : values.length,
        truncated,
        duration_ms: Math.round(performance.now() - started),
      };
    } catch (cause) {
      throw new ConnectorError((cause as Error).message, this.engine, { cause });
    }
  }

  async close(): Promise<void> {
    if (!this.connection) return;
    const connection = this.connection;
    this.connection = null;
    await connection.end().catch(() => {
      // The connection is being discarded either way.
    });
  }
}
