/**
 * Connector registry.
 *
 * One place that knows which engines exist. Everything else asks for a
 * connector by engine name and gets something that satisfies the interface.
 */

import { ApiError } from "@/lib/api/errors";
import { MissingModuleError } from "@/lib/providers/optional-module";
import { BigQueryConnector } from "./bigquery";
import { DemoConnector } from "./demo";
import { MySqlConnector } from "./mysql";
import { PostgresConnector } from "./postgres";
import type { ConnectorOptions, DataSourceConnector, Engine } from "./types";
import { ConnectorError } from "./types";

type Factory = (options: ConnectorOptions) => DataSourceConnector;

const REGISTRY: Record<Engine, Factory> = {
  postgres: (options) => new PostgresConnector(options),
  mysql: (options) => new MySqlConnector(options),
  bigquery: (options) => new BigQueryConnector(options),
  demo: (options) => new DemoConnector(options),
};

export const SUPPORTED_ENGINES = Object.keys(REGISTRY) as Engine[];

export function isSupportedEngine(engine: string): engine is Engine {
  return engine in REGISTRY;
}

export function createConnector(engine: Engine, options: ConnectorOptions): DataSourceConnector {
  const factory = REGISTRY[engine];
  if (!factory) {
    throw new ApiError(
      "invalid_request",
      `No connector for engine '${engine}'. Supported engines: ${SUPPORTED_ENGINES.join(", ")}.`
    );
  }
  return factory(options);
}

/**
 * Runs `work` with a connector and always closes it.
 *
 * Connectors hold sockets. Leaking one per request exhausts the database's
 * connection limit long before it exhausts ours, which shows up as an outage
 * for everything else pointed at that database — not just for us.
 */
export async function withConnector<T>(
  engine: Engine,
  options: ConnectorOptions,
  work: (connector: DataSourceConnector) => Promise<T>
): Promise<T> {
  const connector = createConnector(engine, options);
  try {
    return await work(connector);
  } catch (error) {
    throw translateConnectorError(error);
  } finally {
    await connector.close().catch(() => {
      // Closing is best effort; the request outcome is already decided.
    });
  }
}

/**
 * Maps driver failures onto the API's error contract.
 *
 * A database that rejected the query is a 502 with the engine's own message,
 * because that message is the single most useful thing we can give the person
 * debugging. A missing driver package is a 503 with install instructions,
 * because that is an operator problem, not a caller problem.
 */
export function translateConnectorError(error: unknown): unknown {
  if (error instanceof MissingModuleError) {
    return new ApiError("provider_unavailable", error.message, {
      details: { module: error.moduleName },
      cause: error,
    });
  }
  if (error instanceof ConnectorError) {
    return new ApiError("upstream_database_error", error.message, {
      details: { engine: error.engine },
      cause: error,
    });
  }
  return error;
}

export type {
  ColumnMeta,
  ConnectorOptions,
  Credentials,
  DataSourceConnector,
  Engine,
  ProbeResult,
  QueryResult,
  SchemaColumn,
  SchemaTable,
} from "./types";
export { ConnectorError } from "./types";
