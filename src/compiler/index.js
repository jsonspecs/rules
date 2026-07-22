"use strict";

/**
 * Оркестратор компиляции RC.7.
 *
 * Порядок фаз отражает нормативный приоритет: конверт и хеш -> локальные схемы
 * -> ссылки/DAG/замыкание -> наличие внешних операторов. Последняя фаза важна:
 * OPERATOR_NOT_FOUND нельзя выдавать, если тот же снэпшот независимо сломан.
 */

const { prepareSnapshot } = require("./snapshot");
const { validateArtifacts } = require("./artifacts");
const { validateReferences } = require("./references");
const { compileWildcardPaths } = require("./paths");
const { createPrepared } = require("../prepared");
const { reject, CompilationError, isCompilationError, safeErrorString } = require("../errors");
const { parseIJson } = require("../json/i-json");

function compileSnapshot(input, environment) {
  const snapshot = prepareSnapshot(input);
  const unknown = validateArtifacts(snapshot, environment.operators, environment.validators);
  validateReferences(snapshot);
  if (unknown.size) {
    const names = [...unknown].sort();
    reject("OPERATOR_NOT_FOUND", `Operator not found: ${names.join(", ")}`, { identifier: "OPERATOR_NOT_FOUND" });
  }
  const state = Object.freeze({
    snapshot,
    artifacts: snapshot.artifacts,
    exports: new Set(snapshot.exports),
    operators: environment.operators,
    wildcardPaths: compileWildcardPaths(snapshot.artifacts),
  });
  return createPrepared(state, {
    kind: "prepared-jsonspecs",
    artifactType: "jsonspecs-rules",
    formatVersion: 2,
    specVersion: snapshot.specVersion,
    sourceHash: snapshot.sourceHash,
  });
}

function compileSnapshotText(text, environment) {
  let parsed;
  try { parsed = parseIJson(text); }
  catch (error) {
    throw new CompilationError([{
      code: safeErrorString(error, "code", "INVALID_IJSON"),
      message: safeErrorString(error, "message", "Snapshot text is not valid I-JSON"),
    }]);
  }
  return compileSnapshot(parsed, environment);
}

function validateSnapshot(input, environment) {
  try {
    const prepared = compileSnapshot(input, environment);
    return { ok: true, diagnostics: [], prepared };
  } catch (error) {
    if (isCompilationError(error)) return { ok: false, diagnostics: error.diagnostics, ...(error.identifier ? { identifier: error.identifier } : {}) };
    throw error;
  }
}

module.exports = { compileSnapshot, compileSnapshotText, validateSnapshot };
