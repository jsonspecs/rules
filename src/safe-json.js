"use strict";

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class SafeJsonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SafeJsonError";
    this.code = code;
    this.details = details;
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertSafeKey(key, path, code = "DANGEROUS_PAYLOAD_KEY") {
  if (DANGEROUS_KEYS.has(String(key))) {
    throw new SafeJsonError(code, `Dangerous key at ${path || String(key)}`, { path, key: String(key) });
  }
}

function assertSafePath(path) {
  if (typeof path !== "string") return;
  for (const segment of path.replace(/\[(?:\*|\d+)\]/g, "").split(".")) {
    if (DANGEROUS_KEYS.has(segment)) {
      throw new SafeJsonError("DANGEROUS_PATH_SEGMENT", `Dangerous path segment "${segment}" in ${path}`, { path, segment });
    }
  }
}

function cloneJsonSafe(value, options = {}) {
  const ancestors = new WeakSet();
  const dangerousCode = options.dangerousCode || "DANGEROUS_ARTIFACT_KEY";

  function visit(input, path) {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new SafeJsonError("ARTIFACT_NOT_JSON_SAFE", `Non-finite number at ${path}`, { path });
      return input;
    }
    if (typeof input !== "object") {
      throw new SafeJsonError("ARTIFACT_NOT_JSON_SAFE", `Unsupported ${typeof input} at ${path}`, { path, type: typeof input });
    }
    if (ancestors.has(input)) throw new SafeJsonError("ARTIFACT_CYCLE_DETECTED", `Cycle detected at ${path}`, { path });
    const proto = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && proto !== Object.prototype && proto !== null) {
      throw new SafeJsonError("ARTIFACT_NOT_JSON_SAFE", `Non-plain object at ${path}`, { path });
    }
    ancestors.add(input);
    let output;
    if (Array.isArray(input)) {
      output = input.map((item, index) => visit(item, `${path}[${index}]`));
    } else {
      output = Object.create(null);
      for (const key of Object.keys(input)) {
        const next = path ? `${path}.${key}` : key;
        assertSafeKey(key, next, dangerousCode);
        output[key] = visit(input[key], next);
      }
    }
    ancestors.delete(input);
    return output;
  }
  return visit(value, "$");
}

function flattenPayloadSafe(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SafeJsonError("INVALID_EVALUATION_INPUT", "payload must be a JSON object", { path: "$" });
  }
  const result = Object.create(null);
  const ancestors = new WeakSet();

  function put(path, value, origin) {
    if (hasOwn(result, path)) {
      throw new SafeJsonError("CONFLICTING_PAYLOAD_PATHS", `Conflicting payload paths at ${path}`, { path, origins: [path, origin] });
    }
    result[path] = value;
  }
  function visit(value, prefix) {
    if (value === null || typeof value !== "object") {
      if (typeof value === "number" && !Number.isFinite(value)) throw new SafeJsonError("PAYLOAD_NOT_JSON_SAFE", `Non-finite number at ${prefix}`, { path: prefix });
      if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) throw new SafeJsonError("PAYLOAD_NOT_JSON_SAFE", `Unsupported ${typeof value} at ${prefix}`, { path: prefix });
      put(prefix, value, prefix);
      return;
    }
    if (ancestors.has(value)) throw new SafeJsonError("PAYLOAD_CYCLE_DETECTED", `Cycle detected at ${prefix || "$"}`, { path: prefix || "$" });
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new SafeJsonError("PAYLOAD_NOT_JSON_SAFE", `Non-plain object at ${prefix || "$"}`, { path: prefix || "$" });
    ancestors.add(value);
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) put(prefix, Array.isArray(value) ? [] : Object.create(null), prefix);
    for (const key of keys) {
      assertSafeKey(key, prefix ? `${prefix}.${key}` : key);
      const child = Array.isArray(value) ? `${prefix}[${key}]` : (prefix ? `${prefix}.${key}` : key);
      visit(value[key], child);
    }
    ancestors.delete(value);
  }

  for (const key of Object.keys(payload)) {
    assertSafeKey(key, key);
    if (key === "__context") continue;
    visit(payload[key], key);
  }
  return result;
}

function normalizeTransportSafe(value) {
  const seen = new WeakSet();
  function visit(input, inArray) {
    if (input === undefined || typeof input === "function" || typeof input === "symbol") return inArray ? null : undefined;
    if (typeof input === "bigint") return String(input);
    if (typeof input === "number" && !Number.isFinite(input)) return null;
    if (input === null || typeof input !== "object") return input;
    if (input instanceof Date) return input.toISOString();
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    const output = Array.isArray(input) ? [] : {};
    for (const key of Object.keys(input)) {
      const normalized = visit(input[key], Array.isArray(input));
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(input);
    return output;
  }
  return visit(value, false);
}

module.exports = { DANGEROUS_KEYS, SafeJsonError, hasOwn, assertSafePath, cloneJsonSafe, flattenPayloadSafe, normalizeTransportSafe };
