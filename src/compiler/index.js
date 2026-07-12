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
const { fileOf } = require('./context');

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
  let detachedArtifacts;
  try {
    detachedArtifacts = artifacts.map((artifact) => deepFreeze(cloneJsonSafe(artifact)));
  } catch (error) {
    throw new CompilationError([diagnostic(error.code || 'ARTIFACT_NOT_JSON_SAFE', error.message, 'source_validation', null, error.details && error.details.path)]);
  }

  setContext(sources);
  try {
    // Фаза 1: реестр — fail-fast, остальные фазы зависят от него
    const { registry, dictionaries, errors: regErrors } = buildRegistry(detachedArtifacts);
    throwIfErrors(regErrors, 'registry_build');

    // Фаза 2: схема артефактов — собираем все ошибки по всем артефактам
    const schemaErrors = validateSchema(detachedArtifacts, dictionaries, operators);
    throwIfErrors(schemaErrors, 'schema_validation');

    // Фаза 3: уникальность кодов
    const codeErrors = validateCodeUniqueness(detachedArtifacts);
    throwIfErrors(codeErrors, 'uniqueness_validation');

    // Фаза 4: ссылки и видимость
    const refErrors = validateRefs(detachedArtifacts, registry);
    throwIfErrors(refErrors, 'reference_validation');

    // Фазы 5–6: компиляция шагов (бросают assert — структура уже проверена)
    const compiledConditions = buildConditions(detachedArtifacts);
    const compiledPipelines  = buildPipelines(detachedArtifacts);

    // Фаза 7: DAG (нет циклов)
    const dagErrors = validatePipelineDAG(registry, compiledPipelines, compiledConditions);
    throwIfErrors(dagErrors, 'dag_validation');

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

function throwIfErrors(errors, phase) {
  if (errors && errors.length > 0) throw new CompilationError(errors.map((message) => { const artifactId = artifactIdFromMessage(message); const file = artifactId ? fileOf(artifactId) : null; return diagnostic(codeFromMessage(message), message, phase, artifactId, null, file === '<unknown source>' ? null : file); }));
}

function artifactIdFromMessage(message) {
  const text = String(message);
  const duplicate = text.match(/Duplicate artifact id:\s*([^\s]+)/); if (duplicate) return duplicate[1];
  const scoped = text.match(/(?:Artifact|Rule|Check rule|Predicate rule|Pipeline|Condition)\s+([^\s(]+)/); return scoped ? scoped[1] : null;
}

function diagnostic(code, message, phase, artifactId = null, path = null, location = null, details = null) {
  return { code, level: 'error', message, phase, artifactId, path: path || null, location: location || null, details };
}

function codeFromMessage(message) {
  const text = String(message);
  if (/Duplicate artifact id/.test(text)) return 'DUPLICATE_ARTIFACT_ID';
  if (/must have non-empty id/.test(text)) return 'ARTIFACT_ID_REQUIRED';
  if (/must have description/.test(text)) return 'DESCRIPTION_REQUIRED';
  if (/unknown operator/.test(text)) return 'UNKNOWN_OPERATOR';
  if (/dictionary not found/.test(text)) return 'DICTIONARY_NOT_FOUND';
  if (/cycle detected/i.test(text)) return 'PIPELINE_CYCLE';
  if (/references missing|Missing artifact referenced/.test(text)) return 'ARTIFACT_REF_NOT_FOUND';
  if (/must be rule\(role=predicate\)/.test(text)) return 'WHEN_RULE_MUST_BE_PREDICATE';
  if (/Duplicate check code/.test(text)) return 'DUPLICATE_CHECK_CODE';
  return 'SCHEMA_VALIDATION_ERROR';
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

  for (const a of artifacts) {
    if (!a || typeof a.id !== 'string' || a.id.length === 0) {
      errors.push('Artifact must have non-empty id');
      continue;
    }
    if (typeof a.type !== 'string') {
      errors.push(`Artifact ${a.id} must have type`);
      continue;
    }
    if (typeof a.description !== 'string') {
      errors.push(`Artifact ${a.id} must have description`);
      continue;
    }
    if (registry.has(a.id)) {
      errors.push(`Duplicate artifact id: ${a.id}`);
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
