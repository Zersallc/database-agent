/**
 * The connector interface.
 *
 * "Other DBs" is not a future feature, it is the starting condition: a workspace
 * has a Postgres primary, a BigQuery warehouse, and a MySQL staging box, and the
 * agent has to answer questions across all of them. So the agent, the query
 * endpoint, and the schema endpoint all speak this interface and none of them
 * know which engine they are talking to.
 *
 * Adding an engine means implementing this and registering it. Nothing else in
 * the codebase changes.
 */

/**
 * Engines with a shipped connector.
 *
 * This list is also an API enum, which makes it asymmetric: adding a value is a
 * safe, additive change, and removing one breaks every client that pinned it.
 * So an engine appears here when its connector works, never before.
 */
export type Engine = "postgres" | "mysql" | "bigquery" | "demo";

/**
 * Credentials as supplied by the caller. Read from the secret store at the
 * moment of use and never held longer than a request.
 */
export type Credentials = {
  dsn?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  project_id?: string;
  service_account_json?: string;
  ssl?: boolean;
};

export type ConnectorOptions = {
  credentials: Credentials;
  /** Hard ceiling on returned rows. The connector applies it; it is not advisory. */
  maxRows: number;
  /**
   * When false, statements that are not provably read-only are rejected before
   * they reach the database.
   */
  allowWrites: boolean;
  defaultSchema?: string | null;
};

export type ColumnMeta = {
  name: string;
  data_type: string | null;
};

export type QueryResult = {
  columns: ColumnMeta[];
  /** Values in column order. */
  rows: unknown[][];
  row_count: number;
  /** True when the result hit `maxRows` and more rows exist. */
  truncated: boolean;
  duration_ms: number;
};

export type SchemaColumn = {
  name: string;
  data_type: string;
  nullable: boolean;
  primary_key: boolean;
  description: string | null;
};

export type SchemaTable = {
  schema: string | null;
  name: string;
  description: string | null;
  row_estimate: number | null;
  columns: SchemaColumn[];
};

export type ProbeResult = {
  ok: boolean;
  latency_ms: number | null;
  detail: string | null;
};

export interface DataSourceConnector {
  readonly engine: Engine;
  /** Cheap round trip used by `/connections/{id}/test` and health checks. */
  probe(): Promise<ProbeResult>;
  /** Tables and columns, in the shape the agent reads before writing SQL. */
  introspect(): Promise<SchemaTable[]>;
  execute(sql: string, options?: { timeoutMs?: number; maxRows?: number }): Promise<QueryResult>;
  /** Releases pooled handles. Always called in a finally block. */
  close(): Promise<void>;
}

/**
 * A failure that came from the database rather than from us. Carried separately
 * so the API can return a 502 with the engine's own message — which is the thing
 * the person debugging actually needs — instead of a generic 500.
 */
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly engine: Engine,
    options: { cause?: unknown } = {}
  ) {
    super(message, options);
    this.name = "ConnectorError";
  }
}
