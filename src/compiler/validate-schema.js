/**
 * compiler/validate-schema.js
 *
 * Фаза 2 валидации: проверяет схему каждого артефакта в отдельности.
 * Не знает о ссылках между артефактами — только о структуре одного артефакта.
 *
 * Все функции возвращают string[] (список ошибок) вместо бросания исключений.
 * Пустой массив = нет ошибок.
 */

'use strict';

const { isObject, normalizeWhenExpr, stepKind } = require('../utils');
const { where } = require('./context');
const { assertSafePath } = require('../safe-json');

const LEVELS = new Set(['WARNING', 'ERROR', 'EXCEPTION']);

const VALID_CHECK_AGGREGATE_MODES     = new Set(['EACH', 'ALL', 'COUNT', 'MIN', 'MAX']);
const VALID_PREDICATE_AGGREGATE_MODES = new Set(['ANY', 'ALL', 'COUNT']);

const FIELD_COMPARE_OPERATORS = new Set([
  'field_less_than_field',
  'field_greater_than_field',
  'field_equals_field',
  'field_not_equals_field',
  'field_less_or_equal_than_field',
  'field_greater_or_equal_than_field',
]);

function validateSchema(artifacts, dictionaries, operators) {
  const errors = [];
  for (const a of artifacts) {
    if (a.type === 'pipeline') {
      errors.push(...validatePipelineSchema(a));
    } else if (a.type === 'condition') {
      errors.push(...validateConditionSchema(a));
    } else if (a.type === 'rule') {
      errors.push(...validateRuleSchema(a, dictionaries, operators));
    } else if (a.type === 'dictionary') {
      errors.push(...validateDictionarySchema(a));
    } else {
      errors.push(`Unknown artifact type: ${a.type} (id=${a.id}, source=${where(a)})`);
    }
  }
  return errors;
}

function validateDictionarySchema(a) {
  const errors = [];
  if (!Array.isArray(a.entries)) return [`Dictionary ${where(a)}: entries must be an array`];
  const seen = new Set();
  for (let index = 0; index < a.entries.length; index++) {
    const entry = a.entries[index];
    const value = isObject(entry) ? (Object.hasOwn(entry, 'code') ? entry.code : entry.value) : entry;
    if (value === undefined) errors.push(`Dictionary ${where(a)}: entry ${index} must contain code or value`);
    else { const key = JSON.stringify(value); if (seen.has(key)) errors.push(`Dictionary ${where(a)}: duplicate entry ${key}`); seen.add(key); }
  }
  return errors;
}

function validatePipelineSchema(a) {
  const errors = [];
  if (!Array.isArray(a.flow) || a.flow.length === 0) {
    errors.push(`Pipeline ${where(a)}: flow must be non-empty array`);
  }
  if (typeof a.strict !== 'boolean') {
    errors.push(`Pipeline ${where(a)}: strict must be explicitly set to true|false`);
  }
  if (typeof a.entrypoint !== 'boolean') {
    errors.push(`Pipeline ${where(a)}: entrypoint must be explicitly set to true|false`);
  }
  if (a.required_context !== undefined) {
    if (!Array.isArray(a.required_context) || a.required_context.some((x) => typeof x !== 'string' || x.length === 0)) {
      errors.push(`Pipeline ${where(a)}: required_context must be array of non-empty strings if provided`);
    }
  }
  if (a.strict === true) {
    if (typeof a.message !== 'string' || a.message.length === 0) {
      errors.push(`Pipeline ${where(a)}: message is required when strict=true`);
    }
    if (a.strictCode !== undefined && (typeof a.strictCode !== 'string' || a.strictCode.length === 0)) {
      errors.push(`Pipeline ${where(a)}: strictCode must be non-empty string if provided`);
    }
  }
  if (Array.isArray(a.flow)) {
    for (const s of a.flow) {
      if (!isObject(s)) {
        errors.push(`Pipeline ${a.id}: each flow step must be object`);
        continue;
      }
      try { stepKind(s); } catch (e) { errors.push(`Pipeline ${a.id}: ${e.message}`); }
    }
  }
  return errors;
}

