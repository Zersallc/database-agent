import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// On Cloud Run, `--add-cloudsql-instances` mounts a Cloud SQL Auth Proxy socket
// at /cloudsql/<INSTANCE_CONNECTION_NAME> — an IAM-authenticated tunnel that
// bypasses Cloud SQL's public-IP authorized-networks allowlist entirely.
// Locally/elsewhere, fall back to a direct TCP connection.
const socketPath = process.env.INSTANCE_CONNECTION_NAME
  ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
  : undefined;

const adapter = new PrismaPg(
  socketPath
    ? {
        host: socketPath,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false },
      }
);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
