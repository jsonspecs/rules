"use strict";

/**
 * Точные ссылки, полное замыкание и единый control-flow DAG.
 *
 * Id непрозрачен: точки и слэши не создают scope. Все ссылки разрешаются только
 * через `artifacts[id]`. Reachability одновременно запрещает мусор в прод-бандле,
 * а DAG объединяет pipeline и condition, поэтому ловит смешанные циклы.
 */

const { reject } = require("../errors");

function validateReferences(snapshot) {
  const artifacts = snapshot.artifacts;
  for (const id of snapshot.exports) {
    if (artifacts[id]?.type !== "pipeline") reject("INVALID_EXPORT", `Export ${id} must reference a pipeline`);
  }
  for (const [id, artifact] of Object.entries(artifacts)) {
    if (artifact.type === "pipeline" || artifact.type === "condition") {
      for (const step of artifact.steps) {
        const target = artifacts[step];
        if (!target || target.type === "dictionary") reject("INVALID_STEP_REFERENCE", `${id} has invalid step ${step}`, { artifactId: id });
        if (target.type === "rule" && !target.issue) reject("RULE_STEP_WITHOUT_ISSUE", `${id} step ${step} references a rule without issue`, { artifactId: id });
      }
    }
    if (artifact.type === "condition") {
      for (const ruleId of whenRefs(artifact.when)) if (artifacts[ruleId]?.type !== "rule")
        reject("INVALID_WHEN_REFERENCE", `${id} when leaf ${ruleId} must reference a rule`, { artifactId: id });
    }
    if (artifact.type === "rule" && artifact.dictionary !== undefined && artifacts[artifact.dictionary]?.type !== "dictionary")
      reject("INVALID_DICTIONARY_REFERENCE", `${id} references missing dictionary ${artifact.dictionary}`, { artifactId: id });
  }
  validateControlFlowDag(artifacts);
  validateClosure(snapshot);
}

function whenRefs(when, out = []) {
  if (typeof when === "string") out.push(when);
  else if (Object.prototype.hasOwnProperty.call(when, "not")) whenRefs(when.not, out);
  else for (const child of when.all || when.any) whenRefs(child, out);
  return out;
}

function validateControlFlowDag(artifacts) {
  const visiting = new Set();
  const visited = new Set();
  for (const [rootId, root] of Object.entries(artifacts)) {
    if (!isControl(root) || visited.has(rootId)) continue;
    const stack = [{ id: rootId, next: 0, entered: false }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        if (visiting.has(frame.id)) reject("CONTROL_FLOW_CYCLE", `Control-flow cycle at ${frame.id}`, { artifactId: frame.id });
        if (visited.has(frame.id)) { stack.pop(); continue; }
        visiting.add(frame.id);
        frame.entered = true;
      }

      const steps = artifacts[frame.id].steps;
      let descended = false;
      while (frame.next < steps.length) {
        const targetId = steps[frame.next++];
        if (!isControl(artifacts[targetId])) continue;
        if (visiting.has(targetId)) reject("CONTROL_FLOW_CYCLE", `Control-flow cycle at ${targetId}`, { artifactId: targetId });
        if (!visited.has(targetId)) {
          stack.push({ id: targetId, next: 0, entered: false });
          descended = true;
          break;
        }
      }
      if (descended) continue;
      visiting.delete(frame.id);
      visited.add(frame.id);
      stack.pop();
    }
  }
}

function validateClosure(snapshot) {
  const seen = new Set();
  const artifacts = snapshot.artifacts;
  const stack = [...snapshot.exports].reverse();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const artifact = artifacts[id];
    if (artifact.type === "pipeline" || artifact.type === "condition")
      for (let i = artifact.steps.length - 1; i >= 0; i--) stack.push(artifact.steps[i]);
    if (artifact.type === "condition") {
      const refs = whenRefs(artifact.when);
      for (let i = refs.length - 1; i >= 0; i--) stack.push(refs[i]);
    }
    if (artifact.type === "rule" && artifact.dictionary !== undefined) stack.push(artifact.dictionary);
  }
  const unreachable = Object.keys(artifacts).filter((id) => !seen.has(id));
  if (unreachable.length) reject("UNREACHABLE_ARTIFACT", `Unreachable artifact ${unreachable.sort()[0]}`);
}

function isControl(artifact) {
  return artifact && (artifact.type === "pipeline" || artifact.type === "condition");
}

module.exports = { validateReferences, whenRefs };