function validateConditionSchema(a) {
  const errors = [];
  if (!Array.isArray(a.steps) || a.steps.length === 0) {
    errors.push(`Condition ${where(a)}: steps must be non-empty array`);
  }
  try { normalizeWhenExpr(a.when); } catch (e) {
    errors.push(`Condition ${where(a)}: invalid when — ${e.message}`);
  }
  if (Array.isArray(a.steps)) {
    for (const s of a.steps) {
      if (!isObject(s)) {
        errors.push(`Condition ${where(a)}: each step must be object`);
        continue;
      }
      try { stepKind(s); } catch (e) { errors.push(`Condition ${where(a)}: ${e.message}`); }
    }
  }
  return errors;
}

function validateRuleSchema(a, dictionaries, operators) {
  const errors = [];
  if (a.role !== 'check' && a.role !== 'predicate') {
    errors.push(`Rule ${where(a)}: role must be check|predicate`);
    return errors; // остальное бессмысленно без роли
  }
  if (typeof a.operator !== 'string' || a.operator.length === 0) {
    errors.push(`Rule ${where(a)}: operator required`);
    return errors;
  }

  if (a.role === 'check') {
    errors.push(...validateCheckRuleSchema(a, operators));
  } else {
    errors.push(...validatePredicateRuleSchema(a, operators));
  }

  errors.push(...validateOperatorParams(a, dictionaries));
  errors.push(...validateOptionalMeta(a));
  errors.push(...validateOptionalAggregate(a));
  return errors;
}

function validateCheckRuleSchema(a, operators) {
  const errors = [];
  if (!LEVELS.has(a.level)) {
    errors.push(`Check rule ${where(a)}: level must be WARNING|ERROR|EXCEPTION`);
  }
  if (typeof a.code !== 'string' || a.code.length === 0) {
    errors.push(`Check rule ${where(a)}: code required`);
  }
  if (typeof a.message !== 'string' || a.message.length === 0) {
    errors.push(`Check rule ${where(a)}: message required`);
  }
  if (!operators.check[a.operator]) {
    errors.push(`Check rule ${where(a)}: unknown operator ${a.operator}`);
  }
  return errors;
}

function validatePredicateRuleSchema(a, operators) {
  const errors = [];
  if (a.level !== undefined || a.code !== undefined || a.message !== undefined) {
    errors.push(`Predicate rule ${where(a)}: must not have level/code/message`);
  }
  if (!operators.predicate[a.operator]) {
    errors.push(`Predicate rule ${where(a)}: unknown operator ${a.operator}`);
  }
  return errors;
}

function validateOperatorParams(a, dictionaries) {
  const errors = [];
  for (const [name, path] of [['field', a.field], ['value_field', a.value_field]]) {
    try { assertSafePath(path); } catch (error) { errors.push(`Rule ${where(a)}: ${name} ${error.message}`); }
  }
  if (a.operator === 'any_filled') {
    const fields = Array.isArray(a.fields) ? a.fields : (Array.isArray(a.paths) ? a.paths : null);
    if (!Array.isArray(fields) || fields.length === 0) {
      errors.push(`Rule ${where(a)}: any_filled requires fields[]`);
    } else {
      for (const field of fields) {
        try { assertSafePath(field); } catch (error) { errors.push(`Rule ${where(a)}: fields ${error.message}`); }
      }
      const wildcard = fields.map((field) => typeof field === 'string' && field.includes('[*]'));
      if (wildcard.some(Boolean) && !wildcard.every(Boolean)) errors.push(`Rule ${where(a)}: any_filled must not mix wildcard and non-wildcard fields`);
      if (wildcard.every(Boolean)) {
        const bases = new Set(fields.map((field) => field.slice(0, field.lastIndexOf('[*]') + 3)));
        if (bases.size !== 1) errors.push(`Rule ${where(a)}: any_filled wildcard fields must share one base pattern`);
        if (a.aggregate && !new Set(['EACH', 'ALL']).has(a.aggregate.mode)) errors.push(`Rule ${where(a)}: any_filled wildcard aggregate.mode must be EACH|ALL`);
      }
    }
  }
  if (a.operator === 'in_dictionary') {
    if (!a.dictionary || a.dictionary.type !== 'static' || typeof a.dictionary.id !== 'string') {
      errors.push(`Rule ${where(a)}: in_dictionary requires dictionary{type:static,id}`);
    } else if (!dictionaries.has(a.dictionary.id)) {
      errors.push(`Rule ${where(a)}: dictionary not found: ${a.dictionary.id}`);
    }
  }
  if (FIELD_COMPARE_OPERATORS.has(a.operator)) {
    if (typeof a.value_field !== 'string' || a.value_field.length === 0) {
      errors.push(`Rule ${where(a)}: ${a.operator} requires value_field`);
    }
  }
  if (a.operator === 'matches_regex') {
    if (typeof a.value !== 'string' || a.value.length === 0) {
      errors.push(`Rule ${where(a)}: matches_regex requires value (regex string)`);
    } else {
      // Validate the regex pattern at compile time.
      // Without this, an invalid pattern causes a silent ABORT at runtime.
      try {
        const flags = typeof a.flags === 'string' ? a.flags : '';
        const pattern = String(a.value).replace(/\\\\/g, '\\');
        new RegExp(pattern, flags);
      } catch (e) {
        errors.push(`Rule ${where(a)}: matches_regex has invalid regex pattern — ${e.message}`);
      }
    }
  }
  return errors;
}

