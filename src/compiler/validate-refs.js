/**
 * Compiler phase 4: validate references and visibility. The phase returns
 * structured diagnostics so contract fields never depend on message wording.
 */

'use strict';

const { normalizeWhenExpr, stepKind } = require('../utils');
const { resolveRef } = require('../resolver');
const { where } = require('./context');
const { artifactDiagnostic } = require('./diagnostic');

const PHASE = 'reference_validation';
const DEFAULT_CODE = 'SCHEMA_VALIDATION_ERROR';

function refDiagnostic(artifact, message, path, code = DEFAULT_CODE, details = null) {
  return artifactDiagnostic(artifact, {
    code,
    message,
    phase: PHASE,
    path,
    details,
  });
}

function validateRefs(artifacts, registry) {
  const errors = [];
  for (const artifact of artifacts) {
    if (artifact.type === 'pipeline') {
      errors.push(...validatePipelineRefs(artifact, registry));
    } else if (artifact.type === 'condition') {
      errors.push(...validateConditionRefs(artifact, registry));
    }
  }
  return errors;
}

function validatePipelineRefs(artifact, registry) {
  const errors = [];
  const scopePipelineId = artifact.id;
  const scope = `pipeline:${artifact.id}`;
  for (let index = 0; index < artifact.flow.length; index++) {
    errors.push(...validateStepRef(
      artifact,
      artifact.flow[index],
      registry,
      scope,
      scopePipelineId,
      `flow[${index}]`,
    ));
  }
  return errors;
}

function validateConditionRefs(artifact, registry) {
  const errors = [];
  const scopePipelineId = inferPipelineFromId(artifact.id);
  if (!scopePipelineId) {
    errors.push(refDiagnostic(
      artifact,
      `Condition ${where(artifact)}: cannot infer pipeline scope from id`,
      'id',
    ));
    return errors;
  }
  errors.push(...validateConditionWhen(artifact, registry, scopePipelineId));
  const scope = `condition:${artifact.id}`;
  for (let index = 0; index < artifact.steps.length; index++) {
    errors.push(...validateStepRef(
      artifact,
      artifact.steps[index],
      registry,
      scope,
      scopePipelineId,
      `steps[${index}]`,
    ));
  }
  return errors;
}

function validateConditionWhen(artifact, registry, scopePipelineId) {
  const errors = [];
  let when;
  try {
    when = normalizeWhenExpr(artifact.when);
  } catch (error) {
    errors.push(refDiagnostic(artifact, `Condition ${where(artifact)}: invalid when — ${error.message}`, 'when'));
    return errors;
  }

  function visit(expression, path) {
    if (expression.mode === 'single') {
      const predicateId = resolveRef('rule', expression.pred, scopePipelineId);
      const predicate = registry.get(predicateId);
      if (!predicate) {
        errors.push(refDiagnostic(
          artifact,
          `Condition ${where(artifact)}: when references missing id ${predicateId} (from ${expression.pred})`,
          path,
          'ARTIFACT_REF_NOT_FOUND',
          { kind: 'rule', ref: expression.pred, resolvedId: predicateId },
        ));
        return;
      }
      if (predicate.type !== 'rule' || predicate.role !== 'predicate') {
        errors.push(refDiagnostic(
          artifact,
          `Condition ${where(artifact)}: when ${predicateId} must be rule(role=predicate)`,
          path,
          'WHEN_RULE_MUST_BE_PREDICATE',
          { ref: expression.pred, resolvedId: predicateId },
        ));
      }
      return;
    }
    for (let index = 0; index < (expression.items || []).length; index++) {
      visit(expression.items[index], `${path}.${expression.mode}[${index}]`);
    }
  }

  visit(when, 'when');
  return errors;
}

function validateStepRef(artifact, step, registry, scope, scopePipelineId, stepPath) {
  const errors = [];
  let kind;
  try {
    kind = stepKind(step);
  } catch (error) {
    errors.push(refDiagnostic(artifact, `${scope}: ${error.message}`, stepPath));
    return errors;
  }
  const ref = step[kind];
  const refPath = `${stepPath}.${kind}`;

  if (kind === 'pipeline') {
    if (typeof ref !== 'string' || ref.length === 0) {
      errors.push(refDiagnostic(artifact, `Invalid pipeline ref in ${scope}`, refPath));
      return errors;
    }
    const referencedArtifact = registry.get(ref);
    if (!referencedArtifact || referencedArtifact.type !== 'pipeline') {
      errors.push(refDiagnostic(
        artifact,
        `Invalid ref in ${scope}: pipeline=${ref} must be type=pipeline`,
        refPath,
        DEFAULT_CODE,
        { kind, ref, resolvedId: ref },
      ));
    }
    return errors;
  }

  const id = resolveRef(kind, ref, scopePipelineId);
  const referencedArtifact = registry.get(id);
  if (!referencedArtifact) {
    errors.push(refDiagnostic(
      artifact,
      `Missing artifact referenced in ${scope}: ${kind}=${ref} (resolved to ${id})`,
      refPath,
      'ARTIFACT_REF_NOT_FOUND',
      { kind, ref, resolvedId: id },
    ));
    return errors;
  }
  if (kind === 'rule' && referencedArtifact.type !== 'rule') {
    errors.push(refDiagnostic(
      artifact,
      `Invalid ref in ${scope}: rule=${id} must be type=rule`,
      refPath,
      DEFAULT_CODE,
      { kind, ref, resolvedId: id, actualType: referencedArtifact.type },
    ));
  }
  if (kind === 'condition' && referencedArtifact.type !== 'condition') {
    errors.push(refDiagnostic(
      artifact,
      `Invalid ref in ${scope}: condition=${id} must be type=condition`,
      refPath,
      DEFAULT_CODE,
      { kind, ref, resolvedId: id, actualType: referencedArtifact.type },
    ));
  }
  errors.push(...validateVisibility(artifact, referencedArtifact, kind, id, scope, scopePipelineId, refPath));
  return errors;
}

function validateVisibility(owner, referencedArtifact, kind, id, scope, scopePipelineId, path) {
  if (kind !== 'rule' && kind !== 'condition') return [];
  if (typeof referencedArtifact.id === 'string' && referencedArtifact.id.startsWith('library.')) return [];
  if (typeof referencedArtifact.id === 'string' && referencedArtifact.id.startsWith(scopePipelineId + '.')) return [];
  return [refDiagnostic(
    owner,
    `Invalid ref in ${scope}: ${kind}=${id} is not visible from pipeline ${scopePipelineId}`,
    path,
    DEFAULT_CODE,
    { kind, resolvedId: id, scopePipelineId },
  )];
}

function inferPipelineFromId(id) {
  const index = id.lastIndexOf('.');
  return index > 0 ? id.slice(0, index) : null;
}

module.exports = { validateRefs, inferPipelineFromId };
