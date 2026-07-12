/**
 * compiler/context.js
 *
 * Инкапсулирует глобальное состояние compile-сессии.
 *
 * Публичный API:
 *   setContext(sources)    вызвать в начале compile()
 *   clearContext()         вызвать в finally compile()
 *   where(artifact)        id артефакта для сообщений об ошибках
 *   fileOf(id)             путь к файлу артефакта или null
 *   locationOf(id)         путь с опциональными line/column или null
 */

"use strict";

let _sources = null;

function setContext(sources) {
  _sources = sources instanceof Map ? sources : null;
}

function clearContext() {
  _sources = null;
}

function fileOf(id) {
  if (!_sources || !id) return null;
  const meta = _sources.get(id);
  if (typeof meta === "string") return meta || null;
  return meta && typeof meta.file === "string" && meta.file ? meta.file : null;
}

function locationOf(id) {
  const file = fileOf(id);
  if (!file) return null;
  const meta = _sources && _sources.get(id);
  if (!meta || typeof meta === "string") return file;
  const line = Number.isInteger(meta.line) && meta.line > 0 ? meta.line : null;
  const column = Number.isInteger(meta.column) && meta.column > 0 ? meta.column : null;
  if (line === null) return file;
  return column === null ? `${file}:${line}` : `${file}:${line}:${column}`;
}

function where(a) {
  const id = a && a.id ? a.id : "<unknown id>";
  return String(id);
}

module.exports = { setContext, clearContext, where, fileOf, locationOf };
