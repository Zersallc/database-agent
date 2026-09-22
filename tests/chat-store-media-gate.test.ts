/**
 * The bug this guards against: `bootstrap()` used to auto-create a first
 * conversation only when `connections.length > 0`. A media-only workspace
 * (no database connection, one enabled library) got no conversation, and
 * `ChatWorkspace`'s `send()` is a silent no-op without one — the chat screen
 * would render, the input would accept text, and pressing Send would do
 * nothing at all, with no error shown anywhere.
 *
 * `shouldAutoCreateConversation` is the extracted decision; this is the part
 * of the fix a plain function can prove without a browser. The other half —
 * that a real send actually produces a real message — needs a live browser
 * round trip, recorded in the phase report, not here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldAutoCreateConversation } from "@/lib/chat-store";

describe("shouldAutoCreateConversation", () => {
  it("creates one for a database-only workspace (the pre-existing case, unchanged)", () => {
    assert.equal(
      shouldAutoCreateConversation({ activeConversationId: null, connectionsCount: 1, hasEnabledLibrary: false }),
      true
    );
  });

  it("creates one for a media-only workspace — the exact case that was broken", () => {
    assert.equal(
      shouldAutoCreateConversation({ activeConversationId: null, connectionsCount: 0, hasEnabledLibrary: true }),
      true
    );
  });

  it("creates one when both a database and a library exist", () => {
    assert.equal(
      shouldAutoCreateConversation({ activeConversationId: null, connectionsCount: 2, hasEnabledLibrary: true }),
      true
    );
  });

  it("does not create one for a workspace with neither source", () => {
    assert.equal(
      shouldAutoCreateConversation({ activeConversationId: null, connectionsCount: 0, hasEnabledLibrary: false }),
      false
    );
  });

  it("never creates a second one when a conversation already exists, regardless of sources", () => {
    for (const hasEnabledLibrary of [true, false]) {
      for (const connectionsCount of [0, 1, 3]) {
        assert.equal(
          shouldAutoCreateConversation({ activeConversationId: "conv_existing", connectionsCount, hasEnabledLibrary }),
          false,
          `connections=${connectionsCount} library=${hasEnabledLibrary}`
        );
      }
    }
  });
});
