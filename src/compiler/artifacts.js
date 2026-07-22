"use strict";

/**
 * Закрытые схемы четырёх типов артефактов.
 *
 * Файл валидирует локальную форму без обхода ссылок: это отдельная фаза, чтобы
 * ошибка в структуре не порождала каскад фиктивных REF_NOT_FOUND. Контракт
 * конкретного оператора применяется только когда оператор зарегистрирован;
 * неизвестное имя откладывается до нормативной проверки OPERATOR_NOT_FOUND.
 */

const { reject } = require("../errors");
const { compileRegex } = require("../regex");
const { scalarEquals } = require("../operators/comparison");
const { BUILT_IN_NAMES } = require("../operators/builtins");
const { isPath, hasWildcard } = require("./paths");
const { operatorConfig, formatAjvErrors } = require("./contracts");

const TYPES = new Set(["rule", "condition", "pipeline", "dictionary"]);
const LEVELS = new Set(["WARNING", "ERROR", "EXCEPTION"]);
const COMMON_RULE = new Set(["type", "operator", "field", "fields", "value", "value_field", "dictionary", "inputs", "params", "aggregate", "issue"]);

function validateArtifacts(snapshot, registry, validators) {
  const artifacts = snapshot.artifacts;
  const issueCodes = new Set();
  const unknownOperators = new Set();
  for (const [id, artifact] of Object.entries(artifacts)) {
    if (!id) reject("INVALID_ARTIFACT_ID", "Artifact id must be non-empty");
    if (!plain(artifact) || !TYPES.has(artifact.type)) reject("INVALID_ARTIFACT", `Artifact ${id} has invalid type`, { artifactId: id });
    if (artifact.type === "rule") validateRule(id, artifact, registry, validators, issueCodes, unknownOperators);
    else if (artifact.type === "condition") validateCondition(id, artifact);
    else if (artifact.type === "pipeline") validatePipeline(id, artifact);
    else validateDictionary(id, artifact);
  }
  return unknownOperators;
}

function validateRule(id, rule, registry, validators, issueCodes, unknownOperators) {
  closed(id, rule, COMMON_RULE);
  if (typeof rule.operator !== "string" || !rule.operator) reject("INVALID_RULE", `Rule ${id} needs a non-empty operator`, { artifactId: id });
  validateIssue(id, rule.issue, issueCodes);
  validatePaths(id, rule);
  validateAggregate(id, rule);
  if (rule.value !== undefined && rule.value_field !== undefined)
    reject("INVALID_RULE", `Rule ${id} cannot configure both value and value_field`, { artifactId: id });
  if (rule.dictionary !== undefined && (typeof rule.dictionary !== "string" || !rule.dictionary))
    reject("INVALID_RULE", `Rule ${id} dictionary must be a non-empty id`, { artifactId: id });
  if (rule.params !== undefined && !plain(rule.params))
    reject("INVALID_RULE", `Rule ${id} params must be an object`, { artifactId: id });
  if (!BUILT_IN_NAMES.includes(rule.operator) && rule.fields !== undefined)
    reject("INVALID_RULE", `Rule ${id}: fields is reserved for built-in any_filled`, { artifactId: id });

  const definition = registry[rule.operator];
  if (!definition) {
    unknownOperators.add(rule.operator);
    return;
  }
  const config = operatorConfig(rule);
  const validator = validators[rule.operator];
  if (!validator(config)) reject("OPERATOR_SCHEMA_MISMATCH", `Rule ${id} violates ${rule.operator} contract: ${formatAjvErrors(validator.errors)}`, { artifactId: id });
  if (definition.validateConfig) {
    const problem = definition.validateConfig(config);
    if (problem) reject("OPERATOR_SCHEMA_MISMATCH", `Rule ${id}: ${problem}`, { artifactId: id });
  }
  if ((rule.operator === "matches_regex" || rule.operator === "not_matches_regex") && typeof rule.value === "string") {
    try { compileRegex(rule.value); }
    catch (error) { reject("INVALID_REGEX_PATTERN", `Rule ${id}: ${error.message}`, { artifactId: id }); }
  }
}

function validateIssue(id, issue, codes) {
  if (issue === undefined) return;
  if (!plain(issue)) reject("INVALID_ISSUE", `Rule ${id} issue must be an object`, { artifactId: id });
  closed(id, issue, new Set(["level", "code", "message", "meta"]), "issue");
  if (!LEVELS.has(issue.level) || typeof issue.code !== "string" || !issue.code || typeof issue.message !== "string" || !issue.message)
    reject("INVALID_ISSUE", `Rule ${id} issue requires level, non-empty code and message`, { artifactId: id });
  if (issue.meta !== undefined && !plain(issue.meta)) reject("INVALID_ISSUE", `Rule ${id} issue.meta must be an object`, { artifactId: id });
  if (codes.has(issue.code)) reject("DUPLICATE_ISSUE_CODE", `Duplicate issue code ${issue.code}`, { artifactId: id });
  codes.add(issue.code);
}

