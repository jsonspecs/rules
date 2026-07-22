"use strict";

/**
 * Реестр встроенных операторов RC.7.
 *
 * Все операторы используют тот же контракт `{schema, evaluate}`, что и внешние
 * пакеты. Schema валидирует только конфигурацию конкретного оператора после того,
 * как компилятор отделил общие поля rule. evaluate получает уже разрешённые
 * значения, поэтому оператор не видит payload, context или пути и остаётся чистым.
 */

const { compileRegex } = require("../regex");
const { scalarEquals, orderedCompare, isOrderedLiteral } = require("./comparison");
const { dictionaryHas } = require("./dictionary-index");
const { deepFreeze } = require("../json/i-json");

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const path = { type: "string", minLength: 1 };
const closed = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const fieldOnly = closed({ field: path });
const valueRule = (schema = true) => closed({ field: path, value: schema });
const secondField = closed({ field: path, value_field: path });
const dictionaryRule = closed({ field: path, dictionary: { type: "string", minLength: 1 } });

function fieldValue(invocation) { return invocation.field; }
function empty(invocation) { return !own(invocation, "field") || invocation.field === null || invocation.field === ""; }
function compare(predicate) {
  return (invocation) => {
    const result = orderedCompare(invocation.field, own(invocation, "value") ? invocation.value : invocation.value_field);
    return result != null && predicate(result) ? "PASS" : "FAIL";
  };
}
function regex(invocation) {
  return compileRegex(invocation.value).test(invocation.field);
}

const builtIns = {
  not_empty: definition(fieldOnly, (i) => empty(i) ? "FAIL" : "PASS", { observesAbsence: true }),
  is_empty: definition(fieldOnly, (i) => empty(i) ? "PASS" : "FAIL", { observesAbsence: true }),
  not_true: definition(fieldOnly, (i) => i.field === true ? "FAIL" : "PASS", { observesAbsence: true }),
  any_filled: definition(closed({ fields: { type: "array", minItems: 1, items: path } }), (i) =>
    i.fields.some((entry) => own(entry, "value") && entry.value !== null && entry.value !== "") ? "PASS" : "FAIL",
  { observesAbsence: true }),

  is_boolean: definition(fieldOnly, (i) => typeof fieldValue(i) === "boolean" ? "PASS" : "FAIL"),
  is_string: definition(fieldOnly, (i) => typeof fieldValue(i) === "string" ? "PASS" : "FAIL"),
  is_number: definition(fieldOnly, (i) => typeof fieldValue(i) === "number" ? "PASS" : "FAIL"),
  is_integer: definition(fieldOnly, (i) => typeof fieldValue(i) === "number" && Number.isInteger(i.field) ? "PASS" : "FAIL"),

  equals: definition(valueRule(), (i) => scalarEquals(i.field, i.value) ? "PASS" : "FAIL"),
  not_equals: definition(valueRule(), (i) => scalarEquals(i.field, i.value) ? "FAIL" : "PASS"),
  contains: definition(valueRule({ type: "string" }), (i) => typeof i.field === "string" && i.field.includes(i.value) ? "PASS" : "FAIL"),
  matches_regex: definition(valueRule({ type: "string", minLength: 0 }), (i) => typeof i.field === "string" && regex(i) ? "PASS" : "FAIL"),
  not_matches_regex: definition(valueRule({ type: "string", minLength: 0 }), (i) => typeof i.field === "string" && !regex(i) ? "PASS" : "FAIL"),
  greater_than: definition(valueRule({ anyOf: [{ type: "number" }, { type: "string" }] }), compare((n) => n > 0), { validateConfig: orderedLiteral }),
  less_than: definition(valueRule({ anyOf: [{ type: "number" }, { type: "string" }] }), compare((n) => n < 0), { validateConfig: orderedLiteral }),
  length_equals: definition(valueRule({ type: "integer", minimum: 0 }), (i) => typeof i.field === "string" && Array.from(i.field).length === i.value ? "PASS" : "FAIL"),
  length_max: definition(valueRule({ type: "integer", minimum: 0 }), (i) => typeof i.field === "string" && Array.from(i.field).length <= i.value ? "PASS" : "FAIL"),

  field_equals_field: definition(secondField, (i) => scalarEquals(i.field, i.value_field) ? "PASS" : "FAIL"),
  field_not_equals_field: definition(secondField, (i) => scalarEquals(i.field, i.value_field) ? "FAIL" : "PASS"),
  field_greater_than_field: definition(secondField, compare((n) => n > 0)),
  field_less_than_field: definition(secondField, compare((n) => n < 0)),
  field_greater_or_equal_than_field: definition(secondField, compare((n) => n >= 0)),
  field_less_or_equal_than_field: definition(secondField, compare((n) => n <= 0)),

  in_dictionary: definition(dictionaryRule, (i) => dictionaryHas(i.dictionary, i.field) ? "PASS" : "FAIL"),
  not_in_dictionary: definition(dictionaryRule, (i) => dictionaryHas(i.dictionary, i.field) ? "FAIL" : "PASS"),
};

function definition(schema, evaluate, options = {}) {
  return Object.freeze({ schema: deepFreeze(schema), evaluate, ...options });
}

function orderedLiteral(config) {
  return isOrderedLiteral(config.value) ? null : "value must be a finite numeric value, numeric string, or valid YYYY-MM-DD date";
}

const BUILT_IN_NAMES = Object.freeze(Object.keys(builtIns));

module.exports = { builtIns: Object.freeze(builtIns), BUILT_IN_NAMES, definition };
