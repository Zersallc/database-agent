#!/usr/bin/env node
/**
 * Blocks breaking API changes in CI.
 *
 * A published API is a contract you cannot silently break. Code review is not a
 * reliable place to catch "this field became required" or "this enum value went
 * away" — those look like one-line diffs and read as harmless. So the check is
 * mechanical: diff the working spec against the last released one and fail on
 * anything that would break a consumer's working code.
 *
 * Usage:
 *   node scripts/check-api-compat.mjs            # compare and report
 *   node scripts/check-api-compat.mjs --release  # accept current as the baseline
 *
 * Accepting a new baseline is the deliberate act that says "this shipped".
 * When a change genuinely has to break, bump the major version in the path,
 * publish the migration guide, then re-baseline — see docs/api/versioning.md.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const CURRENT = join(here, "..", "openapi", "v1.yaml");
const RELEASED = join(here, "..", "openapi", "v1.released.yaml");
const ROUTES_ROOT = join(here, "..", "app", "api");

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function load(path) {
  return yaml.load(readFileSync(path, "utf8"));
}

/** Resolves local `$ref`s so two specs can be compared structurally. */
function resolve(node, root, seen = new Set()) {
  if (Array.isArray(node)) return node.map((item) => resolve(item, root, seen));
  if (!node || typeof node !== "object") return node;

  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return {};
    const target = node.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((acc, key) => acc?.[key], root);
    return resolve(target, root, new Set([...seen, node.$ref]));
  }

  // `allOf` is how the spec composes the list envelope with its item type.
  // Flattening it lets the comparison see the merged shape.
  if (Array.isArray(node.allOf)) {
    const { allOf, ...rest } = node;
    return allOf
      .map((entry) => resolve(entry, root, seen))
      .reduce(
        (merged, entry) => ({
          ...merged,
          ...entry,
          properties: { ...(merged.properties ?? {}), ...(entry.properties ?? {}) },
          required: [...new Set([...(merged.required ?? []), ...(entry.required ?? [])])],
        }),
        resolve(rest, root, seen)
      );
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, resolve(value, root, seen)])
  );
}

function typeOf(schema) {
  if (!schema?.type) return null;
  // `type: [string, "null"]` is how the spec spells a nullable field. Order is
  // not meaningful, so normalize before comparing.
  return Array.isArray(schema.type) ? [...schema.type].sort().join("|") : String(schema.type);
}

const breaking = [];
const additive = [];

function breaks(where, message) {
  breaking.push(`${where}: ${message}`);
}

function adds(where, message) {
  additive.push(`${where}: ${message}`);
}

/** Recursively compares a schema pair. */
function compareSchema(where, before, after) {
  if (!before || typeof before !== "object") return;

  if (!after || typeof after !== "object") {
    breaks(where, "schema was removed");
    return;
  }

  const beforeType = typeOf(before);
  const afterType = typeOf(after);
  if (beforeType && afterType && beforeType !== afterType) {
    breaks(where, `type changed from '${beforeType}' to '${afterType}'`);
  }

  if (Array.isArray(before.enum)) {
    const afterEnum = new Set(after.enum ?? []);
    for (const value of before.enum) {
      if (!afterEnum.has(value)) {
        breaks(where, `enum value '${value}' was removed`);
      }
    }
    for (const value of after.enum ?? []) {
      if (!before.enum.includes(value)) {
        adds(where, `enum value '${value}' was added — clients must tolerate unknown values`);
      }
    }
  }

  const beforeRequired = new Set(before.required ?? []);
  for (const field of after.required ?? []) {
    if (!beforeRequired.has(field)) {
      breaks(where, `'${field}' became required`);
    }
  }

  for (const [name, schema] of Object.entries(before.properties ?? {})) {
    const next = after.properties?.[name];
    if (!next) {
      breaks(where, `property '${name}' was removed`);
      continue;
    }
    compareSchema(`${where}.${name}`, schema, next);
  }

  for (const name of Object.keys(after.properties ?? {})) {
    if (!before.properties?.[name]) {
      adds(where, `property '${name}' was added`);
    }
  }

  if (before.items) compareSchema(`${where}[]`, before.items, after.items);
}

function operationsOf(spec) {
  const operations = new Map();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const shared = item.parameters ?? [];
    for (const method of METHODS) {
      if (!item[method]) continue;
      operations.set(`${method.toUpperCase()} ${path}`, {
        ...item[method],
        parameters: [...shared, ...(item[method].parameters ?? [])],
      });
    }
  }
  return operations;
}

