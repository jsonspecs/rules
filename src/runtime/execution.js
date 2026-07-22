"use strict";

/**
 * Depth-first исполнение pipeline/condition/rule.
 *
 * Условия short-circuit слева направо, а wildcard-агрегаты exhaustive — это два
 * разных нормативных режима. pipelineId в issue всегда берётся у непосредственно
 * объемлющего pipeline; condition собственного pipelineId не создаёт.
 */

const { invokeRule } = require("./invocation");
const { evaluateAggregate } = require("./aggregation");
const { createIssue } = require("./issues");

function execute(state, resolve, rootPipelineId) {
  const issues = [];

  function rule(ruleId) {
    const artifact = state.artifacts[ruleId];
    if (artifact.aggregate) {
      const matches = resolve.wildcard(state.wildcardPaths[ruleId]);
      return evaluateAggregate(artifact, matches, (match) => invokeRule(ruleId, artifact, match, state, resolve));
    }
    return invokeRule(ruleId, artifact, null, state, resolve);
  }

  function when(expression) {
    if (typeof expression === "string") return rule(expression).outcome === "PASS";
    if (Object.prototype.hasOwnProperty.call(expression, "not")) return !when(expression.not);
    if (expression.all) {
      for (const child of expression.all) if (!when(child)) return false;
      return true;
    }
    for (const child of expression.any) if (when(child)) return true;
    return false;
  }

  function applyRule(ruleId, artifact, pipelineId) {
    const evaluation = rule(ruleId);
    if (evaluation.outcome !== "FAIL") return false;
    if (evaluation.summary) {
      issues.push(createIssue(ruleId, artifact, pipelineId, {}, { summary: true, details: evaluation.details }));
    } else if (artifact.aggregate) {
      for (const failure of evaluation.failures) issues.push(createIssue(ruleId, artifact, pipelineId, failure));
    } else issues.push(createIssue(ruleId, artifact, pipelineId, evaluation));
    return artifact.issue.level === "EXCEPTION";
  }

  // Явный стек сохраняет depth-first порядок, но не вводит скрытый предел глубины
  // графа, зависящий от размера стека вызовов Node.js.
  const stack = [{ stepIds: state.artifacts[rootPipelineId].steps, next: 0, pipelineId: rootPipelineId }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.next >= frame.stepIds.length) {
      stack.pop();
      continue;
    }
    const stepId = frame.stepIds[frame.next++];
    const target = state.artifacts[stepId];
    if (target.type === "pipeline") {
      stack.push({ stepIds: target.steps, next: 0, pipelineId: stepId });
    } else if (target.type === "condition") {
      if (when(target.when)) stack.push({ stepIds: target.steps, next: 0, pipelineId: frame.pipelineId });
    } else if (applyRule(stepId, target, frame.pipelineId)) {
      break;
    }
  }
  return issues;
}

module.exports = { execute };
