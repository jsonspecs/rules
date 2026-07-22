"use strict";

/**
 * Прогон нормативного приложения jsonspecs/spec 1.0.0-rc.5.
 *
 * Фикстуры привязаны к commit из tests/conformance/spec-commit.txt. Для каждого
 * файла создаётся registry ровно из `operators[]`: так проверяется относительная
 * природа OPERATOR_NOT_FOUND, а зарезервированные conformance.* не протекают в
 * production default engine.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createEngine, CompilationError } = require("..");

const FIXTURES = path.join(__dirname, "..", "tests", "conformance", "fixtures");
const files = [];
walk(FIXTURES, files);

const definitions = {
  "conformance.rule.throw": operator(emptySchema(), () => { throw new Error("conformance throw"); }),
  "conformance.rule.invalid_result": operator(emptySchema(), () => "EXCEPTION"),
  "conformance.rule.tri": operator(configSchema({ field: pathSchema() }, ["field"]), (input) => {
    if (input.field === "THROW") throw new Error("conformance throw");
    return ["PASS", "FAIL", "SKIP"].includes(input.field) ? input.field : "FAIL";
  }),
  "conformance.rule.params": operator(configSchema({
    params: {
      type: "object",
      properties: { outcome: { enum: ["PASS", "FAIL", "SKIP"] } },
      required: ["outcome"],
      additionalProperties: false,
    },
  }, ["params"]), (input) => input.params.outcome),
  "conformance.rule.inputs": operator(configSchema({
    inputs: {
      type: "object",
      properties: { missing: pathSchema(), nullValue: pathSchema() },
      required: ["missing", "nullValue"],
      additionalProperties: false,
    },
  }, ["inputs"]), (input) =>
    !Object.prototype.hasOwnProperty.call(input.inputs, "missing") && input.inputs.nullValue === null ? "PASS" : "FAIL"),
};

let passed = 0;
const failures = [];
for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const operators = Object.fromEntries((fixture.operators || []).map((name) => [name, definitions[name]]));
  try {
    const engine = createEngine({ operators });
    if (fixture.expected.verdict === "reject") {
      let error = null;
      try {
        if (fixture.snapshotText !== undefined) engine.compileSnapshotText(fixture.snapshotText);
        else engine.compileSnapshot(fixture.snapshot);
      } catch (caught) { error = caught; }
      assert(error instanceof CompilationError, "snapshot was accepted");
      if (fixture.expected.identifier) assert.equal(error.identifier, fixture.expected.identifier);
    } else {
      const prepared = engine.compileSnapshot(fixture.snapshot);
      const actual = engine.runPipeline(prepared, fixture.input);
      assert.deepStrictEqual(actual, fixture.expected);
    }
    passed++;
  } catch (error) {
    failures.push({ name: fixture.name, file: path.relative(FIXTURES, file), error });
  }
}

if (failures.length) {
  console.error(`FAIL: ${failures.length}/${files.length} conformance fixtures`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.name} (${failure.file})`);
    console.error(failure.error.stack || failure.error);
  }
  process.exitCode = 1;
} else console.log(`OK: ${passed} conformance fixtures`);

function walk(directory, out) {
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file, out);
    else if (name.endsWith(".json")) out.push(file);
  }
}

function operator(schema, evaluate) { return { schema, evaluate }; }
function pathSchema() { return { type: "string", minLength: 1 }; }
function emptySchema() { return configSchema({}, []); }
function configSchema(properties, required) {
  return { type: "object", properties, required, additionalProperties: false };
}
