"use strict";

/**
 * Внутренняя flat-проекция nested JSON и разрешение точных путей.
 *
 * Непустой контейнер не является значением собственного пути; листья — скаляры
 * и пустые контейнеры. Структурное раскрытие wildcard RC.6 вынесено в отдельный
 * модуль и использует исходный безопасный вложенный payload.
 */

const { expandWildcard } = require("./wildcard");

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
  function wildcard(plan) { return expandWildcard(payload, plan); }
  return { get, wildcard };
}

module.exports = { flatten, resolver };
