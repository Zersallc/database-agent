export type QueryResult = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  executionTimeMs: number;
  rowCount: number;
};

const FIRST_NAMES = [
  "Amina",
  "Chen",
  "Diego",
  "Elena",
  "Farid",
  "Grace",
  "Hugo",
  "Ines",
  "Jonas",
  "Keiko",
  "Lucas",
  "Maya",
];

const REGIONS = ["EMEA", "AMER", "APAC"];
const PLANS = ["Free", "Pro", "Enterprise"];

/**
 * Stand-in for the future backend query endpoint. Produces plausible-looking
 * rows so the SQL handler's result view can be exercised without a database.
 * Replace with a real call to the Google Cloud query service.
 */
export function mockExecute(sql: string): Promise<QueryResult> {
  const delay = 350 + Math.random() * 500;

  return new Promise((resolve) => {
    setTimeout(() => {
      const rowCount = 8 + Math.floor(Math.random() * 8);
      const wantsAggregate = /\b(count|sum|avg|group\s+by)\b/i.test(sql);

      const columns = wantsAggregate
        ? ["region", "plan", "customers", "revenue"]
        : ["id", "name", "region", "plan", "active"];

      const rows = Array.from({ length: rowCount }, (_, i) =>
        wantsAggregate
          ? [
              REGIONS[i % REGIONS.length],
              PLANS[i % PLANS.length],
              120 + Math.floor(Math.random() * 900),
              Math.round((5_000 + Math.random() * 60_000) * 100) / 100,
            ]
          : [
              1000 + i,
              FIRST_NAMES[i % FIRST_NAMES.length],
              REGIONS[i % REGIONS.length],
              PLANS[i % PLANS.length],
              Math.random() > 0.25,
            ]
      );

      resolve({
        columns,
        rows,
        rowCount,
        executionTimeMs: Math.round(delay),
      });
    }, delay);
  });
}

/**
 * Canned EXPLAIN output. The real version will come from the database's own
 * query planner.
 */
export function mockExplain(sql: string): string {
  const table = /from\s+([a-z_][\w.]*)/i.exec(sql)?.[1] ?? "users";
  return [
    `Limit  (cost=0.42..18.70 rows=15 width=64)`,
    `  ->  Index Scan using ${table}_pkey on ${table}  (cost=0.42..842.10 rows=1204 width=64)`,
    `        Filter: (active = true)`,
    `        Rows Removed by Filter: 318`,
    `Planning Time: 0.184 ms`,
    `Execution Time: 1.902 ms`,
  ].join("\n");
}
