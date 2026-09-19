import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { RetrievalClient, RetrievalError } from "@/lib/services/retrieval-client";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FAKE_RESULT = {
  query: "termination clause",
  retrievers: ["keyword", "vector"],
  retrievers_unavailable: {},
  passages: [
    {
      chunk_id: "contract.pdf#3",
      source: "contract.pdf",
      text: "Either party may terminate this agreement with 30 days notice.",
      start: 512,
      end: 640,
      tokens: 24,
      rank: 1,
      found_by: ["keyword", "vector"],
    },
  ],
  coverage: { searched: 11, matched: 1, returned: 1 },
  tokens_returned: 24,
  truncated: false,
  what_this_means: "All 1 matching passages were returned.",
};

describe("RetrievalClient", () => {
  test("requires a base URL and a token", () => {
    assert.throws(() => new RetrievalClient({ baseUrl: "", token: "t" }), RetrievalError);
    assert.throws(() => new RetrievalClient({ baseUrl: "http://x", token: "" }), RetrievalError);
  });

  test("posts to /retrieve with the correct auth header, tenant header, and body", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(FAKE_RESULT);
    });

    const client = new RetrievalClient({ baseUrl: "http://192.168.1.185:8080/api/v1", token: "sekrit" });
    const result = await client.retrieve("termination clause", "tenant-abc");

    assert.equal(capturedUrl, "http://192.168.1.185:8080/api/v1/retrieve");
    assert.equal(capturedInit.method, "POST");
    const headers = capturedInit.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer sekrit");
    assert.equal(headers["X-Syslab-Tenant"], "tenant-abc");
    const body = JSON.parse(capturedInit.body as string);
    assert.equal(body.query, "termination clause");
    assert.deepEqual(result, FAKE_RESULT);
  });

  test("strips a trailing slash from the base URL", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(FAKE_RESULT);
    });
    const client = new RetrievalClient({ baseUrl: "http://host:8080/api/v1/", token: "t" });
    await client.retrieve("q", "tenant-1");
    assert.equal(capturedUrl, "http://host:8080/api/v1/retrieve");
  });

  test("passes k and sources through only when provided", async () => {
    let body: Record<string, unknown> = {};
    mockFetch((_url, init) => {
      body = JSON.parse((init.body as string) ?? "{}");
      return jsonResponse(FAKE_RESULT);
    });
    const client = new RetrievalClient({ baseUrl: "http://host", token: "t" });
    await client.retrieve("q", "tenant-1", { k: 5, sources: ["a.pdf"] });
    assert.equal(body.k, 5);
    assert.deepEqual(body.sources, ["a.pdf"]);
  });

  test("a non-2xx response becomes a RetrievalError carrying the status", async () => {
    mockFetch(() => new Response("tenant not found", { status: 404 }));
    const client = new RetrievalClient({ baseUrl: "http://host", token: "t" });
    await assert.rejects(
      () => client.retrieve("q", "unknown-tenant"),
      (error: unknown) => {
        assert.ok(error instanceof RetrievalError);
        assert.equal(error.status, 404);
        assert.match(error.message, /404/);
        return true;
      }
    );
  });

  test("a connection failure becomes a RetrievalError, not a thrown network exception", async () => {
    mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const client = new RetrievalClient({ baseUrl: "http://host", token: "t" });
    await assert.rejects(() => client.retrieve("q", "tenant-1"), RetrievalError);
  });

  test("a timeout becomes a RetrievalError naming the timeout", async () => {
    mockFetch(() => {
      const abortError = new Error("The operation was aborted.");
      abortError.name = "AbortError";
      throw abortError;
    });
    const client = new RetrievalClient({ baseUrl: "http://host", token: "t" });
    await assert.rejects(
      () => client.retrieve("q", "tenant-1"),
      (error: unknown) => {
        assert.ok(error instanceof RetrievalError);
        assert.match(error.message, /did not answer within/);
        return true;
      }
    );
  });

  test("malformed JSON in a 200 response becomes a RetrievalError", async () => {
    mockFetch(() => new Response("not json", { status: 200 }));
    const client = new RetrievalClient({ baseUrl: "http://host", token: "t" });
    await assert.rejects(() => client.retrieve("q", "tenant-1"), RetrievalError);
  });
});
