/**
 * Attachments.
 *
 * Bytes go to the blob store; only metadata goes to the document store. Where a
 * driver can sign URLs, downloads go straight from object storage to the
 * browser — a screenshot should not be read into this service's memory and
 * written back out again just to reach the person who uploaded it.
 */

import { ApiError, notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { stores } from "@/lib/providers";

/** 20 MiB. Attachments are screenshots and CSVs, not archives. */
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export type FileDoc = {
  id: string;
  object: "file";
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  created_by: string | null;
  created_at: string;
};

export async function serializeFile(doc: FileDoc) {
  const url = await stores().blobs.signedUrl(doc.storage_key, DOWNLOAD_URL_TTL_SECONDS);
  return {
    id: doc.id,
    object: doc.object,
    name: doc.name,
    mime_type: doc.mime_type,
    size_bytes: doc.size_bytes,
    download_url: url,
    expires_at: url
      ? new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString()
      : null,
    created_at: doc.created_at,
  };
}

export async function requireFile(tenantId: string, fileId: string): Promise<FileDoc> {
  const doc = await stores().documents.get<FileDoc>("files", tenantId, fileId);
  if (!doc) throw notFound("file", fileId);
  return doc;
}

export async function createFile(
  tenantId: string,
  input: { name: string; mimeType: string; contentBase64: string; userId: string }
): Promise<FileDoc> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new ApiError("invalid_request", "'content' is not valid base64.");
  }

  // Base64 silently ignores invalid characters rather than throwing, so an
  // empty decode means the input was not base64 at all.
  if (bytes.byteLength === 0) {
    throw new ApiError("invalid_request", "'content' decoded to zero bytes.");
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new ApiError(
      "payload_too_large",
      `The file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      { details: { size_bytes: bytes.byteLength, max_bytes: MAX_BYTES } }
    );
  }

  const id = newId("file");
  // Tenant-prefixed so a misconfigured bucket policy still cannot serve one
  // tenant's object under another's path.
  const storageKey = `${tenantId}/files/${id}`;
  await stores().blobs.put(storageKey, new Uint8Array(bytes), input.mimeType);

  const doc: FileDoc = {
    id,
    object: "file",
    name: input.name,
    mime_type: input.mimeType,
    size_bytes: bytes.byteLength,
    storage_key: storageKey,
    created_by: input.userId,
    created_at: new Date().toISOString(),
  };
  return stores().documents.put("files", tenantId, doc);
}

/** Raw bytes, for drivers that cannot sign a URL. */
export async function readFileBytes(doc: FileDoc) {
  return stores().blobs.get(doc.storage_key);
}
