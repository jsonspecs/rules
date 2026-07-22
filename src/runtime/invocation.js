"use strict";

/**
 * Построение закрытого invocation для одного вызова оператора.
 *
 * Оператор получает значения, а не пути и не payload. Отсутствие стандартного
 * field/value_field даёт core-level SKIP для value-семантики; именованные inputs
 * устроены иначе: отсутствующий путь просто не создаёт ключ, и оператор всё равно
 * вызывается. Это ключевая граница расширения D27.
 */

const { RuntimeAbort } = require("../errors");

const OUTCOMES = new Set(["PASS", "FAIL", "SKIP"]);

function invokeRule(ruleId, rule, concreteField, state, resolve) {
  const definition = state.operators[rule.operator];
  const invocation = Object.create(null);

  if (rule.field !== undefined) {
    const resolved = concreteField || resolve.get(rule.field);
    const field = concreteField?.path || rule.field;
    if (!resolved.present && !definition.observesAbsence) return { outcome: "SKIP", invocation, field };
    if (resolved.present) invocation.field = resolved.value;
  }
  if (rule.fields !== undefined) invocation.fields = rule.fields.map((path) => {
    const resolved = resolve.get(path);
    return resolved.present ? { value: resolved.value } : {};
  });
  if (rule.value !== undefined) invocation.value = rule.value;
  if (rule.value_field !== undefined) {
    const resolved = resolve.get(rule.value_field);
    if (!resolved.present) return { outcome: "SKIP", invocation, field: concreteField?.path || rule.field };
    invocation.value_field = resolved.value;
  }
  if (rule.inputs !== undefined) {
    invocation.inputs = Object.create(null);
    for (const [name, path] of Object.entries(rule.inputs)) {
      const resolved = resolve.get(path);
      if (resolved.present) invocation.inputs[name] = resolved.value;
    }
  }
  if (rule.dictionary !== undefined) invocation.dictionary = state.artifacts[rule.dictionary].entries;
  if (rule.params !== undefined) invocation.params = rule.params;

  if (invocation.inputs) Object.freeze(invocation.inputs);
  if (invocation.fields) {
    for (const entry of invocation.fields) Object.freeze(entry);
    Object.freeze(invocation.fields);
  }
  Object.freeze(invocation);

  let outcome;
  try { outcome = definition.evaluate(invocation); }
  catch (_) { throw new RuntimeAbort("OPERATOR_FAULT", { ruleId, operator: rule.operator }); }
  if (!OUTCOMES.has(outcome)) throw new RuntimeAbort("OPERATOR_CONTRACT_VIOLATION", { ruleId, operator: rule.operator });
  return { outcome, invocation, field: concreteField?.path || rule.field || null };
}

module.exports = { invokeRule, OUTCOMES };
