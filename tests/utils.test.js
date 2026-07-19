"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  toComparable,
  expandWildcardMatches,
  expandWildcardGroups,
} = require("../src/utils");

describe("utils — strict YYYY-MM-DD parsing", () => {
  it("rejects impossible calendar dates", () => {
    const invalidDates = [
      "2026-02-29",
      "2026-02-30",
      "2026-02-31",
      "2026-04-31",
      "2026-06-31",
      "2026-13-01",
      "02-30",
    ];

    for (const value of invalidDates) {
      assert.equal(toComparable(value), null, value);
    }
  });

  it("accepts real dates, including leap day", () => {
    const validDates = [
      "2024-02-29",
      "2026-02-28",
      "2026-06-30",
      "2026-12-31",
    ];

    for (const value of validDates) {
      assert.deepEqual(toComparable(value), {
        kind: "date",
        value: Date.parse(`${value}T00:00:00Z`),
      }, value);
    }
  });
});

describe("utils — deterministic wildcard ordering", () => {
  it("orders wildcard matches and groups identically for non-ASCII keys", () => {
    const keys = ["счета[10]", "счета[2]", "счета[1]"];
    const expected = ["счета[1]", "счета[2]", "счета[10]"];

    assert.deepEqual(
      expandWildcardMatches("счета[*]", keys).map(({ key }) => key),
      expected,
    );
    assert.deepEqual(
      expandWildcardGroups("счета[*]", keys).map(({ key }) => key),
      expected,
    );
  });

  it("does not use locale-sensitive comparison", () => {
    const source = fs.readFileSync(require.resolve("../src/utils"), "utf8");
    assert.doesNotMatch(source, /\.localeCompare\s*\(/);
  });
});
