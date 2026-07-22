"use strict";

/** Базовые тесты API дополняют полный нормативный conformance-прогон. */

const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("..");

test("CommonJS и ESM публикуют новый fv2 API", async () => {
  for (const name of ["createEngine", "compileSnapshot", "compileSnapshotText", "runPipeline", "computeSourceHash"])
    assert.equal(typeof api[name], "function");
  const esm = await import("../index.mjs");
  assert.equal(typeof esm.createEngine, "function");
});

test("built-in operator нельзя подменить внешним пакетом", () => {
  assert.throws(() => api.createEngine({
    operators: { equals: { schema: { type: "object" }, evaluate: () => "PASS" } },
  }), /cannot be replaced/);
});

test("экспортированные определения built-in операторов глубоко неизменяемы", () => {
  const schema = api.builtInOperators.not_empty.schema;
  assert(Object.isFrozen(api.builtInOperators.not_empty));
  assert(Object.isFrozen(schema));
  assert(Object.isFrozen(schema.properties));
  assert(Object.isFrozen(schema.properties.field));
  assert(Object.isFrozen(schema.required));
  assert.throws(() => { schema.required.length = 0; }, TypeError);

  const snapshot = {
    format: "jsonspecs-snapshot", formatVersion: 2, specVersion: "1.0.0-rc.5", exports: ["p"],
    artifacts: {
      p: { type: "pipeline", steps: ["r"] },
      r: { type: "rule", operator: "not_empty", issue: { level: "ERROR", code: "X", message: "x" } },
    },
  };
  snapshot.sourceHash = api.computeSourceHash(snapshot);
  assert.throws(() => api.createEngine().compileSnapshot(snapshot), api.CompilationError);
});