function validateOptionalMeta(a) {
  if (a.meta !== undefined && !isObject(a.meta)) {
    return [`Rule ${where(a)}: meta must be an object if provided`];
  }
  return [];
}

function validateOptionalAggregate(a) {
  const errors = [];
  if (a.aggregate === undefined) return errors;
  if (!isObject(a.aggregate)) {
    errors.push(`Rule ${where(a)}: aggregate must be an object if provided`);
    return errors;
  }
  if (a.aggregate.mode !== undefined) {
    if (typeof a.aggregate.mode !== 'string' || a.aggregate.mode.length === 0) {
      errors.push(`Rule ${where(a)}: aggregate.mode must be non-empty string`);
    } else {
      const validModes = a.role === 'check' ? VALID_CHECK_AGGREGATE_MODES : VALID_PREDICATE_AGGREGATE_MODES;
      if (!validModes.has(a.aggregate.mode)) {
        errors.push(
          `Rule ${where(a)}: aggregate.mode "${a.aggregate.mode}" is not valid for role=${a.role}. ` +
          `Allowed: ${[...validModes].join(', ')}`
        );
      }
    }
  }
  if (a.aggregate.onEmpty !== undefined) {
    if (typeof a.aggregate.onEmpty !== 'string' || a.aggregate.onEmpty.length === 0) {
      errors.push(`Rule ${where(a)}: aggregate.onEmpty must be non-empty string`);
    } else {
      const allowed = a.role === 'check' ? new Set(['PASS', 'FAIL', 'ERROR']) : new Set(['TRUE', 'FALSE', 'UNDEFINED', 'ERROR']);
      if (!allowed.has(a.aggregate.onEmpty)) errors.push(`Rule ${where(a)}: aggregate.onEmpty "${a.aggregate.onEmpty}" is invalid. Allowed: ${[...allowed].join(', ')}`);
    }
  }
  if (a.aggregate.op !== undefined && !new Set(['=', '==', '!=', '>', '>=', '<', '<=']).has(a.aggregate.op)) errors.push(`Rule ${where(a)}: aggregate.op is invalid`);
  if (a.aggregate.value !== undefined && (typeof a.aggregate.value !== 'number' || !Number.isFinite(a.aggregate.value))) errors.push(`Rule ${where(a)}: aggregate.value must be a finite number`);
  if (a.aggregate.summaryIssue !== undefined && typeof a.aggregate.summaryIssue !== 'boolean') errors.push(`Rule ${where(a)}: aggregate.summaryIssue must be boolean`);
  return errors;
}

/**
 * Проверяет уникальность error-кодов среди всех check-правил.
 * Возвращает string[] ошибок.
 */
function validateCodeUniqueness(artifacts) {
  const errors = [];
  const codes  = new Map();
  for (const a of artifacts) {
    if (a.type !== 'rule' || a.role !== 'check') continue;
    if (codes.has(a.code)) {
      errors.push(
        `Duplicate check code "${a.code}": already used by ${codes.get(a.code)}, conflict with ${where(a)}`
      );
    } else {
      codes.set(a.code, where(a));
    }
  }
  return errors;
}

module.exports = { validateSchema, validateCodeUniqueness };
