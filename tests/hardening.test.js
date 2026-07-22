"use strict";

/** Регрессии JS-периметра, которые невыразимы обычными JSON-фикстурами. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { compileSnapshot, compileSnapshotText, computeSourceHash, runPipeline, CompilationError } = require("..");

function snapshot(rule = { type: "rule", operator: "not_empty", field: "x", issue: { level: "ERROR", code: "X", message: "x" } }) {
  const value = {
    format: "jsonspecs-snapshot", formatVersion: 2, specVersion: "1.0.0-rc.6", exports: ["p"],
    artifacts: { p: { type: "pipeline", steps: ["r"] }, r: rule },
  };
  value.sourceHash = computeSourceHash(value);
  return value;
}

test("strict text adapter rejects duplicate members before JSON.parse loses them", () => {
  const text = JSON.stringify(snapshot()).replace('"formatVersion":2', '"formatVersion":2,"formatVersion":2');
  assert.throws(() => compileSnapshotText(text), CompilationError);
});

test("self-throwing snapshot proxy is contained as CompilationError", () => {
  let hostile;
  hostile = new Proxy({}, {
    getPrototypeOf() { throw hostile; },
    get() { throw hostile; },
  });
  assert.throws(() => compileSnapshot(hostile), CompilationError);
});

test("hostile payload proxy remains inside structured ABORT", () => {
  const prepared = compileSnapshot(snapshot());
  const payload = new Proxy({}, { ownKeys() { throw new Error("hostile"); } });
  assert.doesNotThrow(() => runPipeline(prepared, { pipelineId: "p", payload }));
  assert.equal(runPipeline(prepared, { pipelineId: "p", payload }).status, "ABORT");
});

test("self-throwing proxies cannot escape and retain payload/context classification", () => {
  const prepared = compileSnapshot(snapshot());
  let hostilePayload;
  hostilePayload = new Proxy({}, { getPrototypeOf() { throw hostilePayload; } });
  let hostileContext;
  hostileContext = new Proxy({}, { getPrototypeOf() { throw hostileContext; } });

  let payloadResult;
  assert.doesNotThrow(() => {
    payloadResult = runPipeline(prepared, { pipelineId: "p", payload: hostilePayload });
  });
  assert.equal(payloadResult.status, "ABORT");
  assert.equal(payloadResult.error.code, "INVALID_PAYLOAD");

  let contextResult;
  assert.doesNotThrow(() => {
    contextResult = runPipeline(prepared, { pipelineId: "p", payload: { x: "ok" }, context: hostileContext });
  });
  assert.equal(contextResult.status, "ABORT");
  assert.equal(contextResult.error.code, "INVALID_CONTEXT");
});

test("sparse arrays are rejected as non-I-JSON input", () => {
  const prepared = compileSnapshot(snapshot());
  const items = [];
  items.length = 2;
  const result = runPipeline(prepared, { pipelineId: "p", payload: { items, x: "ok" } });
  assert.equal(result.status, "ABORT");
  assert.equal(result.error.code, "INVALID_PAYLOAD");
});

test("cyclic host values abort without blocking the runtime", () => {
  const prepared = compileSnapshot(snapshot());
  const payload = { x: "ok" };
  payload.self = payload;
  const payloadResult = runPipeline(prepared, { pipelineId: "p", payload });
  assert.equal(payloadResult.status, "ABORT");
  assert.equal(payloadResult.error.code, "INVALID_PAYLOAD");

  const context = {};
  context.self = context;
  const contextResult = runPipeline(prepared, { pipelineId: "p", payload: { x: "ok" }, context });
  assert.equal(contextResult.status, "ABORT");
  assert.equal(contextResult.error.code, "INVALID_CONTEXT");
});

test("large sparse arrays are rejected without scanning their declared length", () => {
  const prepared = compileSnapshot(snapshot());
  const items = [];
  items.length = 0xffffffff;
  const result = runPipeline(prepared, { pipelineId: "p", payload: { items, x: "ok" } });
  assert.equal(result.status, "ABORT");
  assert.equal(result.error.code, "INVALID_PAYLOAD");
});

test("acyclic shared host objects remain representable as JSON trees", () => {
  const prepared = compileSnapshot(snapshot());
  const shared = { value: "ok" };
  const result = runPipeline(prepared, {
    pipelineId: "p",
    payload: { x: "ok", left: shared, right: shared },
  });
  assert.equal(result.status, "OK");
});

test("any_filled cannot hide wildcard semantics inside fields", () => {
  const value = snapshot({
    type: "rule", operator: "any_filled", fields: ["items[*].x"],
    issue: { level: "ERROR", code: "X", message: "x" },
  });
  assert.throws(() => compileSnapshot(value), CompilationError);
});

test("nested quantifier executes through linear RE2 backend", () => {
  const value = snapshot({
    type: "rule", operator: "matches_regex", field: "x", value: "^(a+)+$",
    issue: { level: "ERROR", code: "X", message: "x" },
  });
  const prepared = compileSnapshot(value);
  const result = runPipeline(prepared, { pipelineId: "p", payload: { x: `${"a".repeat(100000)}!` } });
  assert.equal(result.status, "ERROR");
});

test("empty complemented regex class compiles as a never-matching expression", () => {
  const value = snapshot({
    type: "rule", operator: "matches_regex", field: "x", value: "^[^\\D\\d]$",
    issue: { level: "ERROR", code: "X", message: "x" },
  });
  const prepared = compileSnapshot(value);
  for (const field of ["", "a", "\n"])
    assert.equal(runPipeline(prepared, { pipelineId: "p", payload: { x: field } }).status, "ERROR");
});

test("counted regex quantifiers reject leading zeros", () => {
  const value = snapshot({
    type: "rule", operator: "matches_regex", field: "x", value: "a{01}",
    issue: { level: "ERROR", code: "X", message: "x" },
  });
  assert.throws(() => compileSnapshot(value), CompilationError);
});

test("deep valid control-flow graph compiles and executes without call-stack overflow", () => {
  const depth = 10000;
  const artifacts = Object.create(null);
  for (let index = 0; index < depth; index++) {
    artifacts[`p${index}`] = { type: "pipeline", steps: [index + 1 < depth ? `p${index + 1}` : "r"] };
  }
  artifacts.r = {
    type: "rule", operator: "not_empty", field: "x",
    issue: { level: "ERROR", code: "X", message: "x" },
  };
  const value = {
    format: "jsonspecs-snapshot", formatVersion: 2, specVersion: "1.0.0-rc.6",
    exports: ["p0"], artifacts,
  };
  value.sourceHash = computeSourceHash(value);
  const prepared = compileSnapshot(value);
  assert.equal(runPipeline(prepared, { pipelineId: "p0", payload: { x: "ok" } }).status, "OK");
});
