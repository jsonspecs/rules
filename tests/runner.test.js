"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createEngine, Operators } = require("..");

const engine = createEngine({ operators: Operators });

// ── helpers ────────────────────────────────────────────────────────────────

function rule(id, operator, field, level, code, extra = {}) {
  return {
    id,
    type: "rule",
    description: id,
    role: "check",
    operator,
    field,
    level,
    code,
    message: `${code} failed`,
    ...extra,
  };
}

function predicate(id, operator, field, extra = {}) {
  return {
    id,
    type: "rule",
    description: id,
    role: "predicate",
    operator,
    field,
    ...extra,
  };
}

function pipeline(id, flow, extra = {}) {
  return {
    id,
    type: "pipeline",
    description: id,
    entrypoint: true,
    strict: false,
    flow,
    ...extra,
  };
}

function condition(id, when, steps) {
  return { id, type: "condition", description: id, when, steps };
}

function compile(artifacts) {
  return engine.compile(artifacts);
}

// ── basic status values ────────────────────────────────────────────────────

describe("runner — status OK", () => {
  it("returns OK when all checks pass", () => {
    const r = rule("library.r", "not_empty", "name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { name: "Ivan" });
    assert.equal(result.status, "OK");
    assert.equal(result.control, "CONTINUE");
    assert.equal(result.issues.length, 0);
  });
});

describe("runner — status ERROR", () => {
  it("returns ERROR when check fails", () => {
    const r = rule("library.r", "not_empty", "name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { name: "" });
    assert.equal(result.status, "ERROR");
    assert.equal(result.control, "STOP");
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, "NAME.REQUIRED");
    assert.equal(result.issues[0].level, "ERROR");
    assert.equal(result.issues[0].field, "name");
    assert.equal(result.issues[0].ruleId, "library.r");
  });
});

describe("runner — status OK_WITH_WARNINGS", () => {
  it("returns OK_WITH_WARNINGS when only warnings present", () => {
    const r = rule("library.r", "not_empty", "phone", "WARNING", "PHONE.SOFT");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { phone: "" });
    assert.equal(result.status, "OK_WITH_WARNINGS");
    assert.equal(result.control, "CONTINUE");
    assert.equal(result.issues[0].level, "WARNING");
  });
});

describe("runner — EXCEPTION stops pipeline", () => {
  it("stops after EXCEPTION and does not run subsequent rules", () => {
    const r1 = rule("library.r1", "not_empty", "doc", "EXCEPTION", "DOC.BLOCK");
    const r2 = rule("library.r2", "not_empty", "name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r1" }, { rule: "library.r2" }]);
    const compiled = compile([r1, r2, p]);
    const result = engine.runPipeline(compiled, "p", { doc: "", name: "" });
    assert.equal(result.status, "EXCEPTION");
    assert.equal(result.control, "STOP");
    // r2 should not have run
    assert.ok(!result.issues.some((i) => i.code === "NAME.REQUIRED"),
      "NAME.REQUIRED should not appear after EXCEPTION");
  });
});

describe("runner — accumulates all issues (no early stop on ERROR)", () => {
  it("collects issues from both rules when both fail", () => {
    const r1 = rule("library.r1", "not_empty", "name", "ERROR", "NAME.REQUIRED");
    const r2 = rule("library.r2", "not_empty", "inn", "ERROR", "INN.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r1" }, { rule: "library.r2" }]);
    const compiled = compile([r1, r2, p]);
    const result = engine.runPipeline(compiled, "p", { name: "", inn: "" });
    assert.equal(result.status, "ERROR");
    assert.equal(result.issues.length, 2);
  });
});

// ── nested JSON vs flat payload ────────────────────────────────────────────

describe("runner — nested JSON payload", () => {
  it("accepts nested JSON and resolves dot-notation fields correctly", () => {
    const r = rule("library.r", "not_empty", "person.name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    assert.equal(
      engine.runPipeline(compiled, "p", { person: { name: "Ivan" } }).status,
      "OK"
    );
    assert.equal(
      engine.runPipeline(compiled, "p", { person: { name: "" } }).status,
      "ERROR"
    );
  });
});

describe("runner — flat map payload", () => {
  it("accepts flat map payload", () => {
    const r = rule("library.r", "not_empty", "person.name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    assert.equal(
      engine.runPipeline(compiled, "p", { "person.name": "Ivan" }).status,
      "OK"
    );
  });
});