function validatePaths(id, rule) {
  if (rule.field !== undefined && !isPath(rule.field)) reject("INVALID_PATH", `Rule ${id} has invalid field path`, { artifactId: id, path: "field" });
  if (rule.value_field !== undefined && !isPath(rule.value_field, { wildcard: false })) reject("INVALID_PATH", `Rule ${id} has invalid value_field path`, { artifactId: id, path: "value_field" });
  if (rule.fields !== undefined) {
    if (!Array.isArray(rule.fields) || !rule.fields.length || rule.fields.some((item) => !isPath(item, { wildcard: false })))
      reject("INVALID_PATH", `Rule ${id} has invalid fields`, { artifactId: id, path: "fields" });
  }
  if (rule.inputs !== undefined) {
    if (!plain(rule.inputs)) reject("INVALID_INPUTS", `Rule ${id} inputs must be an object`, { artifactId: id });
    for (const [name, path] of Object.entries(rule.inputs)) {
      if (!name || !isPath(path, { wildcard: false })) reject("INVALID_INPUTS", `Rule ${id} has invalid input ${name}`, { artifactId: id, path: `inputs.${name}` });
    }
  }
}

function validateAggregate(id, rule) {
  const wildcard = hasWildcard(rule.field);
  if (wildcard !== (rule.aggregate !== undefined)) reject("INVALID_AGGREGATE", `Rule ${id} must use aggregate exactly with wildcard field`, { artifactId: id });
  if (!wildcard) return;
  const aggregate = rule.aggregate;
  if (!plain(aggregate)) reject("INVALID_AGGREGATE", `Rule ${id} aggregate must be an object`, { artifactId: id });
  closed(id, aggregate, new Set(["mode", "onEmpty", "issueMode", "op", "value"]), "aggregate");
  if (!["ALL", "ANY", "COUNT"].includes(aggregate.mode)) reject("INVALID_AGGREGATE", `Rule ${id} has invalid aggregate.mode`, { artifactId: id });
  if (aggregate.onEmpty !== undefined && !["PASS", "FAIL", "SKIP"].includes(aggregate.onEmpty)) reject("INVALID_AGGREGATE", `Rule ${id} has invalid onEmpty`, { artifactId: id });
  if (aggregate.mode === "COUNT") {
    if (aggregate.issueMode !== undefined || !["==", "!=", ">", ">=", "<", "<="].includes(aggregate.op ?? ">=") || !Number.isInteger(aggregate.value) || aggregate.value < 0)
      reject("INVALID_AGGREGATE", `Rule ${id} has invalid COUNT settings`, { artifactId: id });
  } else {
    if (aggregate.op !== undefined || aggregate.value !== undefined) reject("INVALID_AGGREGATE", `Rule ${id} has COUNT-only fields`, { artifactId: id });
    if (rule.issue && !["EACH", "SUMMARY"].includes(aggregate.issueMode)) reject("INVALID_AGGREGATE", `Rule ${id} requires issueMode`, { artifactId: id });
    if (!rule.issue && aggregate.issueMode !== undefined) reject("INVALID_AGGREGATE", `Rule ${id} cannot use issueMode without issue`, { artifactId: id });
  }
}

function validateCondition(id, artifact) {
  closed(id, artifact, new Set(["type", "when", "steps"]));
  validateSteps(id, artifact.steps);
  validateWhen(id, artifact.when);
}

function validatePipeline(id, artifact) {
  closed(id, artifact, new Set(["type", "steps"]));
  validateSteps(id, artifact.steps);
}

function validateDictionary(id, artifact) {
  closed(id, artifact, new Set(["type", "entries"]));
  if (!Array.isArray(artifact.entries) || !artifact.entries.length) reject("INVALID_DICTIONARY", `Dictionary ${id} needs entries`, { artifactId: id });
  const seen = [];
  for (const entry of artifact.entries) {
    if (!["string", "number", "boolean"].includes(typeof entry)) reject("INVALID_DICTIONARY", `Dictionary ${id} entries must be non-null scalars`, { artifactId: id });
    if (seen.some((value) => scalarEquals(value, entry))) reject("INVALID_DICTIONARY", `Dictionary ${id} has duplicate entry`, { artifactId: id });
    seen.push(entry);
  }
}

function validateSteps(id, steps) {
  if (!Array.isArray(steps) || !steps.length || steps.some((step) => typeof step !== "string" || !step))
    reject("INVALID_STEPS", `Artifact ${id} steps must be a non-empty string array`, { artifactId: id });
}

function validateWhen(id, when) {
  if (typeof when === "string" && when) return;
  if (!plain(when)) reject("INVALID_WHEN", `Condition ${id} has invalid when`, { artifactId: id });
  const keys = Object.keys(when);
  if (keys.length !== 1 || !["all", "any", "not"].includes(keys[0])) reject("INVALID_WHEN", `Condition ${id} when must contain exactly one combinator`, { artifactId: id });
  if (keys[0] === "not") return validateWhen(id, when.not);
  if (!Array.isArray(when[keys[0]]) || !when[keys[0]].length) reject("INVALID_WHEN", `Condition ${id} ${keys[0]} must be non-empty`, { artifactId: id });
  for (const child of when[keys[0]]) validateWhen(id, child);
}

function closed(id, object, allowed, label = "artifact") {
  for (const key of Object.keys(object)) if (!allowed.has(key)) reject("UNKNOWN_FIELD", `${id} ${label} has unknown field ${key}`, { artifactId: id, path: key });
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

module.exports = { validateArtifacts, validateWhen };
