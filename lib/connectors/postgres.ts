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

/**
 * Tables and views the user actually owns.
 *
 * `pg_catalog` and `information_schema` are the obvious exclusions, but an
 * installed extension puts its own relations in ordinary schemas: on the client
 * database, `pg_stat_statements` and `pg_stat_statements_info` sit in `public`
 * beside the one real table. They are query-monitoring views, not data, and
 * they cost 357 of the 627 tokens the schema block spent on every request
 * (measured 9 September 2026) — more than the real table — while offering the
 * model 45 plausible column names it has no business querying.
 *
 * `pg_depend.deptype = 'e'` marks anything a `CREATE EXTENSION` brought with it,
 * whatever schema it landed in — but only its **views** are excluded here.
 * Extensions also ship reference data that a question legitimately needs:
 * PostGIS's `spatial_ref_sys` is an extension-owned table people join to for
 * SRID lookups, and hiding it would break real queries. Extension views are
 * monitoring and introspection; extension tables are often data. A relation the
 * schema's own designer created is never marked this way regardless of the
 * schema it sits in, so hand-built tables in `public` are untouched.
 */
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
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class ec
         JOIN pg_catalog.pg_namespace en ON en.oid = ec.relnamespace
         JOIN pg_catalog.pg_depend ed ON ed.objid = ec.oid AND ed.deptype = 'e'
        WHERE en.nspname = c.table_schema
          AND ec.relname = c.table_name
          AND ec.relkind IN ('v', 'm')
     )
   ORDER BY c.table_schema, c.table_name, c.ordinal_position
`;

/**
 * A column holding more distinct values than this is not a category and listing
 * it would spend the conversation's budget on a dictionary.
 */
const MAX_DISTINCT_VALUES = Number(process.env.SCHEMA_MAX_DISTINCT_VALUES ?? 40);

/** Long enough for a real category name, short enough that a stray essay cannot land in the prompt. */
const MAX_VALUE_LENGTH = 80;

/**
 * Where the values come from, and why not `SELECT DISTINCT`.
 *
 * `pg_stats` is the planner's own sample, already computed by ANALYZE. Reading
 * it costs one catalog query for the entire database and touches no table, so
 * this stays free on an instance where `SELECT DISTINCT` on thirty text columns
 * would be a visit to every heap page. It is also permission-aware: a role only
 * sees rows for tables it may read, so this cannot leak a column the connection
 * is not allowed to query.
 *
 * The cost is that it is a sample. `n_distinct` is an estimate, and
 * `most_common_vals` stops at the statistics target, so the list is treated as
 * complete only when it demonstrably covers every distinct value. A table that
 * has never been analysed simply yields nothing, which is the right failure:
 * silence rather than a confident half-list.
 */
const COLUMN_VALUES_SQL = `
  SELECT schemaname,
         tablename,
         attname,
         n_distinct,
         most_common_vals::text::text[] AS common_values
    FROM pg_stats
   WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
     AND most_common_vals IS NOT NULL
     AND n_distinct > 0
     AND n_distinct <= $1
`;

/** Only text-ish columns: a category is spelled, and a number or a date is not. */
function holdsText(dataType: string): boolean {
  return /char|text|citext|enum/i.test(dataType);
}

/**
 * Off switch for the whole feature, for a deployment that would rather send
 * nothing it did not have to.
 */
const VALUE_HINTS_ENABLED = process.env.SCHEMA_VALUE_HINTS !== "off";

/** Words that say a column holds people rather than categories. */
const PERSON_WORDS =
  /\b(?:person|people|employee|staff|author|owner|assignee|responsible|manager|management|supervisor|superintendent|contact|customer|client|patient|user|username|member|driver|operator|technician|recipient|requester|reporter|approver|signature)\b/;

/** Words that say a column holds a way to reach someone. */
const CONTACT_WORDS = /\b(?:email|mail|phone|mobile|telephone|tel|fax|address)\b/;

/** "Created by", "Last edited by" — an audit column is a column of people. */
const ATTRIBUTION = /\b(?:created|edited|updated|modified|submitted|reported|approved|assigned|reviewed|closed|raised)\s+by\b/;

/** A column called "Name", but not "Hospital Name" or "Category Name". */
const BARE_NAME = /^(?:full |first |last |middle |given |sur)?name$/;

/**
 * Does this column's *name* say it holds people?
 *
 * The shape check below catches an address or a phone number by looking at the
 * value. It cannot catch a personal name, because "Zohir Kelkouli" and
 * "Electrical Hazards" are the same shape — two capitalised words. So the
 * column name is the only signal left, and it is read conservatively: this
 * errs towards dropping a column that would have been useful, because the
 * alternative errs towards putting a staff list in front of every question
 * anyone asks.
 *
 * That cost is real and worth naming: "Department Responsible" probably holds
 * departments, and it is dropped anyway, because "responsible" is not a word
 * this can afford to read optimistically.
 */
export function namesPeople(columnName: string): boolean {
  const normalized = columnName.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return (
    PERSON_WORDS.test(normalized) ||
    CONTACT_WORDS.test(normalized) ||
    ATTRIBUTION.test(normalized) ||
    BARE_NAME.test(normalized)
  );
}

/** An address, a number to call, a URL, a file path. */
const IDENTIFIER_SHAPES = [
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/, // email
  /^\+?[\d][\d\s()-]{6,}$/, // phone
  /^[a-z][a-z\d+.-]*:\/\//i, // url
  /^[/\\]|^[a-z]:[/\\]/i, // path
];

/**
 * Is this column a set of categories, or a list of people and contact details?
 *
 * Both are low-cardinality text, and only one of them belongs in a prompt that
 * is sent on every turn. A category is worth naming because the reader will
 * ask for it by an approximate name; an address or a phone number is never
 * something the reader needs spelled for them, so including it would widen what
 * leaves this system for no benefit at all.
 *
 * This catches the mechanical shapes only. Personal *names* are indistinguishable
 * from category names to a regular expression, and are deliberately left to the
 * column allow/deny list rather than guessed at here.
 */
export function looksLikeIdentifiers(values: string[]): boolean {
  const matches = values.filter((value) =>
    IDENTIFIER_SHAPES.some((shape) => shape.test(value.trim()))
  );
  return matches.length * 3 >= values.length;
}

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

    await this.attachColumnValues(client, tables);
    return [...tables.values()];
  }

  /**
   * Best-effort by design. Statistics may be missing, the view may be
   * restricted, or the cast may not survive an exotic type — and none of that
   * is worth failing an introspection over, because the schema without value
   * hints is exactly what this connector returned before them.
   */
  private async attachColumnValues(client: any, tables: Map<string, SchemaTable>): Promise<void> {
    if (!VALUE_HINTS_ENABLED) return;

    let rows: any[];
    try {
      const result = await client.query(COLUMN_VALUES_SQL, [MAX_DISTINCT_VALUES]);
      rows = result.rows;
    } catch {
      return;
    }

    for (const row of rows) {
      const table = tables.get(`${row.schemaname}.${row.tablename}`);
      const column = table?.columns.find((c) => c.name === row.attname);
      if (!column || !holdsText(column.data_type) || namesPeople(column.name)) continue;

      const values: string[] = (row.common_values ?? [])
        .filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
        .map((value: string) =>
          value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value
        );
      if (values.length === 0 || looksLikeIdentifiers(values)) continue;

      // `n_distinct` counts every value; `most_common_vals` stops at the
      // statistics target. Claiming "one of these" is only honest when the
      // sample demonstrably reached the whole set.
      column.distinct_values = {
        list: values,
        complete: values.length >= Number(row.n_distinct),
      };
    }
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