// ── wildcard fields ────────────────────────────────────────────────────────

describe("runner — wildcard field check", () => {
  it("checks all matching array elements", () => {
    const r = rule("library.r", "not_empty", "items[*].name", "ERROR", "ITEM.NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", {
      items: [{ name: "A" }, { name: "" }, { name: "C" }],
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].field, "items[1].name");
  });
});

// ── conditional block ──────────────────────────────────────────────────────

describe("runner — condition: skips block when predicate is false", () => {
  it("does not run checks when when-predicate is false", () => {
    const pred = predicate("library.pred_foreign", "equals", "isForeign", { value: true });
    const check = rule("library.check_tin", "not_empty", "tin", "ERROR", "TIN.REQUIRED");
    const cond = condition(
      "library.cond_foreign_block",
      { all: ["library.pred_foreign"] },
      [{ rule: "library.check_tin" }]
    );
    const p = pipeline("p", [{ condition: "library.cond_foreign_block" }]);
    const compiled = compile([pred, check, cond, p]);
    // isForeign = false → block skipped → tin not checked
    const result = engine.runPipeline(compiled, "p", { isForeign: false, tin: "" });
    assert.equal(result.status, "OK");
    assert.equal(result.issues.length, 0);
  });
});

describe("runner — condition: runs block when predicate is true", () => {
  it("runs checks when when-predicate is true", () => {
    const pred = predicate("library.pred_foreign", "equals", "isForeign", { value: true });
    const check = rule("library.check_tin", "not_empty", "tin", "ERROR", "TIN.REQUIRED");
    const cond = condition(
      "library.cond_foreign_block",
      { all: ["library.pred_foreign"] },
      [{ rule: "library.check_tin" }]
    );
    const p = pipeline("p", [{ condition: "library.cond_foreign_block" }]);
    const compiled = compile([pred, check, cond, p]);
    // isForeign = true → block runs → tin missing → error
    const result = engine.runPipeline(compiled, "p", { isForeign: true, tin: "" });
    assert.equal(result.status, "ERROR");
    assert.equal(result.issues[0].code, "TIN.REQUIRED");
  });
});

// ── matches_regex ──────────────────────────────────────────────────────────

describe("runner — matches_regex", () => {
  it("passes when value matches pattern", () => {
    const r = rule("library.r", "matches_regex", "inn", "ERROR", "INN.FORMAT",
      { value: "^\\d{12}$" });
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    assert.equal(engine.runPipeline(compiled, "p", { inn: "123456789012" }).status, "OK");
  });

  it("fails when value does not match pattern", () => {
    const r = rule("library.r", "matches_regex", "inn", "ERROR", "INN.FORMAT",
      { value: "^\\d{12}$" });
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    assert.equal(engine.runPipeline(compiled, "p", { inn: "abc" }).status, "ERROR");
  });

  it("flags: i makes match case-insensitive", () => {
    const r = rule("library.r", "matches_regex", "code", "ERROR", "CODE.FORMAT",
      { value: "^[a-z]+$", flags: "i" });
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    assert.equal(engine.runPipeline(compiled, "p", { code: "ABC" }).status, "OK");
  });
});

// ── trace toggle ───────────────────────────────────────────────────────────

describe("runner — trace option", () => {
  it("omits trace by default", () => {
    const r = rule("library.r", "not_empty", "x", "ERROR", "X");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { x: "v" });
    assert.equal(Object.hasOwn(result, "trace"), false);
  });

  it("omits trace when trace:false", () => {
    const r = rule("library.r", "not_empty", "x", "ERROR", "X");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { x: "v" }, { trace: false });
    assert.equal(Object.hasOwn(result, "trace"), false);
  });
});

// ── $context fields ────────────────────────────────────────────────────────

describe("runner — $context fields", () => {
  it("resolves $context.* fields from __context", () => {
    const r = {
      id: "library.r",
      type: "rule",
      description: "doc not expired",
      role: "check",
      operator: "field_greater_or_equal_than_field",
      field: "doc.expireDate",
      value_field: "$context.currentDate",
      level: "ERROR",
      code: "DOC.EXPIRED",
      message: "Document expired",
    };
    const p = {
      id: "p",
      type: "pipeline",
      description: "p",
      entrypoint: true,
      strict: false,
      required_context: ["currentDate"],
      flow: [{ rule: "library.r" }],
    };
    const compiled = compile([r, p]);
    const ok = engine.runPipeline(compiled, "p", {
      doc: { expireDate: "2030-01-01" },
      __context: { currentDate: "2024-01-01" },
    });
    assert.equal(ok.status, "OK");

    const expired = engine.runPipeline(compiled, "p", {
      doc: { expireDate: "2020-01-01" },
      __context: { currentDate: "2024-01-01" },
    });
    assert.equal(expired.status, "ERROR");
    assert.equal(expired.issues[0].code, "DOC.EXPIRED");
  });
});


