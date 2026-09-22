/**
 * The fixtures every media-connection case is built from.
 *
 * Kept in one place so the cases describe one small, consistent company: a
 * Sales database, and three document libraries that answer different kinds of
 * question. What each document says is chosen so a grade can look for the fact
 * without depending on how the model words it, and so that where two sources
 * could both plausibly answer something they hold DIFFERENT values, which is
 * what makes choosing the wrong one visible.
 */

import type { QueryResult } from "@/lib/connectors";

import { countResult, rowsResult } from "./fixtures";
import type { EvalConnection, EvalLibrary } from "./types";

/** Supplier and customer agreements. */
export const CONTRACTS: EvalLibrary = {
  name: "Contracts",
  description: "Supplier and customer contracts, including their termination, payment and penalty terms.",
  documents: [
    {
      file: "contract_03.pdf",
      text:
        "Supply Agreement with Northwind Traders. Termination: either party may terminate this agreement on " +
        "thirty (30) days' written notice to the other party.",
      aliases: ["contract", "contracts", "end", "cancel", "exit", "leave", "notice", "supplier", "agreement", "agreements", "deal"],
    },
    {
      file: "contract_07.pdf",
      text:
        "Supply Agreement with Acme Industrial. Late delivery: if a delivery is more than five (5) days late, the " +
        "buyer is entitled to a credit of two percent (2%) of the order value for each full week of delay, capped at " +
        "ten percent (10%).",
      aliases: ["contract", "contracts", "penalty", "penalties", "fee", "fine", "delayed", "delay", "late", "delivery", "acme", "supplier", "agreements", "owe"],
    },
    {
      file: "contract_11.pdf",
      text:
        "Customer Agreement with Globex. Payment terms: invoices are payable within forty-five (45) days of the invoice " +
        "date. Pricing: Globex is entitled to most-favored-customer pricing; if a lower price is offered to another " +
        "customer for the same volume, Globex receives that price too.",
      aliases: ["contract", "contracts", "pay", "paying", "invoice", "price", "pricing", "discount", "cheaper", "better", "deal", "customer", "agreements", "mfn"],
    },
    {
      file: "nda_2024.pdf",
      text:
        "Mutual Non-Disclosure Agreement, 2024. Confidential information must be protected for five (5) years after it " +
        "is disclosed.",
      aliases: ["contract", "contracts", "confidential", "confidentiality", "secret", "secrecy", "retention", "years", "nda", "agreements"],
    },
  ],
};

/** Internal HR policies. */
export const HR_POLICIES: EvalLibrary = {
  name: "HR Policies",
  description: "Internal human-resources policies: leave, remote work and conduct.",
  documents: [
    {
      file: "leave_policy.pdf",
      text:
        "Annual leave: full-time employees receive twenty (20) days of paid annual leave per year. Up to five (5) " +
        "unused days may be carried over into the next year.",
      aliases: ["vacation", "holiday", "holidays", "time", "off", "employee", "employees", "days"],
    },
    {
      file: "remote_work.pdf",
      text: "Remote work: employees may work remotely up to three (3) days per week with their manager's approval.",
      aliases: ["home", "wfh", "hybrid", "office", "employee", "employees"],
    },
    {
      file: "code_of_conduct.pdf",
      text: "Code of conduct: employees must report a conflict of interest to the compliance team within ten (10) days.",
      aliases: ["ethics", "conflict", "report", "employee", "employees"],
    },
  ],
};

/** Regulatory and audit records. */
export const COMPLIANCE: EvalLibrary = {
  name: "Compliance",
  description: "Regulatory and audit records: internal audits and the data-protection register.",
  documents: [
    {
      file: "audit_2025.pdf",
      text:
        "Internal audit 2025: three findings were raised, two have been closed, and one remains open concerning " +
        "supplier onboarding checks.",
      aliases: ["audits", "findings", "open", "closed", "issues", "onboarding"],
    },
    {
      file: "gdpr_register.pdf",
      text:
        "GDPR register: personal data of EU customers is retained for seven (7) years after the end of the " +
        "relationship and is then erased.",
      aliases: ["privacy", "data", "protection", "retention", "retained", "years", "personal", "period", "customers"],
    },
  ],
};

