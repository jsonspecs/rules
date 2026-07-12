"use strict";

const { createEngine } = require("./src/engine");
const { Operators } = require("./src/operators/index");
const { deepGet } = require("./src/utils");
const { CompilationError, RuntimeError } = require("./src/compiler/compilation-error");
const { validate, inspect, compileSnapshot, computeSourceHash, formatDiagnostics, formatRuntimeError } = require("./src/public-api");

module.exports = {
  createEngine,
  Operators,
  deepGet,
  CompilationError,
  RuntimeError,
  validate: (artifacts, options = {}) => validate(artifacts, { ...options, operators: options.operators || Operators }),
  compileSnapshot: (snapshot, options = {}) => compileSnapshot(snapshot, { ...options, operators: options.operators || Operators }),
  inspect,
  computeSourceHash,
  formatDiagnostics,
  formatRuntimeError,
};
