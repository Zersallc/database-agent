/**
 * SQL graded by its result (syslab-server Step 12.3).
 *
 * Every other case stubs `execute` and checks which table and query shape the model chose. These
 * run the model's SQL against a real Postgres database, `eval_company` (evals/sql/eval_company.sql),
 * and pass only when some query the model ran returns what the reference query returns
 * (evals/sql-match.ts). That is what separates a model that writes the right SQL from one that
 * writes plausible SQL.
 *
 * Needs EVAL_COMPANY_DSN, a read-only login to that database. `--suite=sql` builds the cases
 * against it: it introspects the schema once, runs every reference query once (a reference that
 * fails stops the suite before any model time is spent), and gives every case the same
 * connection.
 */

import { PostgresConnector } from "@/lib/connectors/postgres";
import type { QueryResult } from "@/lib/connectors";
import { allOf, answerNeverMatches } from "../grade";
import { resultsMatch, scalarStated } from "../sql-match";
import type { EvalCase, EvalConnection, GradeResult } from "../types";

export type SqlQuestion = {
  id: string;
  question: string;
  /** The query whose result is the right answer. */
  reference: string;
  /** The question asks for an order (top N, newest first, by month). */
  ordered?: boolean;
  /**
   * A "the most / top N" question. A ranked list whose first rows are the reference's is also
   * right: "Cleaning, then Safety, ..." answers "which category sold the most?". Implies ordered.
   */
  top?: boolean;
  history?: { role: "user" | "assistant"; content: string }[];
  /** No query can answer it: passes on saying so, without a figure. */
  unanswerable?: boolean;
};

const SMALL_TALK = [
  { role: "user" as const, content: "hi" },
  { role: "assistant" as const, content: "Hello! I can answer questions about the company's customers, orders, products, sales reps and supplier contracts. What would you like to know?" },
  { role: "user" as const, content: "great, I'll have a few questions for you" },
  { role: "assistant" as const, content: "Go ahead whenever you're ready." },
];

const NOT_CANCELLED = `status <> 'cancelled'`;

