"use strict";

/**
 * Компиляция и применение схем операторов.
 *
 * JSON Schema проверяет только операторную часть rule (`field`, `value`,
 * `value_field`, `dictionary`, `inputs`, `params`, `fields`). Общие поля DSL
 * закрывает сам компилятор. Такой разрез даёт внешнему пакету переносимый
 * машинный контракт и не позволяет ему переопределять pipeline/issue/aggregate.
 */

const Ajv = require("ajv");

const CONFIG_KEYS = new Set(["field", "fields", "value", "value_field", "dictionary", "inputs", "params"]);

function compileContracts(registry) {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateSchema: true });
  const validators = Object.create(null);
  for (const [name, definition] of Object.entries(registry)) {
    try { validators[name] = ajv.compile(definition.schema); }
    catch (error) { throw new TypeError(`Invalid JSON Schema contract for operator ${name}: ${error.message}`); }
  }
  return Object.freeze(validators);
}

function operatorConfig(rule) {
  const out = Object.create(null);
  for (const key of Object.keys(rule)) if (CONFIG_KEYS.has(key)) out[key] = rule[key];
  return out;
}

function formatAjvErrors(errors) {
  return (errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

module.exports = { compileContracts, operatorConfig, formatAjvErrors, CONFIG_KEYS };
