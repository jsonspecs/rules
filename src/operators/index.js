"use strict";

/**
 * Сборка единого операторного registry.
 *
 * Встроенные имена зарезервированы спецификацией: внешняя зависимость не может
 * тихо подменить их. Registry является частичной функцией name -> definition;
 * дубликаты и неполные определения считаются ошибкой конфигурации приложения.
 */

const { builtIns, BUILT_IN_NAMES } = require("./builtins");
const { cloneIJson, deepFreeze, isPlainObject } = require("../json/i-json");

const CUSTOM_CONFIG_KEYS = new Set(["field", "value", "value_field", "dictionary", "inputs", "params"]);

function createOperatorRegistry(custom = {}) {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) throw new TypeError("operators must be an object map");
  const registry = Object.create(null);
  for (const [name, definition] of Object.entries(builtIns)) registry[name] = definition;
  for (const [name, definition] of Object.entries(custom)) {
    if (!name) throw new TypeError("operator name must be non-empty");
    if (Object.prototype.hasOwnProperty.call(builtIns, name)) throw new TypeError(`built-in operator cannot be replaced: ${name}`);
    if (!definition || typeof definition !== "object" || typeof definition.evaluate !== "function")
      throw new TypeError(`operator ${name} must provide {schema,evaluate}`);
    if (!definition.schema || typeof definition.schema !== "object") throw new TypeError(`operator ${name} must provide a JSON Schema contract`);
    const schema = deepFreeze(cloneIJson(definition.schema));
    assertClosedContract(name, schema);
    registry[name] = Object.freeze({ schema, evaluate: definition.evaluate });
  }
  return Object.freeze(registry);
}

function assertClosedContract(name, schema) {
  if (schema.type !== "object" || schema.additionalProperties !== false || !isPlainObject(schema.properties))
    throw new TypeError(`operator ${name} schema must be a closed object schema`);
  for (const key of Object.keys(schema.properties)) {
    if (!CUSTOM_CONFIG_KEYS.has(key)) throw new TypeError(`operator ${name} schema declares unsupported config key ${key}`);
  }
  for (const key of ["inputs", "params"]) {
    const nested = schema.properties[key];
    if (nested && (nested.type !== "object" || nested.additionalProperties !== false || !isPlainObject(nested.properties)))
      throw new TypeError(`operator ${name} ${key} schema must declare a closed object`);
  }
}

module.exports = { createOperatorRegistry, builtIns, BUILT_IN_NAMES };