export const SQL_QUESTIONS: SqlQuestion[] = [
  // Counting and filtering
  { id: "sql-count-customers", question: "How many customers do we have?", reference: `SELECT count(*) FROM customers` },
  { id: "sql-count-cancelled", question: "How many orders were cancelled?", reference: `SELECT count(*) FROM orders WHERE status = 'cancelled'` },
  { id: "sql-signed-up-2024", question: "How many customers signed up during 2024?", reference: `SELECT count(*) FROM customers WHERE signed_up_on >= '2024-01-01' AND signed_up_on < '2025-01-01'` },
  { id: "sql-late-deliveries", question: "How many orders were delivered after the date we promised?", reference: `SELECT count(*) FROM orders WHERE delivered_at > promised_at` },
  { id: "sql-most-expensive-product", top: true, question: "What's the most expensive product we sell?", reference: `SELECT name FROM products ORDER BY unit_price DESC LIMIT 1` },

  // Dates and ranges
  { id: "sql-march-inclusive", question: "How many orders were placed from 1 March to 31 March 2026, inclusive?", reference: `SELECT count(*) FROM orders WHERE ordered_at >= '2026-03-01' AND ordered_at < '2026-04-01'` },
  { id: "sql-delivered-october", question: "How many orders were delivered in October 2026?", reference: `SELECT count(*) FROM orders WHERE delivered_at >= '2026-10-01' AND delivered_at < '2026-11-01'` },
  {
    id: "sql-monthly-2026",
    question: "Give me the number of orders placed in each month of 2026 so far, in month order.",
    reference: `SELECT count(*) FROM orders WHERE ordered_at >= '2026-01-01' GROUP BY date_trunc('month', ordered_at) ORDER BY date_trunc('month', ordered_at)`,
    ordered: true,
  },
  {
    id: "sql-contracts-expiring-2026",
    question: "Which active supplier contracts expire by the end of 2026?",
    reference: `SELECT supplier FROM supplier_contracts WHERE status = 'active' AND expires_on <= '2026-12-31'`,
  },

  // Aggregation and joins
  {
    id: "sql-revenue-2025",
    question: "What was the total value of delivered orders that were placed in 2025?",
    reference: `SELECT sum(total) FROM orders WHERE status = 'delivered' AND ordered_at >= '2025-01-01' AND ordered_at < '2026-01-01'`,
  },
  {
    id: "sql-revenue-by-region",
    question: "Show the total value of delivered orders by customer region.",
    reference: `SELECT c.region, sum(o.total) FROM orders o JOIN customers c USING (customer_id) WHERE o.status = 'delivered' GROUP BY c.region`,
  },
  {
    id: "sql-top-5-customers",
    question: "Who are our top 5 customers by total order value, not counting cancelled orders? Highest first.",
    reference: `SELECT c.name, sum(o.total) FROM orders o JOIN customers c USING (customer_id) WHERE o.${NOT_CANCELLED} GROUP BY c.name ORDER BY sum(o.total) DESC LIMIT 5`,
    top: true,
  },
  {
    id: "sql-avg-by-segment",
    question: "What's the average order value for each customer segment, excluding cancelled orders?",
    reference: `SELECT c.segment, avg(o.total) FROM orders o JOIN customers c USING (customer_id) WHERE o.${NOT_CANCELLED} GROUP BY c.segment`,
  },
  {
    id: "sql-top-category-units-2026", top: true,
    question: "Which product category sold the most units on orders placed in 2026?",
    reference: `SELECT p.category FROM order_items i JOIN orders o USING (order_id) JOIN products p USING (product_id) WHERE o.ordered_at >= '2026-01-01' GROUP BY p.category ORDER BY sum(i.quantity) DESC LIMIT 1`,
  },
  {
    id: "sql-category-revenue-2025",
    question: "Break down 2025 sales by product category, using the order lines of delivered orders.",
    reference: `SELECT p.category, sum(i.quantity * i.unit_price) FROM order_items i JOIN orders o USING (order_id) JOIN products p USING (product_id) WHERE o.status = 'delivered' AND o.ordered_at >= '2025-01-01' AND o.ordered_at < '2026-01-01' GROUP BY p.category`,
  },
  {
    id: "sql-gloves-units-2025",
    question: "How many units of nitrile gloves went out on delivered orders placed in 2025?",
    reference: `SELECT sum(i.quantity) FROM order_items i JOIN orders o USING (order_id) JOIN products p USING (product_id) WHERE p.name ILIKE 'nitrile gloves%' AND o.status = 'delivered' AND o.ordered_at >= '2025-01-01' AND o.ordered_at < '2026-01-01'`,
  },
  {
    id: "sql-distinct-products-juniper",
    question: "How many different products has Juniper Foods bought since the start of July 2026?",
    reference: `SELECT count(DISTINCT i.product_id) FROM order_items i JOIN orders o USING (order_id) JOIN customers c USING (customer_id) WHERE c.name = 'Juniper Foods' AND o.ordered_at >= '2026-07-01'`,
  },
  {
    id: "sql-big-spenders",
    question: "Which customers have spent more than 12,000 in total, not counting cancelled orders?",
    reference: `SELECT c.name FROM orders o JOIN customers c USING (customer_id) WHERE o.${NOT_CANCELLED} GROUP BY c.name HAVING sum(o.total) > 12000`,
  },
  {
    id: "sql-pending-newest-first",
    question: "List the pending orders with the customer's name, newest first.",
    reference: `SELECT o.order_id, c.name FROM orders o JOIN customers c USING (customer_id) WHERE o.status = 'pending' ORDER BY o.ordered_at DESC`,
    ordered: true,
  },

  // NULLs, empty results, quoted identifiers
  { id: "sql-null-late-fee", question: "Which customers have no late-fee rate agreed?", reference: `SELECT name FROM customers WHERE late_fee_pct IS NULL` },
  {
    id: "sql-never-ordered",
    question: "Which customers have never placed an order?",
    reference: `SELECT c.name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)`,
  },
  {
    id: "sql-customers-per-rep",
    question: "How many customers does each sales rep look after?",
    reference: `SELECT r."Full Name", count(c.customer_id) FROM "Sales Reps" r LEFT JOIN customers c ON c.rep_id = r."Rep ID" GROUP BY r."Full Name"`,
  },
  {
    id: "sql-top-rep-2025", top: true,
    question: "Whose customers placed the most orders in 2025? I mean which sales rep.",
    reference: `SELECT r."Full Name" FROM orders o JOIN customers c USING (customer_id) JOIN "Sales Reps" r ON r."Rep ID" = c.rep_id WHERE o.ordered_at >= '2025-01-01' AND o.ordered_at < '2026-01-01' GROUP BY r."Full Name" ORDER BY count(*) DESC LIMIT 1`,
  },
  { id: "sql-longest-serving-rep", top: true, question: "Who is our longest-serving sales rep?", reference: `SELECT "Full Name" FROM "Sales Reps" ORDER BY "Hire Date" LIMIT 1` },
  { id: "sql-reps-by-region", question: "Which sales reps cover each region?", reference: `SELECT "Region", "Full Name" FROM "Sales Reps"` },

  // After earlier turns
  { id: "sql-after-small-talk", question: "how many orders are still pending?", history: SMALL_TALK, reference: `SELECT count(*) FROM orders WHERE status = 'pending'` },
  {
    id: "sql-follow-up-top-customer",
    question: "and how many orders has the top one placed altogether?",
    history: [
      { role: "user", content: "who are our biggest customers by order value?" },
      {
        role: "assistant",
        content: "Harbor Supplies is the largest customer by order value, followed by Ironside Logistics and Harbor Trading. Together the three account for about 42,000 in orders.",
      },
    ],
    reference: `SELECT count(*) FROM orders o JOIN customers c USING (customer_id) WHERE c.name = 'Harbor Supplies'`,
  },

  // No column can answer it
  { id: "sql-unanswerable-rating", question: "What was the average delivery rating customers gave us in 2025?", reference: `SELECT 1`, unanswerable: true },
];

