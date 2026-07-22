"use strict";

/** Регрессии перехода с RC.5 на структурные wildcard-кандидаты RC.6. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { compileSnapshot, computeSourceHash, runPipeline, CompilationError } = require("..");

function snapshot(specVersion = "1.0.0-rc.6") {
  const value = {
    format: "jsonspecs-snapshot",
    formatVersion: 2,
    specVersion,
    exports: ["p"],
    artifacts: {
      p: { type: "pipeline", steps: ["r"] },
      r: {
        type: "rule",
        operator: "not_empty",
        field: "items[*].sku",
        aggregate: { mode: "ALL", onEmpty: "SKIP", issueMode: "EACH" },
        issue: { level: "ERROR", code: "ITEM.SKU.REQUIRED", message: "required" },
      },
    },
  };
  value.sourceHash = computeSourceHash(value);
  return value;
}

test("Rules 4.0.0 отклоняет snapshot RC.5", () => {
  assert.throws(
    () => compileSnapshot(snapshot("1.0.0-rc.5")),
    (error) => error instanceof CompilationError
      && error.diagnostics[0]?.code === "UNSUPPORTED_SPEC_VERSION",
  );
});

test("отсутствующий дочерний field сохраняет concrete wildcard path", () => {
  const prepared = compileSnapshot(snapshot());
  const payload = { items: [{ sku: "A" }, {}] };
  const result = runPipeline(prepared, { pipelineId: "p", payload });

  assert.equal(result.status, "ERROR");
  assert.deepEqual(result.issues, [{
    level: "ERROR",
    code: "ITEM.SKU.REQUIRED",
    message: "required",
    field: "items[1].sku",
    ruleId: "r",
    pipelineId: "p",
  }]);
  assert.deepEqual(payload, { items: [{ sku: "A" }, {}] });
});
