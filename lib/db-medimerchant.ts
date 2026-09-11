import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Medi-Merchant's own Cloud SQL database — Report, Inventory, Hospitals,
 * item_sustainability. Separate from the default `prisma` export in
 * lib/db.ts, which points at the Database Agent app's own tables
 * (Company/User/AppDocument/AppSecret/AuditEvent), now self-hosted on the
 * SysLab server. The app's tables and Medi-Merchant's tables live in two
 * different physical databases; this file is the one place code that needs
 * Medi-Merchant's data (lib/services/data-access.ts, lib/services/esg-report.ts)
 * should import from instead of lib/db.ts.
 */

const globalForPrisma = globalThis as unknown as { prismaMediMerchant?: PrismaClient };

// On Cloud Run, `--add-cloudsql-instances` mounts a Cloud SQL Auth Proxy
// socket at /cloudsql/<INSTANCE_CONNECTION_NAME> — an IAM-authenticated
// tunnel that bypasses Cloud SQL's public-IP authorized-networks allowlist
// entirely. Locally/elsewhere, fall back to a direct TCP connection.
const socketPath = process.env.MEDIMERCHANT_INSTANCE_CONNECTION_NAME
  ? `/cloudsql/${process.env.MEDIMERCHANT_INSTANCE_CONNECTION_NAME}`
  : undefined;

const adapter = new PrismaPg(
  socketPath
    ? {
        host: socketPath,
        database: process.env.MEDIMERCHANT_PGDATABASE,
        user: process.env.MEDIMERCHANT_PGUSER,
        password: process.env.MEDIMERCHANT_PGPASSWORD,
      }
    : {
        host: process.env.MEDIMERCHANT_PGHOST,
        port: Number(process.env.MEDIMERCHANT_PGPORT),
        database: process.env.MEDIMERCHANT_PGDATABASE,
        user: process.env.MEDIMERCHANT_PGUSER,
        password: process.env.MEDIMERCHANT_PGPASSWORD,
        ssl: { rejectUnauthorized: false },
      }
);

export const prismaMediMerchant = globalForPrisma.prismaMediMerchant ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaMediMerchant = prismaMediMerchant;
}