const NOW = new Date("2026-11-02T09:00:00Z");

/** The cases, against the real database. Throws before any model time if a reference fails. */
export async function buildSqlCases(dsn: string): Promise<EvalCase[]> {
  const connector = new PostgresConnector({ credentials: { dsn } as never, maxRows: 500, allowWrites: false });
  const schema = await connector.introspect();
  const references = new Map<string, QueryResult>();
  for (const q of SQL_QUESTIONS) {
    if (q.unanswerable) continue;
    try {
      references.set(q.id, await connector.execute(q.reference, { maxRows: 500 }));
    } catch (error) {
      throw new Error(`Reference query for ${q.id} failed: ${(error as Error).message}`);
    }
  }

  // What each query of the current run returned, so the grade can compare without re-running it.
  let ran: QueryResult[] = [];
  const connection: EvalConnection = {
    name: "Company",
    engine: "postgres",
    description: "The company's customers, orders, order lines, products, sales reps and supplier contracts.",
    schema,
    execute: async (sql: string) => {
      const result = await connector.execute(sql, { maxRows: 500 });
      ran.push(result);
      return result;
    },
  };

  return SQL_QUESTIONS.map((q): EvalCase => ({
    id: q.id,
    family: "sql",
    description: q.question,
    question: q.question,
    history: q.history,
    now: NOW,
    connections: [connection],
    reset: () => {
      ran = [];
    },
    grade: (outcome) => {
      if (q.unanswerable) {
        return allOf(
          {
            // "no delivery rating", "don't have that data", "isn't tracked here" all say it.
            pass: /\bno (?:[\w-]+ )?(?:ratings?|column|field|data|record)|not (?:available|recorded|stored|tracked|captured)|(?:doesn't|does not|don't|do not) (?:have|contain|track|record|store|include)|(?:isn't|is not) (?:recorded|stored|tracked)/i.test(outcome.finalText),
            reason: "says the database holds no ratings",
            category: "answer",
          },
          // A year is not a rating: "the average rating for 2025 is not available" is the right answer.
          answerNeverMatches(outcome, /rating[^.\n]{0,40}\b(?!20\d\d\b)\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:\/\s*5|out of|stars?)/i, "no rating figure exists to state")
        );
      }
      if (ran.length === 0) return { pass: false, reason: "no query ran", category: "routing" };
      const reference = references.get(q.id)!;
      const tries = ran.map((result) =>
        q.top
          ? resultsMatch(reference, { ...result, rows: result.rows.slice(0, reference.rows.length) }, true)
          : resultsMatch(reference, result, Boolean(q.ordered))
      );
      const hit = tries.findIndex((t) => t.pass);
      const scalar = hit < 0 ? ran.findIndex((result) => scalarStated(reference, result, outcome.finalText)) : -1;
      const graded: GradeResult =
        hit >= 0
          ? { pass: true, reason: `query ${hit + 1} of ${ran.length} matches the reference` }
          : scalar >= 0
          ? { pass: true, reason: `query ${scalar + 1} of ${ran.length} holds the answer and the reply states it` }
          : { pass: false, reason: `no query matched: ${tries.map((t) => t.reason).join("; ")}`, category: "answer" };
      return graded;
    },
  }));
}