/** The figures the Sales fixture returns, so a grade can look for them. */
export const SALES_FACTS = {
  lateOrders: 12,
  totalOrders: 1240,
  contractsOnRecord: 14,
  contractsExpiringThisYear: 5,
  totalRevenue: 1284500.5,
} as const;

const REVENUE_BY_REGION: unknown[][] = [
  ["EMEA", 512300.5],
  ["APAC", 401200.0],
  ["Americas", 371000.0],
];

/** What the Sales fixture returns for a statement, judged by the words in it. */
export function salesResponder(sql: string): QueryResult {
  const s = sql.toLowerCase();

  if (/count\s*\(/.test(s)) {
    if (/2019/.test(s)) return countResult(0);
    if (s.includes("supplier_contracts")) {
      return countResult(/expires_on/.test(s) && /2026|2027|year|current_date|now\(\)/.test(s) ? SALES_FACTS.contractsExpiringThisYear : SALES_FACTS.contractsOnRecord);
    }
    if (s.includes("orders")) {
      return countResult(/promised_at|delivered_at|late/.test(s) ? SALES_FACTS.lateOrders : SALES_FACTS.totalOrders);
    }
    return countResult(42);
  }

  if (/sum\s*\(|revenue/.test(s)) {
    if (/group\s+by/.test(s) && /region/.test(s)) return rowsResult(["region", "revenue"], REVENUE_BY_REGION);
    return rowsResult(["revenue"], [[SALES_FACTS.totalRevenue]]);
  }

  if (s.includes("customers") && /order\s+by/.test(s)) {
    return rowsResult(
      ["name", "total_spend"],
      [["Globex", 402000], ["Acme Industrial", 355500.5], ["Initech", 210300], ["Umbrella", 150200], ["Hooli", 98100.25]]
    );
  }

  if (s.includes("supplier_contracts")) {
    return rowsResult(
      ["supplier", "signed_on", "expires_on", "status"],
      [
        ["Northwind Traders", "2024-03-01", "2027-02-28", "active"],
        ["Acme Industrial", "2023-06-15", "2026-06-14", "active"],
        ["Contoso", "2021-01-10", "2025-01-09", "expired"],
      ]
    );
  }

  return rowsResult(["order_id", "total"], [[1, 250.0], [2, 1200.5], [3, 89.99]]);
}

/**
 * The Sales database: orders, customers and the register of supplier contracts.
 *
 * The register holds who, when signed and when it expires. What a contract says
 * is in the documents, not in a column, which is what lets a question about a
 * contract's terms be one the database cannot answer. `customers.late_fee_pct`
 * is the late fee applied in billing, and deliberately differs from what
 * contract_07.pdf says, so a question about "the penalty" has two answers that
 * disagree.
 */
export function salesDatabase(): EvalConnection {
  const column = (name: string, data_type: string, description: string | null = null, primary_key = false) => ({
    name,
    data_type,
    nullable: !primary_key,
    primary_key,
    description,
  });
  return {
    name: "Sales",
    engine: "postgres",
    description: "Orders, customers, and the register of supplier contracts.",
    schema: [
      {
        schema: "public",
        name: "orders",
        description: "One row per customer order.",
        row_estimate: 1240,
        columns: [
          column("order_id", "integer", null, true),
          column("customer_id", "integer"),
          column("total", "numeric", "Order value."),
          column("status", "text"),
          column("ordered_at", "timestamp"),
          column("promised_at", "timestamp", "The delivery date promised to the customer."),
          column("delivered_at", "timestamp"),
        ],
      },
      {
        schema: "public",
        name: "customers",
        description: "One row per customer.",
        row_estimate: 60,
        columns: [
          column("customer_id", "integer", null, true),
          column("name", "text"),
          column("region", "text"),
          column("late_fee_pct", "numeric", "The late-delivery penalty rate applied to this customer in billing, percent per week."),
        ],
      },
      {
        schema: "public",
        name: "supplier_contracts",
        description:
          "Register of supplier contracts: which supplier, when signed and when it expires. The terms themselves are in the contract documents, not in these columns.",
        row_estimate: 14,
        columns: [
          column("contract_id", "integer", null, true),
          column("supplier", "text"),
          column("signed_on", "date"),
          column("expires_on", "date"),
          column("status", "text"),
        ],
      },
    ],
    execute: async (sql: string) => salesResponder(sql),
  };
}
