"use strict";

/**
 * Строгая граница I-JSON.
 *
 * Обычный JSON.parse теряет два нарушения до того, как ядро сможет их увидеть:
 * повторяющиеся имена членов и одиночные UTF-16 суррогаты. Небольшой парсер ниже
 * сохраняет эту информацию, сразу переводит числа в binary64 и не допускает
 * переполнение. Для уже разобранных JS-значений здесь же есть безопасный клон с
 * проверкой глубины, конечности чисел и обычных JSON-контейнеров.
 */

function parseIJson(text) {
  if (typeof text !== "string") throw new TypeError("JSON text must be a string");
  let at = 0;

  function fail(message) {
    const error = new SyntaxError(`${message} at offset ${at}`);
    error.code = "INVALID_IJSON";
    throw error;
  }

  function space() {
    while (at < text.length && /[\x20\x09\x0a\x0d]/.test(text[at])) at++;
  }

  function string() {
    const start = at++;
    let escaped = false;
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (!escaped && code === 0x22) {
        at++;
        let value;
        try { value = JSON.parse(text.slice(start, at)); }
        catch (_) { fail("Invalid JSON string"); }
        assertScalarString(value, fail);
        return value;
      }
      if (!escaped && code < 0x20) fail("Unescaped control character");
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      at++;
    }
    fail("Unterminated JSON string");
  }

  function number() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!match) fail("Invalid JSON number");
    at += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("JSON number overflows binary64");
    return Object.is(value, -0) ? 0 : value;
  }

  function value(depth) {
    if (depth > 256) fail("JSON document exceeds maximum depth 256");
    space();
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === "-") return number();
    if (ch >= "0" && ch <= "9") return number();
    if (text.startsWith("true", at)) { at += 4; return true; }
    if (text.startsWith("false", at)) { at += 5; return false; }
    if (text.startsWith("null", at)) { at += 4; return null; }
    if (ch === "[") {
      at++;
      const out = [];
      space();
      if (text[at] === "]") { at++; return out; }
      while (true) {
        out.push(value(depth + 1));
        space();
        if (text[at] === "]") { at++; return out; }
        if (text[at++] !== ",") fail("Expected ',' in array");
      }
    }
    if (ch === "{") {
      at++;
      const out = Object.create(null);
      const names = new Set();
      space();
      if (text[at] === "}") { at++; return out; }
      while (true) {
        space();
        if (text[at] !== '"') fail("Expected object member name");
        const key = string();
        if (names.has(key)) fail(`Duplicate object member ${JSON.stringify(key)}`);
        names.add(key);
        space();
        if (text[at++] !== ":") fail("Expected ':' after object member name");
        out[key] = value(depth + 1);
        space();
        if (text[at] === "}") { at++; return out; }
        if (text[at++] !== ",") fail("Expected ',' in object");
      }
    }
    fail("Unexpected token");
  }

  const result = value(1);
  space();
  if (at !== text.length) fail("Trailing data");
  return result;
}

function cloneIJson(value, { maxDepth = 256 } = {}) {
  const seen = new WeakSet();

  function visit(input, depth) {
    if (depth > maxDepth) {
      const error = new TypeError(`JSON document exceeds maximum depth ${maxDepth}`);
      error.code = "JSON_TOO_DEEP";
      throw error;
    }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        const error = new TypeError("JSON number must be finite binary64");
        error.code = "INVALID_JSON_NUMBER";
        throw error;
      }
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input === "string") {
      assertScalarString(input, (message) => { throw new TypeError(message); });
      return input;
    }
    if (typeof input !== "object") throw new TypeError("Value is not representable in I-JSON");
    if (seen.has(input)) throw new TypeError("Cyclic value is not representable in I-JSON");
    seen.add(input);
    if (Array.isArray(input)) {
      const out = [];
      for (let index = 0; index < input.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(input, index)) throw new TypeError("Sparse arrays are not representable in I-JSON");
        out.push(visit(input[index], depth + 1));
      }
      seen.delete(input);
      return out;
    }
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("I-JSON object must be a plain object");
    const out = Object.create(null);
    for (const key of Object.keys(input)) {
      assertScalarString(key, (message) => { throw new TypeError(message); });
      out[key] = visit(input[key], depth + 1);
    }
    seen.delete(input);
    return out;
  }

  return visit(value, 1);
}

function assertScalarString(value, fail) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("String contains an unpaired high surrogate");
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("String contains an unpaired low surrogate");
    }
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

module.exports = { parseIJson, cloneIJson, assertScalarString, isPlainObject, deepFreeze };
