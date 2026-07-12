/**
 * compiler/index.js
 *
 * Оркестратор компиляции. Вызывает фазы в порядке и собирает compiled-объект.
 *
 * Фазы:
 *   1. buildRegistry          — дедупликация артефактов, сборка Map и словарей
 *   2. validateSchema         — схема каждого артефакта по типу
 *   3. validateCodeUniqueness — уникальность error-кодов check-правил
 *   4. validateRefs           — ссылки между артефактами + видимость
 *   5. buildConditions        — compile-time нормализация conditions
 *   6. buildPipelines         — compile-time нормализация pipelines
 *   7. validatePipelineDAG    — проверка отсутствия циклов
 *
 * Поведение при ошибках:
 *   Каждая фаза собирает ВСЕ найденные ошибки и возвращает их массивом.
 *   После каждой фазы: если есть ошибки — бросаем CompilationError и останавливаемся.
 *   Это даёт аналитику полный список проблем внутри фазы, но не смешивает
 *   ошибки разных фаз (например, ошибки ссылок бессмысленны если реестр сломан).
 */

'use strict';

const { assert, isObject } = require('../utils');
const { setContext, clearContext } = require('./context');
const { CompilationError } = require('./compilation-error');
const { validateSchema, validateCodeUniqueness } = require('./validate-schema');
const { validateRefs } = require('./validate-refs');
const { validatePipelineDAG } = require('./validate-dag');
const { buildConditions, buildPipelines } = require('./build-steps');
const { createHash } = require('node:crypto');
const { cloneJsonSafe } = require('../safe-json');
const { createPrepared } = require('../prepared');
const { diagnostic, artifactDiagnostic } = require('./diagnostic');

function compile(artifacts, options = {}) {
  assert(Array.isArray(artifacts), 'compile: artifacts must be an array');

  const operators = options.operators;
  assert(
    isObject(operators) &&
      isObject(operators.check) &&
      isObject(operators.predicate),
    'compile: options.operators with {check,predicate} is required',
  );

  const sources = options.sources instanceof Map ? options.sources : null;
  setContext(sources);
  try {
    const detachedArtifacts = artifacts.map((artifact, index) => detachArtifact(artifact, index));

    // Фаза 1: реестр — fail-fast, остальные фазы зависят от него
    const { registry, dictionaries, errors: regErrors } = buildRegistry(detachedArtifacts);
    throwIfErrors(regErrors);

    // Фаза 2: схема артефактов — собираем все ошибки по всем артефактам
    const schemaErrors = validateSchema(detachedArtifacts, dictionaries, operators);
    throwIfErrors(schemaErrors);

    // Фаза 3: уникальность кодов
    const codeErrors = validateCodeUniqueness(detachedArtifacts);
    throwIfErrors(codeErrors);

    // Фаза 4: ссылки и видимость
    const refErrors = validateRefs(detachedArtifacts, registry);
    throwIfErrors(refErrors);

    // Фазы 5–6: компиляция шагов (бросают assert — структура уже проверена)
    const compiledConditions = buildConditions(detachedArtifacts);
    const compiledPipelines  = buildPipelines(detachedArtifacts);

    // Фаза 7: DAG (нет циклов)
    const dagErrors = validatePipelineDAG(registry, compiledPipelines, compiledConditions);
    throwIfErrors(dagErrors);

    const sourceHash = computeSourceHash(detachedArtifacts);
    return createPrepared({
      registry,
      dictionaries,
      sources,
      operators: freezeOperatorPack(operators),
      pipelines:  compiledPipelines,
      conditions: compiledConditions,
      artifacts: detachedArtifacts,
    }, { kind: 'prepared-jsonspecs', artifactType: 'jsonspecs', version: '1', sourceHash, diagnostics: Object.freeze([]) });
  } finally {
    clearContext();
  }
}

function detachArtifact(artifact, index) {
  try {
    return deepFreeze(cloneJsonSafe(artifact));
  } catch (error) {
    const rawPath = error && error.details && error.details.path;
    const path = rawPath === '$'
      ? `[${index}]`
      : typeof rawPath === 'string' && rawPath.startsWith('$.')
        ? rawPath.slice(2)
        : rawPath || `[${index}]`;
    throw new CompilationError([diagnostic({
      code: error.code || 'ARTIFACT_NOT_JSON_SAFE',
      message: error.message,
      phase: 'source_validation',
      artifactId: safeArtifactId(artifact),
      path,
      details: error.details || null,
    })]);
  }
}

function safeArtifactId(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(artifact, 'id');
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch (_) {
    return null;
  }
}

function throwIfErrors(errors) {
  if (errors && errors.length > 0) throw new CompilationError(errors);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function computeSourceHash(artifacts) { return createHash('sha256').update(stableStringify(artifacts)).digest('hex'); }

function freezeOperatorPack(operators) {
  return Object.freeze({ check: Object.freeze({ ...operators.check }), predicate: Object.freeze({ ...operators.predicate }), meta: operators.meta ? Object.freeze({ ...operators.meta }) : undefined });
}

/**
 * Строит реестр всех артефактов и отдельный Map словарей.
 * Возвращает { registry, dictionaries, errors[] } вместо бросания исключений.
 */
function buildRegistry(artifacts) {
  const registry    = new Map();
  const dictionaries = new Map();
  const errors      = [];

  for (let index = 0; index < artifacts.length; index++) {
    const a = artifacts[index];
    if (!a || typeof a.id !== 'string' || a.id.length === 0) {
      errors.push(diagnostic({
        code: 'ARTIFACT_ID_REQUIRED',
        message: 'Artifact must have non-empty id',
        phase: 'registry_build',
        path: `[${index}].id`,
      }));
      continue;
    }
    if (typeof a.type !== 'string') {
      errors.push(artifactDiagnostic(a, {
        code: 'SCHEMA_VALIDATION_ERROR',
        message: `Artifact ${a.id} must have type`,
        phase: 'registry_build',
        path: 'type',
      }));
      continue;
    }
    if (typeof a.description !== 'string') {
      errors.push(artifactDiagnostic(a, {
        code: 'DESCRIPTION_REQUIRED',
        message: `Artifact ${a.id} must have description`,
        phase: 'registry_build',
        path: 'description',
      }));
      continue;
    }
    if (registry.has(a.id)) {
      errors.push(artifactDiagnostic(a, {
        code: 'DUPLICATE_ARTIFACT_ID',
        message: `Duplicate artifact id: ${a.id}`,
        phase: 'registry_build',
        path: 'id',
      }));
      continue;
    }
    registry.set(a.id, a);
    if (a.type === 'dictionary') dictionaries.set(a.id, a);
  }

  return { registry, dictionaries, errors };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;

  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return value;
  }
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

module.exports = { compile, computeSourceHash, stableStringify };
