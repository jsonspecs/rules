"use strict";

/**
 * Парсер нормативного regex-подмножества RC.5.
 *
 * Мы не проверяем паттерн эвристиками поверх RegExp: сначала разбираем ровно
 * грамматику SPEC §3.4.2, а затем строим безопасный источник для RE2. AST нужен
 * ещё и для переносимой семантики классов: платформенные \s/\S различаются,
 * поэтому классы переводятся в явные диапазоны Unicode scalar values.
 */

const MAX_PATTERN_CODE_POINTS = 1024;
const MAX_QUANTIFIER = 1000;
const SCALARS = [[0, 0xd7ff], [0xe000, 0x10ffff]];

function parsePattern(source) {
  if (typeof source !== "string") throw syntax("Pattern must be a string", 0);
  if (Array.from(source).length > MAX_PATTERN_CODE_POINTS) throw syntax("Pattern exceeds 1024 code points", 0);
  let at = 0;

  function peek() { return source[at]; }
  function take() {
    const cp = source.codePointAt(at);
    if (cp == null) return null;
    const char = String.fromCodePoint(cp);
    at += char.length;
    return { cp, char };
  }

  function alternation(stop = null) {
    const branches = [concat(stop)];
    while (peek() === "|") { at++; branches.push(concat(stop)); }
    return { type: "alt", branches };
  }

  function concat(stop) {
    const elements = [];
    while (at < source.length && peek() !== "|" && peek() !== stop) elements.push(element());
    return { type: "concat", elements };
  }

  function element() {
    if (peek() === "^" || peek() === "$") return { type: "anchor", value: source[at++] };
    const node = atom();
    const quantifier = readQuantifier();
    return quantifier ? { type: "quantified", atom: node, quantifier } : node;
  }

  function atom() {
    const ch = peek();
    if (ch == null) throw syntax("Expected atom", at);
    if (ch === ".") { at++; return { type: "class", ranges: complement([[0x0a, 0x0a]]) }; }
    if (ch === "[") return characterClass();
    if (ch === "(") {
      at++;
      if (source.startsWith("?:", at)) at += 2;
      else if (peek() === "?") throw syntax("Lookaround, named groups and inline flags are forbidden", at);
      const body = alternation(")");
      if (peek() !== ")") throw syntax("Unclosed group", at);
      at++;
      return { type: "group", body };
    }
    if (ch === "\\") return escaped(false);
    if ("*+?()[]{}|^$".includes(ch)) throw syntax(`Unexpected metacharacter ${ch}`, at);
    return { type: "literal", cp: take().cp };
  }

  function characterClass() {
    at++;
    const negate = peek() === "^" && (++at, true);
    const ranges = [];
    let count = 0;
    while (at < source.length && peek() !== "]") {
      count++;
      const left = classAtom();
      if (peek() === "-") {
        at++;
        if (peek() === "]" || peek() == null) throw syntax("Unescaped '-' must form a range", at - 1);
        const right = classAtom(true);
        if (left.length !== 1 || right.length !== 1) throw syntax("Character-class ranges require scalar endpoints", at);
        if (left[0][0] > right[0][0]) throw syntax("Character-class range is reversed", at);
        ranges.push([left[0][0], right[0][0]]);
      } else ranges.push(...left);
    }
    if (!count || peek() !== "]") throw syntax("Empty or unclosed character class", at);
    at++;
    const merged = merge(ranges);
    return { type: "class", ranges: negate ? complement(merged) : merged };
  }

  function classAtom(rangeEndpoint = false) {
    if (peek() === "-") throw syntax("Literal '-' must be escaped in a class", at);
    if (peek() === "\\") {
      const node = escaped(true);
      if (rangeEndpoint && node.ranges.length !== 1) throw syntax("Class escape cannot be a range endpoint", at);
      return node.ranges;
    }
    const item = take();
    if (!item || item.char === "]") throw syntax("Expected class atom", at);
    return [[item.cp, item.cp]];
  }

  function escaped(inClass) {
    const start = at++;
    const item = take();
    if (!item) throw syntax("Trailing backslash", start);
    const simple = { n: 0x0a, r: 0x0d, t: 0x09 };
    if (item.char in simple) return inClass ? classNode([[simple[item.char], simple[item.char]]]) : { type: "literal", cp: simple[item.char] };
    const classes = {
      d: [[0x30, 0x39]],
      w: [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]],
      s: [[0x09, 0x0d], [0x20, 0x20]],
    };
    const lower = item.char.toLowerCase();
    if (classes[lower]) {
      const ranges = item.char === lower ? merge(classes[lower]) : complement(merge(classes[lower]));
      return inClass ? classNode(ranges) : { type: "class", ranges };
    }
    const escapedMeta = "\\.*+?()[]{}|^$/-";
    if (escapedMeta.includes(item.char)) return inClass ? classNode([[item.cp, item.cp]]) : { type: "literal", cp: item.cp };
    throw syntax(`Escape \\${item.char} is forbidden`, start);
  }

  function readQuantifier() {
    const ch = peek();
    if (ch === "*" || ch === "+" || ch === "?") { at++; return ch; }
    if (ch !== "{") return null;
    const start = at++;
    const min = integer();
    let max = min;
    if (peek() === ",") {
      at++;
      max = peek() === "}" ? null : integer();
    }
    if (peek() !== "}") throw syntax("Invalid counted quantifier", start);
    at++;
    if (min > MAX_QUANTIFIER || (max != null && max > MAX_QUANTIFIER)) throw syntax("Quantifier exceeds 1000", start);
    if (max != null && min > max) throw syntax("Quantifier minimum exceeds maximum", start);
    if (peek() === "?" || peek() === "+") throw syntax("Lazy and possessive quantifiers are forbidden", at);
    return max === min ? `{${min}}` : max == null ? `{${min},}` : `{${min},${max}}`;
  }

  function integer() {
    const start = at;
    while (/[0-9]/.test(peek() || "")) at++;
    if (start === at) throw syntax("Expected integer", at);
    return Number(source.slice(start, at));
  }

  const ast = alternation();
  if (at !== source.length) throw syntax(`Unexpected token ${peek()}`, at);
  return ast;
}

function classNode(ranges) { return { type: "class", ranges }; }

function merge(input) {
  const sorted = input.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else out.push(range.slice());
  }
  return out;
}

function complement(ranges) {
  const source = merge(ranges);
  const out = [];
  for (const [start, end] of SCALARS) {
    let cursor = start;
    for (const [left, right] of source) {
      if (right < start || left > end) continue;
      if (left > cursor) out.push([cursor, Math.min(left - 1, end)]);
      cursor = Math.max(cursor, right + 1);
      if (cursor > end) break;
    }
    if (cursor <= end) out.push([cursor, end]);
  }
  return out;
}

function syntax(message, offset) {
  const error = new SyntaxError(`${message} at pattern offset ${offset}`);
  error.code = "INVALID_REGEX_PATTERN";
  return error;
}

module.exports = { parsePattern, merge, complement };
