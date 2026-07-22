"use strict";

/**
 * Проверка грамматики путей из SPEC §2.7.
 *
 * Точные пути остаются строками, а wildcard-путь компилятор заранее разбирает
 * в неизменяемые токены. Runtime не повторяет разбор и получает только уже
 * проверенный план структурного обхода RC.7.
 */

const PATH = /^(?:\$context\.)?[^.\[\]]+(?:\[(?:0|[1-9][0-9]*|\*)\])*(?:\.[^.\[\]]+(?:\[(?:0|[1-9][0-9]*|\*)\])*)*$/u;

function isPath(value, { wildcard = true, contextWildcard = false } = {}) {
  if (typeof value !== "string" || !PATH.test(value)) return false;
  if (!wildcard && value.includes("[*]")) return false;
  if (!contextWildcard && value.startsWith("$context.") && value.includes("[*]")) return false;
  return true;
}

function hasWildcard(path) { return typeof path === "string" && path.includes("[*]"); }

function parsePath(value, options) {
  if (!isPath(value, options)) return null;
  const context = value.startsWith("$context.");
  const source = context ? value.slice("$context.".length) : value;
  const tokens = [];
  let position = 0;

  while (position < source.length) {
    let end = position;
    while (end < source.length && source[end] !== "." && source[end] !== "[") end++;
    tokens.push(Object.freeze({ type: "key", value: source.slice(position, end) }));
    position = end;

    while (source[position] === "[") {
      const close = source.indexOf("]", position + 1);
      const raw = source.slice(position + 1, close);
      // Исходный текст индекса нужен для точного concrete path: binary64-число
      // может округлить допустимый DSL-индекс ещё до структурного обхода.
      tokens.push(Object.freeze(raw === "*"
        ? { type: "wildcard" }
        : { type: "index", raw, value: Number(raw) }));
      position = close + 1;
    }
    if (source[position] === ".") position++;
  }

  return Object.freeze({ context, tokens: Object.freeze(tokens) });
}

function compileWildcardPaths(artifacts) {
  const plans = Object.create(null);
  for (const [id, artifact] of Object.entries(artifacts)) {
    if (artifact.type === "rule" && hasWildcard(artifact.field)) plans[id] = parsePath(artifact.field);
  }
  return Object.freeze(plans);
}

module.exports = { isPath, hasWildcard, parsePath, compileWildcardPaths };
