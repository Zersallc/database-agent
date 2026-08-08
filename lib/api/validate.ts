/**
 * A small validator, hand-rolled so the API has no runtime dependency for its
 * most load-bearing behavior.
 *
 * The point is not just rejecting bad input — it is telling the integrator
 * exactly which field is wrong and why, in the `details.fields` array the
 * contract promises. Someone whose request 400s should be able to fix it
 * without reading our source or filing a ticket.
 *
 * Every issue in a request is collected before throwing, so a caller with three
 * mistakes learns about all three at once instead of playing whack-a-mole.
 */

import { ApiError } from "./errors";

export type Issue = { path: string; issue: string };

export type Validator<T> = {
  parse: (value: unknown, path: string, issues: Issue[]) => T;
  /** True when `undefined` is an acceptable input (optional or defaulted). */
  isOptional: boolean;
};

function make<T>(parse: Validator<T>["parse"]): Validator<T> {
  return { parse, isOptional: false };
}

/** Returned as the parse result once an issue is recorded; never read, since we throw first. */
const INVALID = undefined as never;

export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return {
    isOptional: true,
    parse: (value, path, issues) =>
      value === undefined || value === null ? undefined : inner.parse(value, path, issues),
  };
}

export function withDefault<T>(inner: Validator<T>, fallback: T): Validator<T> {
  return {
    isOptional: true,
    parse: (value, path, issues) =>
      value === undefined || value === null ? fallback : inner.parse(value, path, issues),
  };
}

// Deliberately permissive: enough to catch a typo, not enough to reject a
// valid-but-unusual address. Real verification is a confirmation email's job.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function string(
  opts: { min?: number; max?: number; trim?: boolean; format?: "email" } = {}
): Validator<string> {
  const { min = 0, max = Infinity, trim = true, format } = opts;
  return make((value, path, issues) => {
    if (typeof value !== "string") {
      issues.push({ path, issue: "must be a string" });
      return INVALID;
    }
    const out = trim ? value.trim() : value;
    if (out.length < min) {
      issues.push({
        path,
        issue: min === 1 ? "must not be empty" : `must be at least ${min} characters`,
      });
      return INVALID;
    }
    if (out.length > max) {
      issues.push({ path, issue: `must be at most ${max} characters` });
      return INVALID;
    }
    if (format === "email" && !EMAIL.test(out)) {
      issues.push({ path, issue: "must be a valid email address" });
      return INVALID;
    }
    return out;
  });
}

export function oneOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return make((value, path, issues) => {
    if (typeof value !== "string" || !values.includes(value)) {
      issues.push({ path, issue: `must be one of: ${values.join(", ")}` });
      return INVALID;
    }
    return value as T[number];
  });
}

export function integer(opts: { min?: number; max?: number } = {}): Validator<number> {
  const { min = -Infinity, max = Infinity } = opts;
  return make((value, path, issues) => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      issues.push({ path, issue: "must be an integer" });
      return INVALID;
    }
    if (value < min || value > max) {
      issues.push({ path, issue: `must be between ${min} and ${max}` });
      return INVALID;
    }
    return value;
  });
}

export function boolean(): Validator<boolean> {
  return make((value, path, issues) => {
    if (typeof value !== "boolean") {
      issues.push({ path, issue: "must be a boolean" });
      return INVALID;
    }
    return value;
  });
}

export function array<T>(item: Validator<T>, opts: { max?: number } = {}): Validator<T[]> {
  const { max = Infinity } = opts;
  return make((value, path, issues) => {
    if (!Array.isArray(value)) {
      issues.push({ path, issue: "must be an array" });
      return INVALID;
    }
    if (value.length > max) {
      issues.push({ path, issue: `must contain at most ${max} items` });
      return INVALID;
    }
    return value.map((entry, index) => item.parse(entry, `${path}[${index}]`, issues));
  });
}

type Shape = Record<string, Validator<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: ReturnType<S[K]["parse"]> };

export function object<S extends Shape>(shape: S): Validator<Infer<S>> {
  return make((value, path, issues) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({ path, issue: "must be an object" });
      return INVALID;
    }
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(shape)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const raw = source[key];
      if (raw === undefined || raw === null) {
        if (!validator.isOptional) {
          issues.push({ path: fieldPath, issue: "is required" });
          continue;
        }
      }
      out[key] = validator.parse(raw, fieldPath, issues);
    }
    return out as Infer<S>;
  });
}

/** Passes any JSON value through untouched. For genuinely free-form fields only. */
export function unknown(): Validator<unknown> {
  return make((value) => value);
}

/**
 * Runs a validator and throws a single `validation_failed` carrying every
 * issue found. Success returns the parsed value with unknown keys dropped —
 * we never echo back fields we do not understand.
 */
export function validate<T>(value: unknown, validator: Validator<T>): T {
  const issues: Issue[] = [];
  const parsed = validator.parse(value, "", issues);
  if (issues.length > 0) {
    throw new ApiError("validation_failed", describe(issues), { details: { fields: issues } });
  }
  return parsed;
}

function describe(issues: Issue[]): string {
  const [first] = issues;
  const where = first.path || "request body";
  const rest = issues.length - 1;
  const suffix = rest > 0 ? ` (and ${rest} other ${rest === 1 ? "problem" : "problems"})` : "";
  return `${where} ${first.issue}${suffix}.`;
}

/** Reads and parses a JSON body, turning malformed JSON into a proper 400. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request", "Request body is not valid JSON.");
  }
}
