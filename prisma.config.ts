import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: {
    externalTables: true,
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
  tables: {
    external: ["public.Report"],
  },
});
