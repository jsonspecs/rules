"use strict";

/**
 * Внутренняя flat-проекция nested JSON и разрешение путей.
 *
 * Непустой контейнер не является значением собственного пути; листья — скаляры
 * и пустые контейнеры. Wildcard сопоставляется с готовыми плоскими ключами, а
 * найденные индексы сортируются численно как кортежи (odometer order).
 */

function flatten(root) {
  const out = new Map();
  function visit(value, path) {
    if (Array.isArray(value)) {
      if (!value.length) { out.set(path, value); return; }
      for (let i = 0; i < value.length; i++) visit(value[i], `${path}[${i}]`);
      return;
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (!keys.length) { out.set(path, value); return; }
      for (const key of keys) visit(value[key], path ? `${path}.${key}` : key);
      return;
    }
    out.set(path, value);
  }
  visit(root, "");
  out.delete("");
  return out;
}

function resolver(payload, context) {
  const payloadMap = flatten(payload);
  const contextMap = flatten(context);
  function get(path) {
    const contextPath = path.startsWith("$context.");
    const key = contextPath ? path.slice("$context.".length) : path;
    const map = contextPath ? contextMap : payloadMap;
    return map.has(key) ? { present: true, value: map.get(key) } : { present: false };
  }
  function wildcard(pattern) {
    const contextPath = pattern.startsWith("$context.");
    const key = contextPath ? pattern.slice("$context.".length) : pattern;
    const map = contextPath ? contextMap : payloadMap;
    const parts = key.split("[*]").map(escapeRegex);
    const matcher = new RegExp(`^${parts.join("\\[([0-9]+)\\]")}$`, "u");
    const matches = [];
    for (const [concrete, value] of map) {
      const match = matcher.exec(concrete);
      if (match) matches.push({ path: contextPath ? `$context.${concrete}` : concrete, value, indexes: match.slice(1).map(Number) });
    }
    matches.sort((a, b) => tupleCompare(a.indexes, b.indexes));
    return matches;
  }
  return { get, wildcard };
}

function tupleCompare(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

module.exports = { flatten, resolver, tupleCompare };
