/**
 * A LIVE integration test against a real syslab-server deployment. Skipped
 * entirely unless RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/RETRIEVAL_TEST_TENANT
 * are set — this is not part of the default `npm test` run, deliberately:
 * it makes a real network call to a real box, unlike everything else in
 * tests/, which is why it lives under its own name rather than folded into
 * retrieval-client.test.ts (which stays mocked and always runs).
 *
 * What this proves that the mocked unit test cannot: that RetrievalClient's
 * request actually reaches a real syslab-server instance's real /api/v1/retrieve,
 * with real auth and real tenant routing, and gets back a real hybrid result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RetrievalClient, RetrievalError } from "@/lib/services/retrieval-client";

const BASE_URL = process.env.RETRIEVAL_BASE_URL;
const TOKEN = process.env.RETRIEVAL_TOKEN;
const TENANT = process.env.RETRIEVAL_TEST_TENANT;

test("a real paraphrase query against a real syslab-server tenant returns vector-backed results", async (t) => {
  if (!BASE_URL || !TOKEN || !TENANT) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/RETRIEVAL_TEST_TENANT not set — this test only runs live");
    return;
  }

  const client = new RetrievalClient({ baseUrl: BASE_URL, token: TOKEN });
  // tests/fixtures/corpus/golden.json's para-01, reused verbatim: a real
  // paraphrase query from syslab-server's own golden set, already measured
  // there (Step 5 benchmark: keyword MRR 0.430, vector MRR 0.419 on this
  // query class) rather than an ad hoc string invented for this test.
  const result = await client.retrieve(
    "if somebody else gets a sweeter deal later do we automatically get it too",
    TENANT,
    { k: 5 }
  );

  assert.ok(result.passages.length > 0, "expected at least one passage back");
  assert.ok(result.retrievers.includes("vector"), `expected vector registered, got ${result.retrievers}`);
  assert.ok(result.retrievers.includes("keyword"), `expected keyword registered, got ${result.retrievers}`);

  const foundByVector = result.passages.filter((p) => p.found_by.includes("vector"));
  assert.ok(
    foundByVector.length > 0,
    `expected at least one passage found_by vector; got: ${JSON.stringify(result.passages.map((p) => p.found_by))}`
  );

  console.log(`  ${result.passages.length} passages, ${foundByVector.length} found_by vector`);
  console.log(`  coverage: ${JSON.stringify(result.coverage)}`);
});

test("an invalid token is rejected, not silently accepted", async (t) => {
  if (!BASE_URL || !TENANT) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TEST_TENANT not set — this test only runs live");
    return;
  }
  const client = new RetrievalClient({ baseUrl: BASE_URL, token: "not-a-real-token" });
  await assert.rejects(
    () => client.retrieve("anything", TENANT),
    (error: unknown) => {
      assert.ok(error instanceof RetrievalError);
      assert.equal(error.status, 401);
      return true;
    }
  );
});

test("an unreachable server becomes a RetrievalError, not a crash", async () => {
  const client = new RetrievalClient({ baseUrl: "http://127.0.0.1:1", token: "x" });
  await assert.rejects(() => client.retrieve("anything", "any-tenant"), RetrievalError);
});
