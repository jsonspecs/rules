"use strict";

/**
 * Нормативная проверка evaluation tuple в точном порядке SPEC §5.1.
 *
 * Здесь нельзя начинать с универсального deep-clone: тогда слишком глубокий
 * payload мог бы победить опасный ключ, хотя спецификация задаёт обратный
 * приоритет. Поэтому типы, ключи, числа и глубина проверяются отдельными фазами,
 * и только после этого создаётся отделённый I-JSON клон.
 */

const { RuntimeAbort } = require("../errors");
const { cloneIJson, isPlainObject, assertScalarString, deepFreeze } = require("../json/i-json");
const { compareCodePoints } = require("../json/jcs");

const DANGEROUS = new Set(["__proto__", "prototype", "constructor"]);

function validateEvaluationInput(state, input) {
  const pipelineId = input?.pipelineId;
  if (typeof pipelineId !== "string" || !pipelineId || !isScalarString(pipelineId))
    abort("INVALID_PIPELINE_ID", { expected: "non-empty string" });
  if (!state.exports.has(pipelineId)) abort("PIPELINE_NOT_FOUND", { pipelineId });

  const payload = input?.payload;
  const context = input && Object.prototype.hasOwnProperty.call(input, "context") ? input.context : {};
  if (!isPlainObject(payload)) abort("INVALID_PAYLOAD", { expected: "object" });
  if (!isPlainObject(context)) abort("INVALID_CONTEXT", { expected: "object" });

  // Циклы, разреженные массивы и объекты среды выполнения не входят в I-JSON.
  // Проверяем их отдельным итеративным проходом, чтобы последующие нормативные
  // сканы всегда завершались и сохраняли приоритет ошибок RC.5 для JSON-деревьев.
  assertHostJsonTree(payload, "INVALID_PAYLOAD");
  assertHostJsonTree(context, "INVALID_CONTEXT");

  const payloadKeys = scanKeys(payload);
  const contextKeys = scanKeys(context);
  if (payloadKeys.dangerous) keyAbort("DANGEROUS_PAYLOAD_KEY", payloadKeys.dangerous);
  if (contextKeys.dangerous) keyAbort("DANGEROUS_CONTEXT_KEY", contextKeys.dangerous);
  if (payloadKeys.invalid) keyAbort("INVALID_PAYLOAD_KEY", payloadKeys.invalid);
  if (contextKeys.invalid) keyAbort("INVALID_CONTEXT_KEY", contextKeys.invalid);

  const payloadNumber = smallestNonFinite(payload);
  const contextNumber = smallestNonFinite(context);
  if (payloadNumber) abort("INVALID_PAYLOAD_NUMBER", { path: payloadNumber });
  if (contextNumber) abort("INVALID_CONTEXT_NUMBER", { path: contextNumber });
  if (exceedsDepth(payload, 256)) abort("PAYLOAD_TOO_DEEP", { maxDepth: 256 });
  if (exceedsDepth(context, 256)) abort("CONTEXT_TOO_DEEP", { maxDepth: 256 });

  return {
    pipelineId,
    payload: deepFreeze(cloneIJson(payload)),
    context: deepFreeze(cloneIJson(context)),
  };
}

function assertHostJsonTree(root, code) {
  const active = new WeakSet();
  const stack = [{ value: root, leave: false }];
  try {
    while (stack.length) {
      const frame = stack.pop();
      const value = frame.value;
      if (frame.leave) {
        active.delete(value);
        continue;
      }
      if (value === null || typeof value === "boolean" || typeof value === "number") continue;
      if (typeof value === "string") {
        if (!isScalarString(value)) abort(code, { expected: "object" });
        continue;
      }
      if (typeof value !== "object" || (!Array.isArray(value) && !isPlainObject(value)))
        abort(code, { expected: "object" });
      if (active.has(value)) abort(code, { expected: "object" });

      active.add(value);
      stack.push({ value, leave: true });
      if (Array.isArray(value)) {
        const indexes = ownArrayIndexes(value);
        if (!indexes) abort(code, { expected: "object" });
        for (let i = indexes.length - 1; i >= 0; i--)
          stack.push({ value: value[indexes[i]], leave: false });
      } else {
        const keys = Object.keys(value);
        for (let i = keys.length - 1; i >= 0; i--)
          stack.push({ value: value[keys[i]], leave: false });
      }
    }
  } catch (error) {
    if (error instanceof RuntimeAbort) throw error;
    abort(code, { expected: "object" });
  }
}

function ownArrayIndexes(value) {
  const indexes = [];
  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === "length" || !/^(?:0|[1-9][0-9]*)$/.test(name)) continue;
    const index = Number(name);
    if (Number.isInteger(index) && index >= 0 && index < value.length) indexes.push(index);
  }
  return indexes.length === value.length ? indexes : null;
}

function scanKeys(root) {
  const found = { dangerous: null, invalid: null };
  const stack = [{ value: root, path: "" }];
  while (stack.length) {
    const { value, path } = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) if (value[i] && typeof value[i] === "object")
        stack.push({ value: value[i], path: `${path}[${i}]` });
      continue;
    }
    for (const key of Object.keys(value)) {
      const item = { parentPath: path, key };
      if (DANGEROUS.has(key)) { found.dangerous = minimum(found.dangerous, item); continue; }
      if (!key || /[.\[\]]/.test(key)) { found.invalid = minimum(found.invalid, item); continue; }
      const child = value[key];
      if (child && typeof child === "object") stack.push({ value: child, path: path ? `${path}.${key}` : key });
    }
  }
  return found;
}

function minimum(left, right) {
  if (!left) return right;
  const parent = compareCodePoints(left.parentPath, right.parentPath);
  return parent < 0 || (parent === 0 && compareCodePoints(left.key, right.key) <= 0) ? left : right;
}

function smallestNonFinite(root) {
  const paths = [];
  const stack = [{ value: root, path: "" }];
  while (stack.length) {
    const { value, path } = stack.pop();
    if (typeof value === "number" && !Number.isFinite(value)) { paths.push(path); continue; }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) stack.push({ value: value[i], path: `${path}[${i}]` });
    } else if (value && typeof value === "object") {
      for (const key of Object.keys(value)) stack.push({ value: value[key], path: path ? `${path}.${key}` : key });
    }
  }
  return paths.sort(compareCodePoints)[0] || null;
}

function exceedsDepth(root, maximum) {
  const stack = [{ value: root, depth: 1 }];
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > maximum) return true;
    if (Array.isArray(value)) for (const child of value) stack.push({ value: child, depth: depth + 1 });
    else if (value && typeof value === "object") for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
  }
  return false;
}

function isScalarString(value) {
  try { assertScalarString(value, (message) => { throw new TypeError(message); }); return true; }
  catch (_) { return false; }
}

function keyAbort(code, item) { abort(code, { parentPath: item.parentPath, key: item.key }); }
function abort(code, details) { throw new RuntimeAbort(code, details); }

module.exports = { validateEvaluationInput, scanKeys, smallestNonFinite, exceedsDepth };