describe("runner — top-level strict pipeline", () => {
  it("escalates ERROR issues to EXCEPTION at pipeline boundary", () => {
    const r = rule("library.r", "not_empty", "name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }], { strict: true, message: "Top-level strict failed", strictCode: "TOP.STRICT" });
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { name: "" });

    assert.equal(result.status, "EXCEPTION");
    assert.equal(result.control, "STOP");
    assert.equal(result.issues.length, 2);
    assert.equal(result.issues[0].code, "NAME.REQUIRED");
    assert.equal(result.issues[1].code, "TOP.STRICT");
    assert.equal(result.issues[1].level, "EXCEPTION");
    assert.equal(result.issues[1].ruleId, "pipeline:p");
    assert.equal(result.issues[1].pipelineId, "p");
    assert.equal(result.issues[1].field, null);
  });

  it("does not escalate when strict pipeline has no ERROR/EXCEPTION issues", () => {
    const r = rule("library.r", "not_empty", "name", "WARNING", "NAME.SOFT");
    const p = pipeline("p", [{ rule: "library.r" }], { strict: true, message: "Top-level strict failed", strictCode: "TOP.STRICT" });
    const compiled = compile([r, p]);
    const result = engine.runPipeline(compiled, "p", { name: "" });

    assert.equal(result.status, "OK_WITH_WARNINGS");
    assert.equal(result.control, "CONTINUE");
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].code, "NAME.SOFT");
  });
});

describe("compiler — compiled bundle is detached from source artifacts", () => {
  it("does not observe mutations to source artifacts after compile", () => {
    const r = rule("library.r", "not_empty", "name", "ERROR", "NAME.REQUIRED");
    const p = pipeline("p", [{ rule: "library.r" }]);
    const artifacts = [r, p];
    const compiled = compile(artifacts);

    artifacts[0].field = "mutated.field";
    artifacts[0].operator = "equals";
    artifacts[0].value = "unexpected";
    artifacts[1].flow.push({ rule: "library.missing" });

    const result = engine.runPipeline(compiled, "p", { name: "Ivan" });
    assert.equal(result.status, "OK");
    assert.equal(result.issues.length, 0);

    const storedRule = engine.inspect(compiled).getArtifact("library.r");
    assert.equal(storedRule.field, "name");
    assert.equal(storedRule.operator, "not_empty");
    assert.ok(Object.isFrozen(storedRule));
  });
});


describe("runner — custom operators use ctx.get/ctx.has", () => {
  it("supports custom operators without importing deepGet", () => {
    const custom = {
      check: {
        custom_not_empty(rule, ctx) {
          const got = ctx.get(rule.field);
          return {
            status: got.ok && String(got.value ?? "").trim() !== "" ? "OK" : "FAIL",
            actual: got.ok ? got.value : undefined,
          };
        },
      },
      predicate: {
        field_present(rule, ctx) {
          return { status: ctx.has(rule.field) ? "TRUE" : "FALSE" };
        },
      },
    };

    const engine2 = createEngine({
      operators: {
        check: { ...Operators.check, ...custom.check },
        predicate: { ...Operators.predicate, ...custom.predicate },
      },
    });

    const r = rule("library.r", "custom_not_empty", "person.name", "ERROR", "NAME.REQUIRED");
    const pred = predicate("library.pred", "field_present", "person.name");
    const cond = condition("library.cond", { all: ["library.pred"] }, [{ rule: "library.r" }]);
    const p = pipeline("p", [{ condition: "library.cond" }]);
    const compiled = engine2.compile([r, pred, cond, p]);

    assert.equal(engine2.runPipeline(compiled, "p", { person: { name: "Ivan" } }).status, "OK");
    assert.equal(engine2.runPipeline(compiled, "p", { person: { name: "" } }).status, "ERROR");
    assert.equal(engine2.runPipeline(compiled, "p", { person: {} }).status, "OK");
  });
});
