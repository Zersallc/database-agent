/**
 * BigQuery connector.
 *
 * The warehouse most of these workspaces actually point at, and the one where
 * cost discipline matters most: BigQuery bills by bytes scanned, so a careless
 * agent query is not just slow, it is expensive. `maximumBytesBilled` is set on
 * every job so a runaway query fails cheaply instead of succeeding expensively.
 *
 * Authentication is Application Default Credentials unless the connection
 * carries an explicit service account, which is the normal case for a tenant
 * whose warehouse lives in a different Google Cloud project than this service.
 */

import { optionalModule } from "@/lib/providers/optional-module";
import type {
  ConnectorOptions,
  DataSourceConnector,
  ProbeResult,
  QueryResult,
  SchemaTable,
} from "./types";
import { ConnectorError } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the driver is loaded at runtime */

/** Default ceiling on bytes billed per query: 1 GiB unless the deployment says otherwise. */
function maximumBytesBilled(): string {
  return process.env.BIGQUERY_MAX_BYTES_BILLED ?? String(1024 * 1024 * 1024);
}

export class BigQueryConnector implements DataSourceConnector {
  readonly engine = "bigquery" as const;
  private client: any = null;

  constructor(private readonly options: ConnectorOptions) {}

  private async connect(): Promise<any> {
    if (this.client) return this.client;
    const mod = await optionalModule("@google-cloud/bigquery", "BigQuery connections");
    const BigQuery = mod.BigQuery as new (config: object) => any;
    const { credentials } = this.options;

    let serviceAccount: object | undefined;
    if (credentials.service_account_json) {
      try {
        serviceAccount = JSON.parse(credentials.service_account_json);
      } catch (cause) {
        throw new ConnectorError(
          "The stored service account JSON for this connection is not valid JSON.",
          this.engine,
          { cause }
        );
      }
    }

    this.client = new BigQuery({
      ...(credentials.project_id ? { projectId: credentials.project_id } : {}),
      ...(serviceAccount ? { credentials: serviceAccount } : {}),
    });
    return this.client;
  }

  async probe(): Promise<ProbeResult> {
    const started = performance.now();
    try {
      const client = await this.connect();
      // A dry run costs nothing and still proves credentials and project access.
      await client.createQueryJob({ query: "SELECT 1", dryRun: true });
      return { ok: true, latency_ms: Math.round(performance.now() - started), detail: null };
    } catch (error) {
      return { ok: false, latency_ms: null, detail: (error as Error).message };
    }
  }

  async introspect(): Promise<SchemaTable[]> {
    const client = await this.connect();
    const tables: SchemaTable[] = [];

    try {
      const [datasets] = await client.getDatasets();
      const wanted = this.options.defaultSchema;

      for (const dataset of datasets as any[]) {
        if (wanted && dataset.id !== wanted) continue;
        const [datasetTables] = await dataset.getTables();
        for (const table of datasetTables as any[]) {
          const [metadata] = await table.getMetadata();
          tables.push({
            schema: dataset.id,
            name: table.id,
            description: metadata.description ?? null,
            row_estimate: metadata.numRows === undefined ? null : Number(metadata.numRows),
            columns: (metadata.schema?.fields ?? []).map((field: any) => ({
              name: field.name,
              data_type: field.type,
              nullable: field.mode !== "REQUIRED",
              primary_key: false,
              description: field.description ?? null,
            })),
          });
        }
      }
    } catch (cause) {
      throw new ConnectorError(
        `Could not read the BigQuery schema: ${(cause as Error).message}`,
        this.engine,
        { cause }
      );
    }

    return tables;
  }

  async execute(
    sql: string,
    options: { timeoutMs?: number; maxRows?: number } = {}
  ): Promise<QueryResult> {
    const client = await this.connect();
    const ceiling = options.maxRows ?? this.options.maxRows;
    const started = performance.now();

    try {
      const [job] = await client.createQueryJob({
        query: sql,
        maximumBytesBilled: maximumBytesBilled(),
        ...(options.timeoutMs ? { jobTimeoutMs: String(Math.floor(options.timeoutMs)) } : {}),
        ...(this.options.defaultSchema ? { defaultDataset: { datasetId: this.options.defaultSchema } } : {}),
      });

      // One past the ceiling, so `truncated` reflects reality.
      const [rows] = await job.getQueryResults({ maxResults: ceiling + 1 });
      const [metadata] = await job.getMetadata();
      const fields = (metadata.configuration?.query?.destinationTable
        ? metadata.statistics?.query?.schema?.fields
        : undefined) ?? (await job.getQueryResults({ maxResults: 0 }))[2]?.schema?.fields ?? [];

      const names: string[] = fields.length
        ? fields.map((field: any) => field.name)
        : Object.keys((rows as any[])[0] ?? {});

      const values = (rows as Record<string, unknown>[]).map((row) =>
        names.map((name) => normalize(row[name]))
      );
      const truncated = values.length > ceiling;

      return {
        columns: names.map((name, index) => ({
          name,
          data_type: fields[index]?.type ?? null,
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
    this.client = null;
  }
}

/**
 * BigQuery wraps some scalars in objects — `BigQueryDate`, `BigQueryTimestamp`,
 * `Big` for NUMERIC. Unwrap them so the API returns JSON values a client can
 * use rather than driver internals.
 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null && "value" in value) {
    return (value as { value: unknown }).value;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}
