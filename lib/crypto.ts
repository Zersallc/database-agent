import { randomBytes, createCipheriv, createDecipheriv, createHash, scryptSync } from "crypto";

/**
 * AES-256-GCM for values that must be stored (per-user AI provider keys) but
 * never shown again in full — only a masked hint. Same principle as
 * lib/services/model-providers.ts's secret store: the ciphertext lives in
 * Postgres, the plaintext exists only at write time and at the moment a
 * request actually needs to call out to a provider.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET must be set to encrypt/decrypt stored credentials.");
  }
  // Derive a fixed-length key from whatever AUTH_SECRET is — reusing it here
  // avoids introducing a second secret to provision/rotate for one field.
  return scryptSync(secret, "ai-api-key-v1", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Last 4 characters, masked — enough to recognize a key, useless if leaked. */
export function hintFor(secret: string): string {
  const tail = secret.slice(-4);
  return `••••${tail}`;
}

/** Stable, non-reversible fingerprint — useful for de-duplication/logging only. */
export function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}
