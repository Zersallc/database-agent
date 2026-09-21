/**
 * MEDIA_CONNECTIONS_ENABLED is off unless a deployment says otherwise.
 *
 * It is the kill switch for the media connection type, and a kill switch that
 * turns itself on by accident is worse than none: so the default, and every
 * value that is not an explicit yes, has to be pinned.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MEDIA_CONNECTIONS_ENV,
  isMediaConnectionActive,
  mediaConnectionsEnabled,
} from "@/lib/services/media-flag";

describe("MEDIA_CONNECTIONS_ENABLED", () => {
  test("the variable is the documented one", () => {
    assert.equal(MEDIA_CONNECTIONS_ENV, "MEDIA_CONNECTIONS_ENABLED");
  });

  test("nothing set means off", () => {
    assert.equal(mediaConnectionsEnabled({}), false);
  });

  test("this test process runs with it off", () => {
    // The suite must not depend on, or be changed by, the feature. If someone
    // exports the variable in their shell this fails loudly instead of letting
    // the rest of the suite quietly run in a different mode.
    assert.equal(
      mediaConnectionsEnabled(),
      false,
      `${MEDIA_CONNECTIONS_ENV} must not be enabled while the test suite runs`
    );
  });

  test("only an explicit true or 1 turns it on", () => {
    for (const value of ["true", "TRUE", "True", " true ", "1", " 1 "]) {
      assert.equal(mediaConnectionsEnabled({ [MEDIA_CONNECTIONS_ENV]: value }), true, `'${value}'`);
    }
  });

  test("anything else is off, including things that look like yes", () => {
    for (const value of ["", " ", "false", "0", "no", "off", "yes", "on", "enabled", "2", "truee"]) {
      assert.equal(mediaConnectionsEnabled({ [MEDIA_CONNECTIONS_ENV]: value }), false, `'${value}'`);
    }
  });
});

describe("isMediaConnectionActive", () => {
  const on = { [MEDIA_CONNECTIONS_ENV]: "true" };
  const off = {};

  test("the deployment flag off means inactive, whatever the record says", () => {
    assert.equal(isMediaConnectionActive({}, off), false);
    assert.equal(isMediaConnectionActive({ enabled: true }, off), false);
  });

  test("a record with no enabled field is enabled once the flag is on", () => {
    assert.equal(isMediaConnectionActive({}, on), true);
  });

  test("a record can be switched off individually", () => {
    assert.equal(isMediaConnectionActive({ enabled: true }, on), true);
    assert.equal(isMediaConnectionActive({ enabled: false }, on), false);
  });
});
