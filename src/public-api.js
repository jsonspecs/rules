"use strict";

/**
 * Функциональный API поверх default engine со встроенными операторами.
 *
 * Он удобен для ruleset без расширений. Как только нужны внешние операторы,
 * приложение создаёт собственный immutable engine через createEngine.
 */

const { createEngine, inspect } = require("./engine");
const { computeSourceHash } = require("./json/jcs");

const defaultEngine = createEngine();

function formatDiagnostics(diagnostics) {
  return (diagnostics || []).map((item) => `[${item.code}]${item.artifactId ? ` ${item.artifactId}` : ""} ${item.message}`).join("\n");
}

function formatRuntimeError(error) {
  return error ? `[${error.code}] ${JSON.stringify(error.details)}` : "";
}

module.exports = {
  defaultEngine,
  compileSnapshot: defaultEngine.compileSnapshot,
  compileSnapshotText: defaultEngine.compileSnapshotText,
  validate: defaultEngine.validate,
  runPipeline: defaultEngine.runPipeline,
  inspect,
  computeSourceHash,
  formatDiagnostics,
  formatRuntimeError,
};
