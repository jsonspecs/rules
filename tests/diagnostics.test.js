"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validate, createEngine, Operators, CompilationError } = require("..");
const nominalBeneficiariesRegexPatterns = require("./fixtures/nominal-beneficiaries-regex-patterns.json");

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

test("validate accepts allowed matches_regex flags for checks and predicates", () => {
  for (const flags of ["i", "im"]) {
    assert.equal(validate([regexRule({ flags })]).ok, true, flags);
    assert.equal(validate([regexRule({ role: "predicate", flags })]).ok, true, `predicate ${flags}`);
  }
});

test("validate reports ReDoS warnings without failing compilation", () => {
  for (const value of ["^(a+)+$", "^(a|aa)+$", "(a|a)+", "(\\d*)*", "(a+){2,}"]) {
    const result = validate([regexRule({ value })]);
    assert.equal(result.ok, true, value);
    assert.equal(result.diagnostics.length, 1, value);
    assert.equal(result.diagnostics[0].code, "REGEX_REDOS_RISK");
    assert.equal(result.diagnostics[0].level, "warning");
    assert.equal(result.diagnostics[0].path, "value");
    assert.equal(result.diagnostics[0].details.findings.length > 0, true);
  }
});

test("ReDoS lint does not warn for bounded outer nested quantifiers", () => {
  const safePatterns = [
    "^[A-Za-zА-Яа-яЁё](?:[A-Za-zА-Яа-яЁё -]*[A-Za-zА-Яа-яЁё])?$",
    "(?:a*b)?",
    "(a+){2}",
    "(a+){2,5}",
  ];
  for (const value of safePatterns) {
    const result = validate([regexRule({ value })]);
    assert.equal(result.ok, true, value);
    assert.equal(result.diagnostics.some((item) => item.code === "REGEX_REDOS_RISK"), false, value);
  }
});

test("nominal-beneficiaries matches_regex corpus has no ReDoS warnings", () => {
  assert.equal(nominalBeneficiariesRegexPatterns.length, 68);
  for (const fixture of nominalBeneficiariesRegexPatterns) {
    const result = validate([regexRule({ id: fixture.artifactId, value: fixture.value })]);
    assert.equal(result.ok, true, fixture.artifactId);
    assert.equal(result.diagnostics.some((item) => item.code === "REGEX_REDOS_RISK"), false, fixture.artifactId);
  }
});

test("compiled artifacts retain ReDoS warnings for inspection", () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile([regexRule({ value: "^(a+)+$" })]);
  assert.equal(prepared.diagnostics.length, 1);
  assert.equal(prepared.diagnostics[0].code, "REGEX_REDOS_RISK");
  assert.equal(prepared.diagnostics[0].level, "warning");
});

test("ReDoS lint does not warn on the known lookahead migration case", () => {
  const result = validate([regexRule({ value: "^(?!RU$)[A-Z]{2}$" })]);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.some((item) => item.code === "REGEX_REDOS_RISK"), false);
});

test("validate rejects invalid matches_regex flags for checks", () => {
  for (const flags of ["g", "u", "ii", 42]) {
    const result = validate([regexRule({ flags })]);
    assert.equal(result.ok, false, String(flags));
    assert.equal(result.diagnostics[0].code, "RULE_REGEX_FLAGS_INVALID");
    assert.equal(result.diagnostics[0].path, "flags");
  }
});

test("validate rejects invalid matches_regex flags for predicates", () => {
  const predicateResult = validate([regexRule({ role: "predicate", flags: "g" })]);
  assert.equal(predicateResult.ok, false);
  assert.equal(predicateResult.diagnostics[0].code, "RULE_REGEX_FLAGS_INVALID");
  assert.equal(predicateResult.diagnostics[0].path, "flags");
});

test("validate rejects null dictionary entries and accepts scalar/object entries", () => {
  const bad = validate([{ id: "dict.bad", type: "dictionary", description: "bad", entries: [null] }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].code, "DICTIONARY_ENTRY_INVALID");
  assert.equal(bad.diagnostics[0].path, "entries[0]");

  const good = validate([{ id: "dict.good", type: "dictionary", description: "good", entries: ["a", { code: "b" }] }]);
  assert.equal(good.ok, true);
});

test("artifact source depth limit returns structured diagnostics", () => {
  const artifacts = [
    {
      ...regexRule({ value: "^x$" }),
      meta: nestedObject(300),
    },
  ];
  const result = validate(artifacts);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "ARTIFACT_TOO_DEEP");
  assert.equal(result.diagnostics[0].phase, "source_validation");
  assert.equal(result.diagnostics[0].path.startsWith("meta."), true);
  assert.equal(result.diagnostics[0].details.maxDepth, 256);
});

function regexRule(overrides = {}) {
  const role = overrides.role || "check";
  const base = {
    id: "library.regex",
    type: "rule",
    description: "regex",
    role,
    operator: "matches_regex",
    field: "value",
    value: "^x$",
  };
  if (role === "check") {
    base.level = "ERROR";
    base.code = "VALUE.REGEX";
    base.message = "regex failed";
  }
  return { ...base, ...overrides };
}

function pick(diagnostic) {
  const { code, phase, artifactId, path } = diagnostic;
  return { code, phase, artifactId, path };
}

function nestedObject(depth) {
  let value = "leaf";
  for (let index = 0; index < depth; index++) value = { x: value };
  return value;
}
