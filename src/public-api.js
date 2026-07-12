"use strict";

const { compile, computeSourceHash } = require("./compiler");
const { CompilationError } = require("./compiler/compilation-error");
const { getPreparedState } = require("./prepared");
const { parseSemver, compareSemver } = require("./semver");
const packageJson = require("../package.json");

function validate(artifacts, options = {}) {
  try { compile(artifacts, options); return { ok: true, diagnostics: [] }; }
  catch (error) {
    if (error instanceof CompilationError) return { ok: false, diagnostics: error.diagnostics };
    return { ok: false, diagnostics: [{ code: error.code || "SOURCE_VALIDATION_ERROR", level: "error", message: error.message || String(error), phase: "source_validation", artifactId: null, path: null, location: null }] };
  }
}

function inspect(prepared) {
  const state = getPreparedState(prepared);
  if (!state) throw new TypeError("inspect expects an artifact produced by compile()");
  const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
  const artifacts = [...state.registry.values()];
  return Object.freeze({
    listArtifacts(filter = {}) { return artifacts.filter((item) => !filter.type || item.type === filter.type).map((item) => Object.freeze({ id: item.id, type: item.type, role: item.role, description: item.description, entrypoint: item.entrypoint, strict: item.strict })); },
    getArtifact(id) { return state.registry.get(id) || null; },
    listEntrypoints() { return artifacts.filter((item) => item.type === "pipeline" && item.entrypoint === true).map((item) => Object.freeze({ id: item.id, description: item.description, strict: item.strict })); },
    getPipelineSteps(id) { const item = state.pipelines.get(id); return item ? copy(item.steps) : null; },
    getConditionModel(id) { const item = state.conditions.get(id); return item ? copy(item) : null; },
    listDictionaries() { return [...state.dictionaries.values()]; },
    getDictionary(id) { return state.dictionaries.get(id) || null; },
    stats() { const counts = Object.create(null); for (const item of artifacts) counts[item.type] = (counts[item.type] || 0) + 1; return Object.freeze({ artifacts: artifacts.length, byType: Object.freeze(counts), entrypointCount: artifacts.filter((item) => item.type === "pipeline" && item.entrypoint === true).length }); },
  });
}

function compileSnapshot(snapshot, options = {}) {
  if (
    !snapshot ||
    snapshot.format !== "jsonspecs-snapshot" ||
    snapshot.formatVersion !== 1 ||
    typeof snapshot.sourceHash !== "string" ||
    !Array.isArray(snapshot.artifacts)
  ) {
    throw snapshotCompilationError("INVALID_SNAPSHOT", "Invalid jsonspecs snapshot format");
  }
  const minimum = snapshot.engine && snapshot.engine.minVersion;
  const requiredVersion = parseSemver(minimum);
  if (!requiredVersion) {
    throw snapshotCompilationError(
      "INVALID_SNAPSHOT",
      "Snapshot engine.minVersion must be a valid semantic version",
      "engine.minVersion",
      { value: minimum == null ? null : minimum },
    );
  }
  const actual = computeSourceHash(snapshot.artifacts);
  if (snapshot.sourceHash !== actual) {
    throw snapshotCompilationError(
      "SNAPSHOT_HASH_MISMATCH",
      "Snapshot sourceHash does not match artifacts",
      "sourceHash",
      { expected: snapshot.sourceHash, actual },
    );
  }
  const currentVersion = parseSemver(packageJson.version);
  if (!currentVersion) throw new Error(`Invalid jsonspecs package version: ${packageJson.version}`);
  if (compareSemver(requiredVersion, currentVersion) > 0) {
    throw snapshotCompilationError(
      "SNAPSHOT_ENGINE_INCOMPATIBLE",
      `Snapshot requires jsonspecs ${minimum}; current engine is ${packageJson.version}`,
      "engine.minVersion",
      { required: minimum, current: packageJson.version },
    );
  }
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  return compile(snapshot.artifacts, {
    ...options,
    provenance: {
      sourceHash: snapshot.sourceHash,
      rulesetVersion: meta.rulesetVersion,
      projectId: meta.projectId,
    },
  });
}

function snapshotCompilationError(code, message, path = null, details = null) {
  return new CompilationError([{
    code,
    level: "error",
    message,
    phase: "source_validation",
    artifactId: null,
    path,
    location: null,
    details,
  }]);
}

function formatDiagnostics(diagnostics) { return diagnostics.map((item) => `[${item.code}]${item.location ? ` ${item.location}` : ""} ${item.message}`).join("\n"); }
function formatRuntimeError(error) { return error ? `[${error.code || "RUNTIME_ERROR"}] ${error.message || String(error)}` : ""; }

module.exports = { validate, inspect, compileSnapshot, computeSourceHash, formatDiagnostics, formatRuntimeError };