function bodySchema(operation) {
  return operation.requestBody?.content?.["application/json"]?.schema ?? null;
}

function responseSchema(response) {
  return response?.content?.["application/json"]?.schema ?? null;
}

function compare(beforeSpec, afterSpec) {
  const before = operationsOf(resolve(beforeSpec, beforeSpec));
  const after = operationsOf(resolve(afterSpec, afterSpec));

  for (const [key, operation] of before) {
    const next = after.get(key);
    if (!next) {
      breaks(key, "endpoint was removed");
      continue;
    }

    const nextParams = new Map((next.parameters ?? []).map((p) => [`${p.in}:${p.name}`, p]));
    for (const parameter of operation.parameters ?? []) {
      const id = `${parameter.in}:${parameter.name}`;
      const match = nextParams.get(id);
      if (!match) {
        breaks(key, `parameter '${parameter.name}' (${parameter.in}) was removed`);
        continue;
      }
      if (!parameter.required && match.required) {
        breaks(key, `parameter '${parameter.name}' became required`);
      }
      compareSchema(`${key} param ${parameter.name}`, parameter.schema, match.schema);
    }
    for (const [id, parameter] of nextParams) {
      if (!(operation.parameters ?? []).some((p) => `${p.in}:${p.name}` === id) && parameter.required) {
        breaks(key, `new required parameter '${parameter.name}' (${parameter.in})`);
      }
    }

    compareSchema(`${key} request`, bodySchema(operation), bodySchema(next));

    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const nextResponse = next.responses?.[status];
      if (!nextResponse) {
        breaks(key, `response status '${status}' was removed`);
        continue;
      }
      compareSchema(`${key} ${status}`, responseSchema(response), responseSchema(nextResponse));
    }
  }

  for (const key of after.keys()) {
    if (!before.has(key)) adds(key, "endpoint was added");
  }
}

/**
 * Confirms every documented path has a route file.
 *
 * Spec drift runs both ways: an endpoint documented but never built is a
 * promise to an integrator that 404s.
 */
function checkRoutesExist(spec) {
  const missing = [];
  for (const path of Object.keys(spec.paths ?? {})) {
    const segments = path
      .replace(/^\//, "")
      .split("/")
      .map((segment) => segment.replace(/^\{(.+)\}$/, "[$1]"));
    const file = join(ROUTES_ROOT, ...segments, "route.ts");
    if (!existsSync(file)) missing.push(`${path} -> ${file.replace(join(here, ".."), ".")}`);
  }
  return missing;
}

// ---------------------------------------------------------------------------

const current = load(CURRENT);

if (process.argv.includes("--release")) {
  writeFileSync(RELEASED, readFileSync(CURRENT));
  console.log(`Baseline updated: openapi/v1.released.yaml now matches v1.yaml (${current.info.version}).`);
  process.exit(0);
}

const missingRoutes = checkRoutesExist(current);

if (!existsSync(RELEASED)) {
  console.log("No released baseline yet. Run with --release to create one.");
  if (missingRoutes.length) {
    console.error("\nDocumented endpoints with no route handler:");
    for (const entry of missingRoutes) console.error(`  - ${entry}`);
    process.exit(1);
  }
  process.exit(0);
}

compare(load(RELEASED), current);

if (additive.length) {
  console.log(`Additive changes (safe, ship within v1) — ${additive.length}:`);
  for (const entry of additive) console.log(`  + ${entry}`);
  console.log("");
}

if (missingRoutes.length) {
  console.error("Documented endpoints with no route handler:");
  for (const entry of missingRoutes) console.error(`  - ${entry}`);
  console.error("");
}

if (breaking.length) {
  console.error(`BREAKING changes — ${breaking.length}:`);
  for (const entry of breaking) console.error(`  ! ${entry}`);
  console.error(
    "\nThese break working consumer code. Ship them as /v2 with a migration guide and a" +
      "\ndeprecation runway on /v1 — see docs/api/versioning.md. If this change was already" +
      "\nreleased deliberately, re-baseline with: npm run api:release"
  );
  process.exit(1);
}

if (missingRoutes.length) process.exit(1);

console.log("No breaking changes. Every documented endpoint has a route handler.");
