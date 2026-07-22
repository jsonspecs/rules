"use strict";

/**
 * Проверка закрытого конверта snapshot formatVersion=2.
 *
 * Эта фаза выполняется до разбора операторных контрактов: неверный хеш,
 * неподдерживаемая версия или legacy-поле должны победить OPERATOR_NOT_FOUND.
 * Клон также отделяет prepared-программу от объекта вызывающего.
 */

const { cloneIJson, isPlainObject, deepFreeze } = require("../json/i-json");
const { computeSourceHash, compareUtf16 } = require("../json/jcs");
const { reject, safeErrorString } = require("../errors");

const SUPPORTED_SPEC_VERSIONS = Object.freeze(["1.0.0-rc.6"]);
const SNAPSHOT_KEYS = new Set(["format", "formatVersion", "specVersion", "sourceHash", "exports", "artifacts"]);

function prepareSnapshot(input) {
  let snapshot;
  try { snapshot = cloneIJson(input); }
  catch (error) {
    reject(
      safeErrorString(error, "code", "INVALID_SNAPSHOT"),
      safeErrorString(error, "message", "Snapshot is not valid I-JSON"),
    );
  }
  if (!isPlainObject(snapshot)) reject("INVALID_SNAPSHOT", "Snapshot must be an object");
  for (const key of Object.keys(snapshot)) if (!SNAPSHOT_KEYS.has(key)) reject("UNKNOWN_SNAPSHOT_FIELD", `Unknown snapshot field ${key}`, { path: key });
  if (snapshot.format !== "jsonspecs-snapshot" || snapshot.formatVersion !== 2)
    reject("INVALID_SNAPSHOT", "Expected jsonspecs-snapshot formatVersion 2");
  if (typeof snapshot.specVersion !== "string" || !SUPPORTED_SPEC_VERSIONS.includes(snapshot.specVersion))
    reject("UNSUPPORTED_SPEC_VERSION", `Unsupported specVersion ${String(snapshot.specVersion)}`);
  if (typeof snapshot.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(snapshot.sourceHash))
    reject("INVALID_SOURCE_HASH", "sourceHash must be 64 lowercase hexadecimal characters");
  validateExports(snapshot.exports);
  if (!isPlainObject(snapshot.artifacts) || !Object.keys(snapshot.artifacts).length)
    reject("INVALID_ARTIFACTS", "artifacts must be a non-empty object");
  const actual = computeSourceHash(snapshot);
  if (actual !== snapshot.sourceHash) reject("SNAPSHOT_HASH_MISMATCH", "sourceHash does not match the JCS snapshot", { path: "sourceHash" });
  return deepFreeze(snapshot);
}

function validateExports(exports) {
  if (!Array.isArray(exports) || !exports.length || exports.some((id) => typeof id !== "string" || !id))
    reject("INVALID_EXPORTS", "exports must be a non-empty array of pipeline ids");
  for (let i = 1; i < exports.length; i++) {
    if (compareUtf16(exports[i - 1], exports[i]) >= 0) reject("INVALID_EXPORTS", "exports must be unique and strictly UTF-16 sorted");
  }
}

module.exports = { prepareSnapshot, SUPPORTED_SPEC_VERSIONS };
