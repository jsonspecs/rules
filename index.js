"use strict";

/** CommonJS-точка входа: только semver-стабильная публичная поверхность. */

const { createEngine } = require("./src/engine");
const { builtIns } = require("./src/operators");
const { CompilationError } = require("./src/errors");
const api = require("./src/public-api");

module.exports = {
  createEngine,
  builtInOperators: builtIns,
  CompilationError,
  compileSnapshot: api.compileSnapshot,
  compileSnapshotText: api.compileSnapshotText,
  validate: api.validate,
  runPipeline: api.runPipeline,
  inspect: api.inspect,
  computeSourceHash: api.computeSourceHash,
  formatDiagnostics: api.formatDiagnostics,
  formatRuntimeError: api.formatRuntimeError,
};
