"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validate, createEngine, Operators, CompilationError } = require("..");

function unknownOperatorRule() {
  return {
    id: "library.unknown",
    type: "rule",
    description: "unknown operator",
    role: "check",
    operator: "does_not_exist",
    field: "value",
    level: "ERROR",
    code: "UNKNOWN",
    message: "unknown",
  };
}

test("compiler phases produce diagnostic contract fields directly", () => {
  const artifact = unknownOperatorRule();
  const sources = new Map([[artifact.id, {
    file: "/rules/library/unknown.json",
    line: 12,
    column: 4,
  }]]);

  const result = validate([artifact], { sources });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "UNKNOWN_OPERATOR",
    level: "error",
    message: "Check rule library.unknown: unknown operator does_not_exist",
    phase: "schema_validation",
    artifactId: "library.unknown",
    path: "operator",
    location: "/rules/library/unknown.json:12:4",
    details: { operator: "does_not_exist", role: "check" },
  });
});

test("diagnostic messages do not contain an unknown-source placeholder", () => {
  const result = validate([unknownOperatorRule()]);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].location, null);
  assert.equal(result.diagnostics[0].message.includes("<unknown source>"), false);
});

test("throwing artifact getters remain typed compile diagnostics", () => {
  const artifact = {};
  Object.defineProperty(artifact, "id", { enumerable: true, get() { throw new Error("id getter boom"); } });
  const engine = createEngine({ operators: Operators });
  assert.throws(() => engine.compile([artifact]), (error) => {
    assert.ok(error instanceof CompilationError);
    assert.equal(error.diagnostics[0].code, "ARTIFACT_NOT_JSON_SAFE");
    assert.equal(error.diagnostics[0].phase, "source_validation");
    assert.equal(error.diagnostics[0].artifactId, null);
    assert.equal(error.diagnostics[0].path, "[0]");
    return true;
  });
});

test("reference diagnostics identify the exact source property", () => {
  const pipeline = {
    id: "entry.main",
    type: "pipeline",
    description: "entry",
    strict: false,
    entrypoint: true,
    flow: [{ rule: "library.missing" }],
  };
  const result = validate([pipeline], {
    sources: new Map([[pipeline.id, "/rules/entry/main.json"]]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "ARTIFACT_REF_NOT_FOUND");
  assert.equal(result.diagnostics[0].phase, "reference_validation");
  assert.equal(result.diagnostics[0].artifactId, pipeline.id);
  assert.equal(result.diagnostics[0].path, "flow[0].rule");
  assert.equal(result.diagnostics[0].location, "/rules/entry/main.json");
});

test("validation stops after the first phase that reports errors", () => {
  const badRule = unknownOperatorRule();
  const pipeline = {
    id: "entry.main",
    type: "pipeline",
    description: "entry",
    strict: false,
    entrypoint: true,
    flow: [{ rule: "library.missing" }],
  };

  const result = validate([badRule, pipeline]);
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.diagnostics.map((item) => item.phase)), new Set(["schema_validation"]));
  assert.equal(result.diagnostics.some((item) => item.code === "ARTIFACT_REF_NOT_FOUND"), false);
});

test("registry, uniqueness and DAG diagnostics retain structured provenance", () => {
  const duplicate = unknownOperatorRule();
  duplicate.operator = "not_empty";
  const registryResult = validate([duplicate, duplicate]);
  assert.deepEqual(
    pick(registryResult.diagnostics[0]),
    { code: "DUPLICATE_ARTIFACT_ID", phase: "registry_build", artifactId: duplicate.id, path: "id" },
  );

  const firstRule = { ...duplicate, id: "library.first", code: "SAME" };
  const secondRule = { ...duplicate, id: "library.second", code: "SAME" };
  const uniquenessResult = validate([firstRule, secondRule]);
  assert.deepEqual(
    pick(uniquenessResult.diagnostics[0]),
    { code: "DUPLICATE_CHECK_CODE", phase: "uniqueness_validation", artifactId: secondRule.id, path: "code" },
  );

  const firstPipeline = {
    id: "first",
    type: "pipeline",
    description: "first",
    strict: false,
    entrypoint: true,
    flow: [{ pipeline: "second" }],
  };
  const secondPipeline = {
    id: "second",
    type: "pipeline",
    description: "second",
    strict: false,
    entrypoint: false,
    flow: [{ pipeline: "first" }],
  };
  const dagResult = validate([firstPipeline, secondPipeline]);
  assert.deepEqual(
    pick(dagResult.diagnostics[0]),
    { code: "PIPELINE_CYCLE", phase: "dag_validation", artifactId: "first", path: "flow" },
  );
});

function pick(diagnostic) {
  const { code, phase, artifactId, path } = diagnostic;
  return { code, phase, artifactId, path };
}
