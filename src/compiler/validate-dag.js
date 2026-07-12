'use strict';

const { artifactDiagnostic } = require('./diagnostic');

function validatePipelineDAG(registry, pipelines, conditions) {
  const adjacency = new Map();
  for (const [id, model] of pipelines) adjacency.set(id, dependencies(model.steps));
  for (const [id, model] of conditions) adjacency.set(id, dependencies(model.steps));
  const errors = [];
  const reportedCycles = new Set();
  const visiting = new Set();
  const visited = new Set();
  function visit(id, stack) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(start).concat(id);
      const key = cycle.join('\u0000');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        const artifact = registry.get(id);
        errors.push(artifactDiagnostic(artifact, {
          code: 'PIPELINE_CYCLE',
          message: `Pipeline cycle detected: ${cycle.join(' -> ')}`,
          phase: 'dag_validation',
          path: artifact && artifact.type === 'condition' ? 'steps' : 'flow',
          details: { cycle },
        }));
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id); stack.push(id);
    for (const next of adjacency.get(id) || []) if (registry.has(next)) visit(next, stack);
    stack.pop(); visiting.delete(id); visited.add(id);
  }
  for (const id of adjacency.keys()) visit(id, []);
  return errors;
}

function dependencies(steps) { return (steps || []).flatMap((step) => step.kind === 'pipeline' ? [step.pipelineId] : step.kind === 'condition' ? [step.conditionId] : []); }

module.exports = { validatePipelineDAG };
