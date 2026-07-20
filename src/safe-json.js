"use strict";

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DEFAULT_MAX_JSON_DEPTH = 256;
const MAX_DEPTH_MARKER = "[MaxDepth]";
const UNSERIALIZABLE_MARKER = "[Unserializable]";

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
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0
    ? options.maxDepth
    : DEFAULT_MAX_JSON_DEPTH;

  function visit(input, path, depth) {
    if (depth > maxDepth) {
      throw new SafeJsonError("ARTIFACT_TOO_DEEP", `JSON artifact exceeds max depth ${maxDepth} at ${path}`, { path, maxDepth });
    }
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
      output = input.map((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else {
      output = Object.create(null);
      for (const key of Object.keys(input)) {
        const next = path ? `${path}.${key}` : key;
        assertSafeKey(key, next, dangerousCode);
        output[key] = visit(input[key], next, depth + 1);
      }
    }
    ancestors.delete(input);
    return output;
  }
  return visit(value, "$", 0);
}

function flattenPayloadSafe(payload, options = {}) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SafeJsonError("INVALID_EVALUATION_INPUT", "payload must be a JSON object", { path: "$" });
  }
  const result = Object.create(null);
  const ancestors = new WeakSet();
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0
    ? options.maxDepth
    : DEFAULT_MAX_JSON_DEPTH;

  function put(path, value, origin) {
    if (hasOwn(result, path)) {
      throw new SafeJsonError("CONFLICTING_PAYLOAD_PATHS", `Conflicting payload paths at ${path}`, { path, origins: [path, origin] });
    }
    result[path] = value;
  }
  function visit(value, prefix, depth) {
    if (depth > maxDepth) {
      throw new SafeJsonError("PAYLOAD_TOO_DEEP", `Payload exceeds max depth ${maxDepth} at ${prefix || "$"}`, { path: prefix || "$", maxDepth });
    }
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
      visit(value[key], child, depth + 1);
    }
    ancestors.delete(value);
  }

  for (const key of Object.keys(payload)) {
    assertSafeKey(key, key);
    if (key === "__context") continue;
    visit(payload[key], key, 1);
  }
  return result;
}

function cloneContextSafe(context, options = {}) {
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    throw new SafeJsonError("INVALID_EVALUATION_INPUT", "context must be a JSON object", { path: "$" });
  }
  const ancestors = new WeakSet();
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0
    ? options.maxDepth
    : DEFAULT_MAX_JSON_DEPTH;

  function visit(value, path, depth) {
    if (depth > maxDepth) {
      throw new SafeJsonError("PAYLOAD_TOO_DEEP", `Context exceeds max depth ${maxDepth} at ${path}`, { path, maxDepth });
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new SafeJsonError("PAYLOAD_NOT_JSON_SAFE", `Non-finite number at ${path}`, { path });
      return value;
    }
    if (typeof value !== "object") {
      throw new SafeJsonError("PAYLOAD_NOT_JSON_SAFE", `Unsupported ${typeof value} at ${path}`, { path, type: typeof value });
    }
    if (ancestors.has(value)) throw new SafeJsonError("PAYLOAD_CYCLE_DETECTED", `Cycle detected at ${path}`, { path });
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
      throw new SafeJsonError("PAYLOAD_NOT_JSON_SAFE", `Non-plain object at ${path}`, { path });
    }
    ancestors.add(value);
    let output;
    if (Array.isArray(value)) {
      output = value.map((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else {
      output = Object.create(null);
      for (const key of Object.keys(value)) {
        const next = path === "$" ? key : `${path}.${key}`;
        assertSafeKey(key, next);
        output[key] = visit(value[key], next, depth + 1);
      }
    }
    ancestors.delete(value);
    return output;
  }

  return visit(context, "$", 0);
}

function exceedsMaxJsonDepth(value, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0
    ? options.maxDepth
    : DEFAULT_MAX_JSON_DEPTH;
  const ancestors = new WeakSet();

  function visit(input, depth) {
    if (depth > maxDepth) return true;
    if (input === null || typeof input !== "object") return false;
    if (ancestors.has(input)) return false;
    ancestors.add(input);
    let keys;
    try {
      keys = Object.keys(input);
    } catch (_) {
      ancestors.delete(input);
      return false;
    }
    for (const key of keys) {
      let child;
      try {
        child = input[key];
      } catch (_) {
        continue;
      }
      if (visit(child, depth + 1)) {
        ancestors.delete(input);
        return true;
      }
    }
    ancestors.delete(input);
    return false;
  }

  try {
    return visit(value, 0);
  } catch (_) {
    return false;
  }
}

function normalizeTransportSafe(value) {
  const seen = new WeakSet();
  function visit(input, inArray, depth) {
    if (depth > DEFAULT_MAX_JSON_DEPTH) return MAX_DEPTH_MARKER;
    if (input === undefined || typeof input === "function" || typeof input === "symbol") return inArray ? null : undefined;
    if (typeof input === "bigint") return String(input);
    if (typeof input === "number" && !Number.isFinite(input)) return null;
    if (input === null || typeof input !== "object") return input;
    try {
      if (input instanceof Date) {
        const time = input.getTime();
        return Number.isFinite(time) ? input.toISOString() : null;
      }
    } catch (_) {
      return UNSERIALIZABLE_MARKER;
    }
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    let inArrayValue;
    try {
      inArrayValue = Array.isArray(input);
    } catch (_) {
      seen.delete(input);
      return UNSERIALIZABLE_MARKER;
    }
    const output = inArrayValue ? [] : {};
    let keys;
    try {
      keys = Object.keys(input);
    } catch (_) {
      seen.delete(input);
      return UNSERIALIZABLE_MARKER;
    }
    for (const key of keys) {
      let child;
      try {
        child = input[key];
      } catch (_) {
        output[key] = UNSERIALIZABLE_MARKER;
        continue;
      }
      const normalized = visit(child, inArrayValue, depth + 1);
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(input);
    return output;
  }
  try {
    return visit(value, false, 0);
  } catch (_) {
    return UNSERIALIZABLE_MARKER;
  }
}

module.exports = {
  DANGEROUS_KEYS,
  DEFAULT_MAX_JSON_DEPTH,
  SafeJsonError,
  hasOwn,
  assertSafePath,
  cloneJsonSafe,
  flattenPayloadSafe,
  cloneContextSafe,
  exceedsMaxJsonDepth,
  normalizeTransportSafe,
};
