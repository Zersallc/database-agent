import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: {
    externalTables: true,
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
  tables: {
    external: ["public.Report"],
  },
});
