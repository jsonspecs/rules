"use strict";

/**
 * Композиционная оболочка engine.
 *
 * createEngine один раз объединяет built-ins с внешними operator packs и
 * компилирует их JSON Schema-контракты. Снэпшоты затем используют неизменный
 * registry: поведение не зависит от поздней мутации конфигурации деплоймента.
 */

const compiler = require("./compiler");
const { runPipeline } = require("./runtime");
const { createOperatorRegistry } = require("./operators");
const { compileContracts } = require("./compiler/contracts");
const { getPreparedState } = require("./prepared");

function createEngine(options = {}) {
  const operators = createOperatorRegistry(options.operators || {});
  const environment = Object.freeze({ operators, validators: compileContracts(operators) });
  return Object.freeze({
    compileSnapshot(snapshot) { return compiler.compileSnapshot(snapshot, environment); },
    compileSnapshotText(text) { return compiler.compileSnapshotText(text, environment); },
    validate(snapshot) { return compiler.validateSnapshot(snapshot, environment); },
    runPipeline,
    inspect,
  });
}

function inspect(prepared) {
  const state = getPreparedState(prepared);
  if (!state) throw new TypeError("inspect expects an artifact produced by compileSnapshot()");
  const artifacts = state.artifacts;
  return Object.freeze({
    listArtifacts(filter = {}) {
      return Object.entries(artifacts)
        .filter(([, artifact]) => !filter.type || artifact.type === filter.type)
        .map(([id, artifact]) => Object.freeze({ id, type: artifact.type }));
    },
    getArtifact(id) { return artifacts[id] || null; },
    listExports() { return Object.freeze([...state.snapshot.exports]); },
    getPipelineSteps(id) { return artifacts[id]?.type === "pipeline" ? Object.freeze([...artifacts[id].steps]) : null; },
    stats() {
      const byType = Object.create(null);
      for (const artifact of Object.values(artifacts)) byType[artifact.type] = (byType[artifact.type] || 0) + 1;
      return Object.freeze({ artifacts: Object.keys(artifacts).length, byType: Object.freeze(byType), exportCount: state.snapshot.exports.length });
    },
  });
}

module.exports = { createEngine, inspect };
