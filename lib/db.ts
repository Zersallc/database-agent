import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The Database Agent app's own tables — Company/User/AppDocument/AppSecret/
 * AuditEvent. Self-hosted Postgres on the SysLab server, reached over a
 * plain TCP connection through a Cloudflare Tunnel (in production, a
 * `cloudflared access tcp` sidecar puts a local port in front of it; locally,
 * the same proxy run by hand). No Cloud SQL involved here — for
 * Medi-Merchant's own Cloud SQL database (Report/Inventory/Hospitals/
 * item_sustainability), see lib/db-medimerchant.ts instead.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: false,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
