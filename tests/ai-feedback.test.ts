/**
 * Pure-logic coverage for AI Feedback, following the pattern
 * tests/api-keys.test.ts and tests/pagination.test.ts already use: no live
 * database, no mocking framework — service functions that need Prisma
 * (createAiFeedback, updateAiFeedbackTriage's actor/assignee lookups,
 * listAiFeedback's document-store round trip) have their pure decision
 * logic extracted into standalone exports and tested directly here instead.
 *
 * The single highest-value test in this file is the "no rows" assertion on
 * buildAiFeedbackSnapshot — a regression guard against ever reintroducing
 * raw customer query results into the cross-tenant ai_feedback partition.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type { Principal } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { requireDeveloperRole } from "@/lib/api/require-developer";
import type { MessageDoc } from "@/lib/services/conversations";
import type { QueryDoc } from "@/lib/services/queries";
import type { RunDoc } from "@/lib/services/runs";
import {
  buildAiFeedbackSnapshot,
  filterAiFeedbackBySearch,
  linkHistoryEntries,
  scalarHistoryEntries,
  type AiFeedbackActor,
  type AiFeedbackDoc,
} from "@/lib/services/ai-feedback";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    tenantId: "ten_acme",
    userId: "usr_1",
    role: "member",
    scopes: [],
    apiKeyId: null,
    ...overrides,
  };
}

describe("requireDeveloperRole", () => {
  test("a Developer session passes", async () => {
    await assert.doesNotReject(() =>
      requireDeveloperRole(principal(), async () => "Developer")
    );
  });

  test("a non-Developer role is rejected", async () => {
    for (const role of ["Admin", "User", "Viewer", undefined]) {
      await assert.rejects(
        () => requireDeveloperRole(principal(), async () => role),
        (err: unknown) => err instanceof ApiError && err.code === "insufficient_role"
      );
    }
  });

  test("an API key principal is rejected regardless of role — cross-tenant reach never belongs to a key", async () => {
    await assert.rejects(
      () =>
        requireDeveloperRole(principal({ apiKeyId: "key_123" }), async () => {
          assert.fail("lookupRole should not be called for an API-key principal");
        }),
      (err: unknown) => err instanceof ApiError && err.code === "insufficient_role"
    );
  });
});

function fixtureRun(overrides: Partial<RunDoc> = {}): RunDoc {
  return {
    id: "run_1",
    object: "run",
    conversation_id: "conv_1",
    connection_id: "conn_1",
    status: "succeeded",
    request_message_id: "msg_req",
    response_message_id: "msg_res",
    content: "The total is 42.",
    thinking: "Let me check the totals table.",
    steps: [{ label: "Ran query", status: "done", detail: null, query_id: "qry_1" }],
    model: "claude-sonnet-5",
    usage: { input_tokens: 100, output_tokens: 50 },
    error: null,
    created_by: "usr_1",
    created_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:02.500Z",
    ...overrides,
  };
}

function fixtureMessage(overrides: Partial<MessageDoc> = {}): MessageDoc {
  return {
    id: "msg_req",
    object: "message",
    conversation_id: "conv_1",
    role: "user",
    content: "What's the total?",
    thinking: null,
    attachments: [],
    run_id: null,
    usage: null,
    duration_ms: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fixtureQuery(overrides: Partial<QueryDoc> = {}): QueryDoc {
  return {
    id: "qry_1",
    object: "query",
    connection_id: "conn_1",
    sql: "SELECT SUM(amount) FROM orders",
    status: "succeeded",
    columns: [{ name: "sum", data_type: "numeric" }],
    rows: [[42]],
    row_count: 1,
    truncated: false,
    duration_ms: 12,
    error: null,
    created_by: "usr_1",
    created_at: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("buildAiFeedbackSnapshot", () => {
  test("carries request/response/model/usage/duration through", () => {
    const snapshot = buildAiFeedbackSnapshot(fixtureRun(), fixtureMessage(), [fixtureQuery()]);
    assert.equal(snapshot.request_content, "What's the total?");
    assert.equal(snapshot.response_content, "The total is 42.");
    assert.equal(snapshot.response_thinking, "Let me check the totals table.");
    assert.equal(snapshot.model, "claude-sonnet-5");
    assert.deepEqual(snapshot.usage, { input_tokens: 100, output_tokens: 50 });
    assert.equal(snapshot.duration_ms, 2500);
    assert.equal(snapshot.run_status, "succeeded");
    assert.equal(snapshot.run_error, null);
  });

  test("a run with no request message yields null request_content and no attachments, not a throw", () => {
    const snapshot = buildAiFeedbackSnapshot(fixtureRun(), null, []);
    assert.equal(snapshot.request_content, null);
    assert.deepEqual(snapshot.attachments, []);
  });

  test("an incomplete run (no completed_at) has a null duration rather than a negative or NaN one", () => {
    const snapshot = buildAiFeedbackSnapshot(fixtureRun({ completed_at: null }), fixtureMessage(), []);
    assert.equal(snapshot.duration_ms, null);
  });

  test("never carries a `rows` field on any query entry — the cross-tenant partition must never see result data", () => {
    const snapshot = buildAiFeedbackSnapshot(fixtureRun(), fixtureMessage(), [
      fixtureQuery({ rows: [[1, 2, 3], [4, 5, 6]] }),
    ]);
    assert.equal(snapshot.queries.length, 1);
    for (const query of snapshot.queries) {
      assert.equal(Object.hasOwn(query, "rows"), false, "query snapshot must not carry `rows`");
    }
    // Belt and braces: the serialized form must not mention row data either.
    assert.doesNotMatch(JSON.stringify(snapshot), /"rows"/);
  });

  test("still records row_count/truncated/duration/error metadata about each query, just not the rows themselves", () => {
    const snapshot = buildAiFeedbackSnapshot(fixtureRun(), fixtureMessage(), [
      fixtureQuery({ row_count: 250, truncated: true, duration_ms: 340, error: { code: "x", message: "boom" } }),
    ]);
    assert.deepEqual(snapshot.queries[0], {
      query_id: "qry_1",
      sql: "SELECT SUM(amount) FROM orders",
      status: "succeeded",
      row_count: 250,
      truncated: true,
      duration_ms: 340,
      error: { code: "x", message: "boom" },
    });
  });
});

function fixtureFeedback(overrides: Partial<AiFeedbackDoc> = {}): AiFeedbackDoc {
  return {
    id: "fbk_1",
    object: "ai_feedback",
    description: "The revenue total looks wrong",
    category: null,
    additional_context: null,
    tenant_id: "ten_acme",
    tenant_name: "Acme Corp",
    reported_by: { user_id: "usr_1", email: "reporter@acme.test" },
    conversation_id: "conv_1",
    run_id: "run_1",
    response_message_id: "msg_res",
    request_message_id: "msg_req",
    snapshot: {
      request_content: null,
      response_content: null,
      response_thinking: null,
      model: null,
      usage: null,
      duration_ms: null,
      run_status: "succeeded",
      run_error: null,
      steps: [],
      queries: [],
      attachments: [],
    },
    snapshot_taken_at: "2026-01-01T00:00:00.000Z",
    status: "open",
    priority: null,
    assigned_to: null,
    assigned_to_user_id: null,
    resolution: null,
    linked_issue_url: null,
    duplicate_of: null,
    related_report_ids: [],
    history: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ACTOR: AiFeedbackActor = { user_id: "usr_dev", email: "dev@internal.test" };
const NOW = "2026-01-02T00:00:00.000Z";

describe("scalarHistoryEntries", () => {
  test("no fields in the input means no history entries", () => {
    assert.deepEqual(scalarHistoryEntries(fixtureFeedback(), {}, ACTOR, NOW), []);
  });

  test("setting a field to its current value is not a change", () => {
    assert.deepEqual(
      scalarHistoryEntries(fixtureFeedback({ status: "open" }), { status: "open" }, ACTOR, NOW),
      []
    );
  });

  test("an ordinary status change produces one status_changed entry with from/to", () => {
    const entries = scalarHistoryEntries(fixtureFeedback({ status: "open" }), { status: "in_progress" }, ACTOR, NOW);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, "status_changed");
    assert.equal(entries[0].actor, ACTOR);
    assert.equal(entries[0].at, NOW);
    assert.deepEqual(entries[0].changes, { status: { from: "open", to: "in_progress" } });
  });

  test("moving to resolved is labeled 'resolved', not 'status_changed'", () => {
    const entries = scalarHistoryEntries(fixtureFeedback({ status: "in_progress" }), { status: "resolved" }, ACTOR, NOW);
    assert.equal(entries[0].type, "resolved");
  });

  test("moving away from resolved is labeled 'reopened'", () => {
    const entries = scalarHistoryEntries(fixtureFeedback({ status: "resolved" }), { status: "open" }, ACTOR, NOW);
    assert.equal(entries[0].type, "reopened");
  });

  test("priority and category changes are labeled distinctly", () => {
    const priorityEntries = scalarHistoryEntries(fixtureFeedback(), { priority: "high" }, ACTOR, NOW);
    assert.equal(priorityEntries[0].type, "priority_changed");

    const categoryEntries = scalarHistoryEntries(fixtureFeedback(), { category: "wrong_sql" }, ACTOR, NOW);
    assert.equal(categoryEntries[0].type, "category_changed");
  });

  test("changing three fields at once produces three separate entries", () => {
    const entries = scalarHistoryEntries(
      fixtureFeedback({ status: "open", priority: "low", category: "other" }),
      { status: "in_progress", priority: "urgent", category: "wrong_sql" },
      ACTOR,
      NOW
    );
    assert.equal(entries.length, 3);
    assert.deepEqual(
      entries.map((e) => e.type).sort(),
      ["category_changed", "priority_changed", "status_changed"]
    );
  });
});

describe("linkHistoryEntries", () => {
  test("no linking fields in the input means no history entries and unchanged fields", () => {
    const existing = fixtureFeedback();
    const result = linkHistoryEntries(existing, {}, ACTOR, NOW);
    assert.deepEqual(result.history, []);
    assert.deepEqual(result.fields, {
      linked_issue_url: null,
      duplicate_of: null,
      related_report_ids: [],
    });
  });

  test("setting linked_issue_url produces one issue_linked entry", () => {
    const result = linkHistoryEntries(
      fixtureFeedback(),
      { linked_issue_url: "https://github.com/acme/repo/issues/9" },
      ACTOR,
      NOW
    );
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].type, "issue_linked");
    assert.deepEqual(result.history[0].changes, {
      linked_issue_url: { from: null, to: "https://github.com/acme/repo/issues/9" },
    });
    assert.equal(result.fields.linked_issue_url, "https://github.com/acme/repo/issues/9");
  });

  test("setting linked_issue_url to its current value is not a change", () => {
    const existing = fixtureFeedback({ linked_issue_url: "https://issues.example/1" });
    const result = linkHistoryEntries(existing, { linked_issue_url: "https://issues.example/1" }, ACTOR, NOW);
    assert.deepEqual(result.history, []);
  });

  test("unlink_issue clears an existing link and records the change", () => {
    const existing = fixtureFeedback({ linked_issue_url: "https://issues.example/1" });
    const result = linkHistoryEntries(existing, { unlink_issue: true }, ACTOR, NOW);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].type, "issue_linked");
    assert.deepEqual(result.history[0].changes, {
      linked_issue_url: { from: "https://issues.example/1", to: null },
    });
    assert.equal(result.fields.linked_issue_url, null);
  });

  test("unlink_issue when nothing is linked is a no-op", () => {
    const result = linkHistoryEntries(fixtureFeedback(), { unlink_issue: true }, ACTOR, NOW);
    assert.deepEqual(result.history, []);
  });

  test("setting duplicate_of produces one duplicate_linked entry", () => {
    const result = linkHistoryEntries(fixtureFeedback(), { duplicate_of: "fbk_other" }, ACTOR, NOW);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].type, "duplicate_linked");
    assert.deepEqual(result.history[0].changes, { duplicate_of: { from: null, to: "fbk_other" } });
    assert.equal(result.fields.duplicate_of, "fbk_other");
  });

  test("unmark_duplicate clears an existing duplicate_of and records the change", () => {
    const existing = fixtureFeedback({ duplicate_of: "fbk_other" });
    const result = linkHistoryEntries(existing, { unmark_duplicate: true }, ACTOR, NOW);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].type, "duplicate_linked");
    assert.deepEqual(result.history[0].changes, { duplicate_of: { from: "fbk_other", to: null } });
    assert.equal(result.fields.duplicate_of, null);
  });

  test("unmark_duplicate when nothing is marked is a no-op", () => {
    const result = linkHistoryEntries(fixtureFeedback(), { unmark_duplicate: true }, ACTOR, NOW);
    assert.deepEqual(result.history, []);
  });

  test("add_related_report_id appends the id and produces one related_linked entry", () => {
    const existing = fixtureFeedback({ related_report_ids: ["fbk_a"] });
    const result = linkHistoryEntries(existing, { add_related_report_id: "fbk_b" }, ACTOR, NOW);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].type, "related_linked");
    assert.deepEqual(result.fields.related_report_ids, ["fbk_a", "fbk_b"]);
  });

  test("adding an id already present is a no-op", () => {
    const existing = fixtureFeedback({ related_report_ids: ["fbk_a"] });
    const result = linkHistoryEntries(existing, { add_related_report_id: "fbk_a" }, ACTOR, NOW);
    assert.deepEqual(result.history, []);
    assert.deepEqual(result.fields.related_report_ids, ["fbk_a"]);
  });

  test("remove_related_report_id removes the id and produces one related_linked entry", () => {
    const existing = fixtureFeedback({ related_report_ids: ["fbk_a", "fbk_b"] });
    const result = linkHistoryEntries(existing, { remove_related_report_id: "fbk_a" }, ACTOR, NOW);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].type, "related_linked");
    assert.deepEqual(result.fields.related_report_ids, ["fbk_b"]);
  });

  test("removing an id that isn't present is a no-op", () => {
    const existing = fixtureFeedback({ related_report_ids: ["fbk_a"] });
    const result = linkHistoryEntries(existing, { remove_related_report_id: "fbk_z" }, ACTOR, NOW);
    assert.deepEqual(result.history, []);
    assert.deepEqual(result.fields.related_report_ids, ["fbk_a"]);
  });

  test("changing issue link, duplicate, and related reports at once produces three entries", () => {
    const existing = fixtureFeedback({ related_report_ids: ["fbk_a"] });
    const result = linkHistoryEntries(
      existing,
      {
        linked_issue_url: "https://issues.example/9",
        duplicate_of: "fbk_dup",
        add_related_report_id: "fbk_c",
      },
      ACTOR,
      NOW
    );
    assert.equal(result.history.length, 3);
    assert.deepEqual(
      result.history.map((e) => e.type).sort(),
      ["duplicate_linked", "issue_linked", "related_linked"]
    );
  });
});

describe("filterAiFeedbackBySearch", () => {
  const rows = [
    fixtureFeedback({ id: "fbk_1", description: "The revenue total looks wrong" }),
    fixtureFeedback({ id: "fbk_2", description: "Query timed out", tenant_name: "Globex" }),
    fixtureFeedback({
      id: "fbk_3",
      description: "Unrelated",
      additional_context: "customer mentioned Acme by name",
    }),
    fixtureFeedback({
      id: "fbk_4",
      description: "Unrelated",
      reported_by: { user_id: "usr_9", email: "acme-user@example.com" },
    }),
    fixtureFeedback({ id: "fbk_5", description: "No match here", tenant_name: null, additional_context: null }),
  ];

  test("an empty query returns every row unchanged", () => {
    assert.deepEqual(filterAiFeedbackBySearch(rows, ""), rows);
  });

  test("matches on description, case-insensitively", () => {
    const matched = filterAiFeedbackBySearch(rows, "REVENUE");
    assert.deepEqual(matched.map((r) => r.id), ["fbk_1"]);
  });

  test("matches on tenant_name", () => {
    assert.deepEqual(filterAiFeedbackBySearch(rows, "globex").map((r) => r.id), ["fbk_2"]);
  });

  test("matches on additional_context", () => {
    assert.deepEqual(filterAiFeedbackBySearch(rows, "acme by name").map((r) => r.id), ["fbk_3"]);
  });

  test("matches on the reporter's email", () => {
    assert.deepEqual(filterAiFeedbackBySearch(rows, "acme-user@example.com").map((r) => r.id), ["fbk_4"]);
  });

  test("a null tenant_name or additional_context does not throw — it's just not a match", () => {
    assert.doesNotThrow(() => filterAiFeedbackBySearch(rows, "no match here"));
    assert.deepEqual(filterAiFeedbackBySearch(rows, "no match here").map((r) => r.id), ["fbk_5"]);
  });

  test("no match anywhere returns an empty array", () => {
    assert.deepEqual(filterAiFeedbackBySearch(rows, "nothing matches this"), []);
  });

  test("does not mutate the input array", () => {
    const before = [...rows];
    filterAiFeedbackBySearch(rows, "revenue");
    assert.deepEqual(rows, before);
  });
});
