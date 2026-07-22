"use strict";

/** Контракт внешнего пакета: закрытая схема, inputs/params и immutable invocation. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine, computeSourceHash, CompilationError } = require("..");

const definition = {
  schema: {
    type: "object",
    properties: {
      inputs: { type: "object", properties: { age: { type: "string" } }, required: ["age"], additionalProperties: false },
      params: { type: "object", properties: { minimum: { type: "integer" } }, required: ["minimum"], additionalProperties: false },
    },
    required: ["inputs", "params"],
    additionalProperties: false,
  },
  evaluate(invocation) {
    assert(Object.isFrozen(invocation));
    assert(Object.isFrozen(invocation.inputs));
    if (!("age" in invocation.inputs)) return "SKIP";
    return invocation.inputs.age >= invocation.params.minimum ? "PASS" : "FAIL";
  },
};

function snapshot(extra = {}) {
  const value = {
    format: "jsonspecs-snapshot", formatVersion: 2, specVersion: "1.0.0-rc.5", exports: ["p"],
    artifacts: {
      p: { type: "pipeline", steps: ["r"] },
      r: {
        type: "rule", operator: "example.age", inputs: { age: "customer.age" }, params: { minimum: 18 },
        issue: { level: "ERROR", code: "AGE", message: "too young" }, ...extra,
      },
    },
  };
  value.sourceHash = computeSourceHash(value);
  return value;
}

test("custom operator receives resolved values and constants", () => {
  const engine = createEngine({ operators: { "example.age": definition } });
  const prepared = engine.compileSnapshot(snapshot());
  assert.equal(engine.runPipeline(prepared, { pipelineId: "p", payload: { customer: { age: 17 } } }).status, "ERROR");
  assert.equal(engine.runPipeline(prepared, { pipelineId: "p", payload: {} }).status, "OK");
});

test("operator JSON Schema closes configuration", () => {
  const engine = createEngine({ operators: { "example.age": definition } });
  assert.throws(() => engine.compileSnapshot(snapshot({ params: { minimum: 18, unknown: true } })), CompilationError);
});

test("open external contract is rejected as deployment configuration", () => {
  assert.throws(() => createEngine({
    operators: { "example.open": { schema: { type: "object", properties: {} }, evaluate: () => "PASS" } },
  }), /closed object schema/);
});
