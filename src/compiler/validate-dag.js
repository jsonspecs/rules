'use strict';

function validatePipelineDAG(registry, pipelines, conditions) {
  const adjacency = new Map();
  for (const [id, model] of pipelines) adjacency.set(id, dependencies(model.steps));
  for (const [id, model] of conditions) adjacency.set(id, dependencies(model.steps));
  const errors = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(id, stack) {
    if (visiting.has(id)) { const start = stack.indexOf(id); errors.push(`Pipeline cycle detected: ${stack.slice(start).concat(id).join(' -> ')}`); return; }
    if (visited.has(id)) return;
    visiting.add(id); stack.push(id);
    for (const next of adjacency.get(id) || []) if (registry.has(next)) visit(next, stack);
    stack.pop(); visiting.delete(id); visited.add(id);
  }
  for (const id of adjacency.keys()) visit(id, []);
  return [...new Set(errors)];
}

function dependencies(steps) { return (steps || []).flatMap((step) => step.kind === 'pipeline' ? [step.pipelineId] : step.kind === 'condition' ? [step.conditionId] : []); }

module.exports = { validatePipelineDAG };
