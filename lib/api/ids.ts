/**
 * Prefixed, lexicographically sortable identifiers (ULID layout: 48-bit
 * millisecond timestamp, then 80 bits of randomness, Crockford base32).
 *
 * The prefix is for humans reading logs — `conn_…` in a stack trace tells you
 * what you are looking at without a database round trip. To the API it is an
 * opaque string, and the contract promises nothing beyond that. Do not parse
 * an ID to recover its type; check the resource's `object` field instead.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

export const ID_PREFIX = {
  tenant: "ten",
  user: "usr",
  apiKey: "key",
  connection: "conn",
  modelProvider: "mprov",
  conversation: "conv",
  message: "msg",
  run: "run",
  query: "qry",
  skill: "skl",
  file: "file",
  reportFile: "rpt",
  request: "req",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

function encodeTime(ms: number): string {
  let out = "";
  let value = ms;
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_CHARS);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += CROCKFORD[byte % 32];
  return out;
}

export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${encodeTime(Date.now())}${encodeRandom()}`;
}

/** True if `id` looks like one of ours for `kind`. Used to reject obvious mix-ups early. */
export function isId(kind: IdKind, id: unknown): id is string {
  return typeof id === "string" && id.startsWith(`${ID_PREFIX[kind]}_`);
}

export function newRequestId(): string {
  return newId("request");
}
