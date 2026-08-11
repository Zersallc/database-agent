/**
 * Postgres-backed document and secret stores — METADATA_DRIVER=postgres /
 * SECRET_DRIVER=postgres.
 *
 * Reuses the same medi_merchant database everything else in this app already
 * talks to (see lib/db.ts), rather than adding a second data store
 * technology. Two tables: app_documents (one row per document, JSONB payload
 * — see prisma/schema.prisma) and app_secrets (encrypted key/value, same
 * AES-256-GCM scheme as User.aiApiKeyEnc in lib/crypto.ts).
 *
 * Filtering/sorting semantics are written to match MemoryDocumentStore
 * exactly (same `compare()`, same "find the anchor in the full sorted list"
 * cursor logic) rather than reinventing keyset pagination in SQL — at this
 * app's scale (dozens to low hundreds of documents per tenant), fetching the
 * matching set and sorting in JS is simpler and behaviorally identical to
 * the driver this replaces.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type {
  Collection,
  Doc,
  DocumentStore,
  ListQuery,
  SecretStore,
  Where,
} from "./types";

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function whereInput(
  collection: Collection,
  tenantId: string,
  where: Where[] = []
): Prisma.AppDocumentWhereInput {
  return {
    collection,
    tenantId,
    AND: where.map((clause) => ({
      data: { path: [clause.field], equals: clause.equals as Prisma.InputJsonValue },
    })),
  };
}

export class PostgresDocumentStore implements DocumentStore {
  readonly driver = "postgres";

  async get<T extends Doc>(collection: Collection, tenantId: string, id: string): Promise<T | null> {
    const row = await prisma.appDocument.findUnique({
      where: { collection_tenantId_docId: { collection, tenantId, docId: id } },
    });
    return (row?.data as T) ?? null;
  }

  async list<T extends Doc>(collection: Collection, tenantId: string, query: ListQuery): Promise<T[]> {
    const rows = await prisma.appDocument.findMany({
      where: whereInput(collection, tenantId, query.where),
    });

    const direction = query.order === "asc" ? 1 : -1;
    const sorted = rows
      .map((row) => row.data as T)
      .sort((a, b) => {
        const primary = compare(a[query.orderBy], b[query.orderBy]);
        if (primary !== 0) return primary * direction;
        return compare(a.id, b.id) * direction;
      });

    let start = 0;
    if (query.startAfter) {
      const index = sorted.findIndex((doc) => doc.id === query.startAfter!.id);
      start = index === -1 ? sorted.length : index + 1;
    }
    const end = query.limit === undefined ? undefined : start + query.limit;
    return sorted.slice(start, end);
  }

  async count(collection: Collection, tenantId: string, where?: Where[]): Promise<number> {
    return prisma.appDocument.count({ where: whereInput(collection, tenantId, where) });
  }

  async put<T extends Doc>(collection: Collection, tenantId: string, doc: T): Promise<T> {
    await prisma.appDocument.upsert({
      where: { collection_tenantId_docId: { collection, tenantId, docId: doc.id } },
      create: { collection, tenantId, docId: doc.id, data: doc as Prisma.InputJsonValue },
      update: { data: doc as Prisma.InputJsonValue },
    });
    return doc;
  }

  async patch<T extends Doc>(
    collection: Collection,
    tenantId: string,
    id: string,
    changes: Partial<T>
  ): Promise<T | null> {
    const existing = await this.get<T>(collection, tenantId, id);
    if (!existing) return null;
    const next = { ...existing, ...changes, id } as T;
    await prisma.appDocument.update({
      where: { collection_tenantId_docId: { collection, tenantId, docId: id } },
      data: { data: next as Prisma.InputJsonValue },
    });
    return next;
  }

  async delete(collection: Collection, tenantId: string, id: string): Promise<boolean> {
    try {
      await prisma.appDocument.delete({
        where: { collection_tenantId_docId: { collection, tenantId, docId: id } },
      });
      return true;
    } catch {
      return false;
    }
  }

  async deleteWhere(collection: Collection, tenantId: string, where: Where[]): Promise<number> {
    const result = await prisma.appDocument.deleteMany({ where: whereInput(collection, tenantId, where) });
    return result.count;
  }

  async healthy(): Promise<boolean> {
    try {
      await prisma.appDocument.findFirst({ select: { id: true } });
      return true;
    } catch {
      return false;
    }
  }
}

export class PostgresSecretStore implements SecretStore {
  readonly driver = "postgres";

  async write(handle: string, value: string): Promise<void> {
    const valueEnc = encryptSecret(value);
    await prisma.appSecret.upsert({
      where: { handle },
      create: { handle, valueEnc },
      update: { valueEnc },
    });
  }

  async read(handle: string): Promise<string | null> {
    const row = await prisma.appSecret.findUnique({ where: { handle } });
    return row ? decryptSecret(row.valueEnc) : null;
  }

  async delete(handle: string): Promise<void> {
    await prisma.appSecret.delete({ where: { handle } }).catch(() => {});
  }

  async healthy(): Promise<boolean> {
    try {
      await prisma.appSecret.findFirst({ select: { handle: true } });
      return true;
    } catch {
      return false;
    }
  }
}
