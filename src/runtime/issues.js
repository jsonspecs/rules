"use strict";

/**
 * Материализация нормативных issue.
 *
 * Оператор сообщает только PASS/FAIL/SKIP. Код, сообщение и уровень принадлежат
 * rule.issue; expected/actual строит ядро из разрешённого invocation. Для custom
 * operator действует общий переносимый контракт §6.4, а runtime-факты агрегата
 * живут только в details, никогда не смешиваются с авторским meta.
 */

const { BUILT_IN_NAMES } = require("../operators/builtins");

const VALUE_OPERATORS = new Set([
  "equals", "not_equals", "contains", "matches_regex", "not_matches_regex",
  "greater_than", "less_than", "length_equals", "length_max",
]);
const TYPE_OPERATORS = new Set(["is_boolean", "is_string", "is_number", "is_integer"]);
const FIELD_OPERATORS = new Set([
  "field_equals_field", "field_not_equals_field", "field_greater_than_field",
  "field_less_than_field", "field_greater_or_equal_than_field",
  "field_less_or_equal_than_field",
]);

function createIssue(ruleId, rule, pipelineId, evaluation, options = {}) {
  const issue = {
    level: rule.issue.level,
    code: rule.issue.code,
    message: rule.issue.message,
    field: options.summary ? rule.field : primaryField(rule, evaluation),
    ruleId,
    pipelineId,
  };
  if (!options.summary) addExpectedActual(issue, rule, evaluation.invocation);
  if (options.details) issue.details = options.details;
  // Внутри prepared объекты имеют null-prototype для безопасной адресации, но
  // публичный результат должен быть обычным transport JSON без host-артефактов.
  if (rule.issue.meta !== undefined) issue.meta = JSON.parse(JSON.stringify(rule.issue.meta));
  return issue;
}

function primaryField(rule, evaluation) {
  if (rule.operator === "any_filled" || rule.field === undefined) return null;
  return evaluation.field || rule.field;
}

function addExpectedActual(issue, rule, invocation) {
  const operator = rule.operator;
  if (VALUE_OPERATORS.has(operator)) {
    issue.expected = rule.value;
    if (own(invocation, "field")) issue.actual = invocation.field;
    return;
  }
  if (TYPE_OPERATORS.has(operator)) {
    if (own(invocation, "field")) issue.actual = invocation.field;
    return;
  }
  if (operator === "not_empty") {
    if (own(invocation, "field")) issue.actual = invocation.field;
    return;
  }
  if (operator === "is_empty" || operator === "not_true") {
    if (own(invocation, "field")) issue.actual = invocation.field;
    return;
  }
  if (operator === "in_dictionary" || operator === "not_in_dictionary") {
    issue.expected = rule.dictionary;
    if (own(invocation, "field")) issue.actual = invocation.field;
    return;
  }
  if (FIELD_OPERATORS.has(operator)) {
    if (own(invocation, "value_field")) issue.expected = invocation.value_field;
    if (own(invocation, "field")) issue.actual = invocation.field;
    return;
  }
  if (!BUILT_IN_NAMES.includes(operator)) {
    if (own(invocation, "value")) issue.expected = invocation.value;
    else if (own(invocation, "value_field")) issue.expected = invocation.value_field;
    if (own(invocation, "field")) issue.actual = invocation.field;
  }
}

function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

module.exports = { createIssue };
