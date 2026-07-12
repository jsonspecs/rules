function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function deepGet(obj, path) {
  // Flat-only payload mode: keys are stored as exact strings (may contain dots).
  // Example: payload['beneficiary.inn'] => '4823...'
  //
  // Context access: if path starts with "$context." the value is looked up in
  // obj.__context (a flat-map of context fields) instead of the payload itself.
  // Example: field "$context.merchantId" => obj.__context['merchantId']
  if (!path) return { ok: false, value: undefined };
  if (obj === null || typeof obj !== "object")
    return { ok: false, value: undefined };

  const CONTEXT_PREFIX = "$context.";
  if (String(path).startsWith(CONTEXT_PREFIX)) {
    const contextKey = String(path).slice(CONTEXT_PREFIX.length);
    const ctx = obj.__context;
    if (!ctx || typeof ctx !== "object") return { ok: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(ctx, contextKey)) return { ok: false, value: undefined };
    return { ok: true, value: ctx[contextKey] };
  }

  const key = String(path);
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return { ok: false, value: undefined };
  return { ok: true, value: obj[key] };
}

function isEmptyValue(v) {
  return v === null || v === undefined || v === "";
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  )
    return Number(value);
  return null;
}

function parseStrictYMD(s) {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toComparable(value) {
  const n = toNumber(value);
  if (n !== null) return { kind: "number", value: n };
  const d = parseStrictYMD(value);
  if (d) return { kind: "date", value: d.getTime() };
  return null;
}

function normalizeWhenExpr(when) {
  if (typeof when === "string") return { mode: "single", pred: when };
  if (isObject(when) && Array.isArray(when.all)) {
    if (when.all.length === 0) throw new Error(`Invalid condition.when: all[] must be non-empty`);
    return { mode: "all", items: when.all.map(normalizeWhenExpr) };
  }
  if (isObject(when) && Array.isArray(when.any)) {
    if (when.any.length === 0) throw new Error(`Invalid condition.when: any[] must be non-empty`);
    return { mode: "any", items: when.any.map(normalizeWhenExpr) };
  }
  throw new Error(
    `Invalid condition.when: expected string or nested {all:[..]} or {any:[..]}`,
  );
}

function stepKind(step) {
  const keys = Object.keys(step);
  const allowed = ["rule", "pipeline", "condition"];
  const present = keys.filter((k) => allowed.includes(k));
  assert(
    present.length === 1,
    `Step must contain exactly one of rule|pipeline|condition. Got keys: ${keys.join(",")}`,
  );
  return present[0];
}

function makeTrace(traceArr, artifactId = null) {
  return function trace(step, outcome = null, details, eventArtifactId = artifactId) {
    traceArr.push({
      kind: "TRACE",
      artifactType: "jsonspecs",
      step,
      artifactId: eventArtifactId || null,
      outcome,
      at: new Date().toISOString(),
      ...(details === undefined ? {} : { details }),
    });
  };
}

function isLibraryRef(ref) {
  return typeof ref === "string" && ref.startsWith("library.");
}

function scopeKeyFor(pipelineId, localName) {
  return `${pipelineId}.${localName}`;
}

// -----------------------------
// Wildcard support (flat-map)
// -----------------------------
//
// The engine uses flat payload (map of string keys to scalar values).
// Wildcard pattern is a *key pattern* (not JSON navigation).
// Supported forms:
//   items[*].qty           -> items[0].qty, items[1].qty, ...
//   a[*].b[*].c            -> a[0].b[0].c, a[0].b[1].c, a[1].b[0].c, ...
//
// Any number of [*] segments is supported.
// Each [*] matches exactly one numeric index: [0], [12], ...
//
// Notes:
// - Dots, slashes, spaces, cyrillic, etc. are treated as literal characters.
// - No backtracking risk: each [*] maps to unambiguous \[(\d+)\] in regex.
// - Sort order: lexicographic by index tuple (outer index first, then inner).

function isWildcardField(field) {
  return typeof field === "string" && field.includes("[*]");
}

function escapeRegexLiteral(s) {
  // Escape regexp metacharacters.
  return String(s).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function wildcardPatternToRegex(pattern) {
  // Split on every [*]  any number of wildcards supported.
  // Each segment is escaped, wildcards replaced with \[(\d+)\].
  // Example: "a[*].b[*].c" → /^a\[(\d+)\]\.b\[(\d+)\]\.c$/
  const parts = String(pattern).split("[*]");
  const regexBody = parts.map(escapeRegexLiteral).join("\\[(\\d+)\\]");
  return new RegExp(`^${regexBody}$`);
}

function expandWildcardKeys(pattern, payloadKeys) {
  return expandWildcardMatches(pattern, payloadKeys).map((item) => item.key);
}

function expandWildcardMatches(pattern, payloadKeys) {
  const re = wildcardPatternToRegex(pattern);
  const matches = [];
  for (const k of payloadKeys) {
    const m = re.exec(k);
    if (m) {
      // m[1], m[2], ... are the captured numeric indexes for each [*]
      const indexes = m.slice(1).map(Number);
      matches.push({ key: k, indexes });
    }
  }
  // Stable sort: lexicographic by index tuple (outermost first).
  // Example for a[*].b[*].c: [0,0], [0,1], [1,0], [1,1]
  matches.sort((a, b) => {
    for (let i = 0; i < Math.max(a.indexes.length, b.indexes.length); i++) {
      const diff = (a.indexes[i] || 0) - (b.indexes[i] || 0);
      if (diff !== 0) return diff;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return matches;
}

function materializeWildcardPattern(pattern, indexes) {
  let position = 0;
  return String(pattern).replace(/\[\*\]/g, () => {
    if (position >= indexes.length) throw new Error(`Not enough wildcard indexes for pattern: ${pattern}`);
    return `[${indexes[position++]}]`;
  });
}

function wildcardGroupBasePattern(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  let base = null;
  let wildcardCount = null;
  for (const field of fields) {
    if (!isWildcardField(field)) return null;
    const count = String(field).split("[*]").length - 1;
    const last = String(field).lastIndexOf("[*]");
    const current = String(field).slice(0, last + 3);
    if (base === null) { base = current; wildcardCount = count; }
    else if (current !== base || count !== wildcardCount) return null;
  }
  return base;
}

function expandWildcardGroups(basePattern, payloadKeys) {
  const regex = wildcardPatternToRegex(basePattern);
  const groups = new Map();
  for (const key of payloadKeys) {
    const segments = String(key).split(".");
    for (let length = segments.length; length >= 1; length--) {
      const candidate = segments.slice(0, length).join(".");
      const match = regex.exec(candidate);
      if (!match) continue;
      const indexes = match.slice(1).map(Number);
      const groupKey = indexes.join(":");
      if (!groups.has(groupKey)) groups.set(groupKey, { key: candidate, indexes });
      break;
    }
  }
  return [...groups.values()].sort((a, b) => {
    for (let index = 0; index < Math.max(a.indexes.length, b.indexes.length); index++) {
      const diff = (a.indexes[index] || 0) - (b.indexes[index] || 0);
      if (diff !== 0) return diff;
    }
    return a.key.localeCompare(b.key);
  });
}

module.exports = {
  assert,
  isObject,
  deepGet,
  isEmptyValue,
  toComparable,
  normalizeWhenExpr,
  stepKind,
  makeTrace,
  isLibraryRef,
  scopeKeyFor,
  isWildcardField,
  expandWildcardMatches,
  expandWildcardKeys,
  materializeWildcardPattern,
  wildcardGroupBasePattern,
  expandWildcardGroups,
  flattenPayload,
};

// -----------------------------
// JSON → flat-map conversion
// -----------------------------
//
// Converts a nested JSON object into a flat map of dot-notation keys.
// This allows the engine (which operates on flat payloads) to accept
// ordinary JSON from callers without any changes to rules or operators.
//
// Rules:
//   Objects  → keys joined with "."
//   Arrays   → elements indexed as [0], [1], ...
//   Scalars  → stored as-is (string, number, boolean, null)
//
// Special keys:
//   "__context" is never flattened  it is passed through untouched
//   so the engine can resolve "$context.*" field references normally.
//
// Examples:
//   { "a": { "b": 1 } }            → { "a.b": 1 }
//   { "items": ["x", "y"] }        → { "items[0]": "x", "items[1]": "y" }
//   { "a": [{ "b": 1 }] }          → { "a[0].b": 1 }
//   { "__context": { "k": "v" } }  → { "__context": { "k": "v" } }  (intact)

function flattenPayload(obj, _prefix, _result) {
  const prefix = _prefix === undefined ? "" : _prefix;
  const result = _result === undefined ? {} : _result;

  // Top-level call: pass __context through untouched
  if (
    prefix === "" &&
    obj !== null &&
    typeof obj === "object" &&
    !Array.isArray(obj)
  ) {
    if ("__context" in obj) {
      result["__context"] = obj["__context"];
    }
  }

  if (obj === null || typeof obj !== "object") {
    // Scalar value at a nested path  store directly
    if (prefix !== "") result[prefix] = obj;
    return result;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0 && prefix !== "") {
      // Empty array  store as empty array so callers can detect it
      result[prefix] = [];
      return result;
    }
    obj.forEach((item, i) => {
      const key = prefix ? `${prefix}[${i}]` : `[${i}]`;
      flattenPayload(item, key, result);
    });
    return result;
  }

  // Plain object
  for (const [k, val] of Object.entries(obj)) {
    // Skip __context at any nesting level  should only appear at root
    if (prefix === "" && k === "__context") continue;

    const newKey = prefix ? `${prefix}.${k}` : k;

    if (val === null || typeof val !== "object") {
      result[newKey] = val;
    } else {
      flattenPayload(val, newKey, result);
    }
  }

  return result;
}
