"use strict";

/**
 * Канонизация RFC 8785 (JCS) и sourceHash.
 *
 * JavaScript уже использует требуемое JCS-представление finite binary64 в
 * JSON.stringify. Существенная деталь здесь — сортировка ключей обычным
 * сравнением строк JS: это беззнаковые UTF-16 code units, а не code points и не
 * localeCompare. Поэтому U+10000 сортируется раньше U+E000, как требует RC.7.
 */

const { createHash } = require("node:crypto");

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS accepts finite binary64 only");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort(compareUtf16);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function computeSourceHash(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw new TypeError("Snapshot must be an object");
  const body = Object.create(null);
  for (const key of Object.keys(snapshot)) if (key !== "sourceHash") body[key] = snapshot[key];
  return createHash("sha256").update(canonicalize(body), "utf8").digest("hex");
}

function compareUtf16(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCodePoints(a, b) {
  const aa = Array.from(a, (ch) => ch.codePointAt(0));
  const bb = Array.from(b, (ch) => ch.codePointAt(0));
  const length = Math.min(aa.length, bb.length);
  for (let i = 0; i < length; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}

module.exports = { canonicalize, computeSourceHash, compareUtf16, compareCodePoints };
