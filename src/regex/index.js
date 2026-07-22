"use strict";

/**
 * Компиляция переносимого regex-AST в RE2.
 *
 * В авторском DSL запрещены платформенные расширения, но внутреннему backend
 * разрешено использовать свои конструкции. Абсолютный `$` переводится в `\z`,
 * а все классы печатаются явными диапазонами — так результат не зависит от
 * различий `\s`, точки и Unicode-настроек JavaScript RegExp.
 */

const { RE2 } = require("re2-wasm");
const { parsePattern } = require("./parser");
const cache = new Map();
const MAX_CACHE_SIZE = 1024;

function compileRegex(pattern) {
  let compiled = cache.get(pattern);
  if (compiled) {
    cache.delete(pattern);
    cache.set(pattern, compiled);
    return compiled;
  }
  compiled = new RE2(render(parsePattern(pattern)), "u");
  cache.set(pattern, compiled);
  if (cache.size > MAX_CACHE_SIZE) cache.delete(cache.keys().next().value);
  return compiled;
}

function render(node) {
  switch (node.type) {
    case "alt": return node.branches.map(render).join("|");
    case "concat": return node.elements.map(render).join("");
    case "group": return `(?:${render(node.body)})`;
    case "anchor": return node.value === "$" ? "\\z" : "^";
    case "quantified": return `${renderAtom(node.atom)}${node.quantifier.source}`;
    case "literal": return scalar(node.cp);
    case "class": return renderClass(node.ranges);
    default: throw new TypeError(`Unknown regex AST node ${node.type}`);
  }
}

function renderAtom(node) {
  if (node.type === "literal" || node.type === "class" || node.type === "group") return render(node);
  return `(?:${render(node)})`;
}

function renderClass(ranges) {
  // Дополнение полного множества скалярных значений Unicode даёт пустой класс. Синтаксис
  // `[]` в RE2 некорректен, поэтому печатаем допустимое выражение без совпадений:
  // после абсолютного конца строки точка не может поглотить символ.
  if (ranges.length === 0) return "(?:\\z.)";
  if (ranges.length === 1 && ranges[0][0] === ranges[0][1]) return scalar(ranges[0][0]);
  return `[${ranges.map(([start, end]) => start === end ? scalar(start) : `${scalar(start)}-${scalar(end)}`).join("")}]`;
}

function scalar(codePoint) {
  return `\\x{${codePoint.toString(16)}}`;
}

module.exports = { compileRegex, parsePattern };
