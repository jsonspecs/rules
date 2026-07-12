"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createEngine, Operators, CompilationError } = require("..");

// ── helpers ────────────────────────────────────────────────────────────────

function makeRule(overrides = {}) {
  return {
    id: "library.test.r",
    type: "rule",
    description: "test rule",
    role: "check",
    operator: "not_empty",
    field: "x",
    level: "ERROR",
    code: "TEST.X.REQUIRED",
    message: "x is required",
    ...overrides,
  };
}

function makePipeline(overrides = {}) {
  return {
    id: "test.pipe",
    type: "pipeline",
    description: "test pipeline",
    entrypoint: true,
    strict: false,
    flow: [{ rule: "library.test.r" }],
    ...overrides,
  };
}

const engine = createEngine({ operators: Operators });

// ── duplicate id ───────────────────────────────────────────────────────────

describe("compile — duplicate artifact id", () => {
  it("throws CompilationError listing the duplicate", () => {
    const rule = makeRule();
    assert.throws(
      () => engine.compile([rule, rule]),
      (e) => {
        assert.ok(e instanceof CompilationError);
        assert.ok(e.errors.some((s) => s.includes("Duplicate artifact id")));
        return true;
      }
    );
  });
});

// ── missing required fields ────────────────────────────────────────────────

describe("compile — check rule missing level/code/message", () => {
  it("throws CompilationError with all three errors", () => {
    const bad = makeRule();
    delete bad.level;
    delete bad.code;
    delete bad.message;
    assert.throws(
      () => engine.compile([bad]),
      (e) => {
        assert.ok(e instanceof CompilationError);
        assert.ok(e.errors.some((s) => s.includes("level")));
        assert.ok(e.errors.some((s) => s.includes("code")));
        assert.ok(e.errors.some((s) => s.includes("message")));
        return true;
      }
    );
  });
});

// ── duplicate error code ───────────────────────────────────────────────────

describe("compile — duplicate error code across rules", () => {
  it("throws CompilationError", () => {
    const r1 = makeRule({ id: "library.test.r1", code: "SAME.CODE" });
    const r2 = makeRule({ id: "library.test.r2", code: "SAME.CODE" });
    const pipe = makePipeline({ flow: [{ rule: "library.test.r1" }, { rule: "library.test.r2" }] });
    assert.throws(
      () => engine.compile([r1, r2, pipe]),
      (e) => {
        assert.ok(e instanceof CompilationError);
        assert.ok(e.errors.some((s) => s.includes("SAME.CODE")));
        return true;
      }
    );
  });
});

// ── unresolved reference ───────────────────────────────────────────────────

describe("compile — pipeline references missing rule", () => {
  it("throws CompilationError", () => {
    const pipe = makePipeline({ flow: [{ rule: "library.test.does_not_exist" }] });
    assert.throws(
      () => engine.compile([pipe]),
      (e) => {
        assert.ok(e instanceof CompilationError);
        assert.ok(e.errors.some((s) => s.includes("library.test.does_not_exist")));
        return true;
      }
    );
  });
});

// ── matches_regex: invalid pattern caught at compile time ──────────────────

describe("compile — matches_regex with invalid regex pattern", () => {
  it("throws CompilationError (not ABORT at runtime)", () => {
    const bad = makeRule({
      operator: "matches_regex",
      value: "[invalid(regex",
      level: "ERROR",
      code: "TEST.REGEX",
      message: "bad regex",
    });
    const pipe = makePipeline({ flow: [{ rule: "library.test.r" }] });
    assert.throws(
      () => engine.compile([bad, pipe]),
      (e) => {
        assert.ok(e instanceof CompilationError);
        assert.ok(
          e.errors.some((s) => s.includes("invalid regex") || s.includes("Invalid regular expression")),
          `Expected regex error in: ${e.errors.join("; ")}`
        );
        return true;
      }
    );
  });
});

// ── matches_regex: valid pattern compiles ok ───────────────────────────────

describe("compile — matches_regex with valid pattern", () => {
  it("compiles without errors", () => {
    const rule = makeRule({
      id: "library.test.r",
      operator: "matches_regex",
      value: "^\\d{12}$",
      level: "ERROR",
      code: "TEST.REGEX.OK",
      message: "must be 12 digits",
    });
    const pipe = makePipeline();
    assert.doesNotThrow(() => engine.compile([rule, pipe]));
  });
});

// ── DAG: cycle detection ───────────────────────────────────────────────────

describe("compile — pipeline cycle detection", () => {
  it("throws CompilationError when pipeline references itself via nested pipeline", () => {
    const pipeA = {
      id: "pipe.a",
      type: "pipeline",
      description: "a",
      entrypoint: true,
      strict: false,
      flow: [{ pipeline: "pipe.b" }],
    };
    const pipeB = {
      id: "pipe.b",
      type: "pipeline",
      description: "b",
      entrypoint: false,
      strict: false,
      flow: [{ pipeline: "pipe.a" }],
    };
    assert.throws(
      () => engine.compile([pipeA, pipeB]),
      (e) => {
        assert.ok(e instanceof CompilationError);
        assert.ok(e.errors.some((s) => s.toLowerCase().includes("cycle")));
        return true;
      }
    );
  });
});
