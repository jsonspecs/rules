"use strict";

/**
 * Проверка грамматики путей из SPEC §2.7.
 *
 * Путь остаётся строкой до runtime, но компилятор заранее запрещает пустые
 * сегменты, ведущие нули индексов и wildcard там, где его семантика не задана.
 */

const PATH = /^(?:\$context\.)?[^.\[\]]+(?:\[(?:0|[1-9][0-9]*|\*)\])*(?:\.[^.\[\]]+(?:\[(?:0|[1-9][0-9]*|\*)\])*)*$/u;

function isPath(value, { wildcard = true, contextWildcard = false } = {}) {
  if (typeof value !== "string" || !PATH.test(value)) return false;
  if (!wildcard && value.includes("[*]")) return false;
  if (!contextWildcard && value.startsWith("$context.") && value.includes("[*]")) return false;
  return true;
}

function hasWildcard(path) { return typeof path === "string" && path.includes("[*]"); }

module.exports = { isPath, hasWildcard };
