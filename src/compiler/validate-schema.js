/**
 * Compiler phases 2 and 3: validate individual artifact schemas and check-code
 * uniqueness. Both phases return structured diagnostics and never throw for
 * ordinary source errors.
 */

'use strict';

const { isObject, normalizeWhenExpr, stepKind } = require('../utils');
const { where } = require('./context');
const { artifactDiagnostic } = require('./diagnostic');
const { assertSafePath } = require('../safe-json');
const { lintRegexReDoS } = require('./regex-redos');

const SCHEMA_PHASE = 'schema_validation';
const UNIQUENESS_PHASE = 'uniqueness_validation';
const SCHEMA_CODE = 'SCHEMA_VALIDATION_ERROR';
const LEVELS = new Set(['WARNING', 'ERROR', 'EXCEPTION']);

const VALID_CHECK_AGGREGATE_MODES = new Set(['EACH', 'ALL', 'COUNT', 'MIN', 'MAX']);
const VALID_PREDICATE_AGGREGATE_MODES = new Set(['ANY', 'ALL', 'COUNT']);

const FIELD_COMPARE_OPERATORS = new Set([
  'field_less_than_field',
  'field_greater_than_field',
  'field_equals_field',
  'field_not_equals_field',
  'field_less_or_equal_than_field',
  'field_greater_or_equal_than_field',
]);
const REGEX_FLAGS_RE = /^(?!.*(.).*\1)[ims]*$/;

function schemaDiagnostic(artifact, message, path, code = SCHEMA_CODE, details = null, level = 'error') {
  return artifactDiagnostic(artifact, {
    code,
    message,
    phase: SCHEMA_PHASE,
    path,
    details,
    level,
  });
}

function validateSchema(artifacts, dictionaries, operators) {
  const errors = [];
  for (const artifact of artifacts) {
    if (artifact.type === 'pipeline') {
      errors.push(...validatePipelineSchema(artifact));
    } else if (artifact.type === 'condition') {
      errors.push(...validateConditionSchema(artifact));
    } else if (artifact.type === 'rule') {
      errors.push(...validateRuleSchema(artifact, dictionaries, operators));
    } else if (artifact.type === 'dictionary') {
      errors.push(...validateDictionarySchema(artifact));
    } else {
      errors.push(schemaDiagnostic(
        artifact,
        `Unknown artifact type ${String(artifact.type)} for artifact ${where(artifact)}`,
        'type',
      ));
    }
  }
  return errors;
}

function validateDictionarySchema(artifact) {
  const errors = [];
  if (!Array.isArray(artifact.entries)) {
    return [schemaDiagnostic(artifact, `Dictionary ${where(artifact)}: entries must be an array`, 'entries')];
  }
  const seen = new Set();
  for (let index = 0; index < artifact.entries.length; index++) {
    const entry = artifact.entries[index];
    if (entry === null) {
      errors.push(schemaDiagnostic(
        artifact,
        `Dictionary ${where(artifact)}: entry ${index} must not be null`,
        `entries[${index}]`,
        'DICTIONARY_ENTRY_INVALID',
      ));
      continue;
    }
    const value = isObject(entry) ? (Object.hasOwn(entry, 'code') ? entry.code : entry.value) : entry;
    if (value === undefined) {
      errors.push(schemaDiagnostic(
        artifact,
        `Dictionary ${where(artifact)}: entry ${index} must contain code or value`,
        `entries[${index}]`,
      ));
      continue;
    }
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      errors.push(schemaDiagnostic(
        artifact,
        `Dictionary ${where(artifact)}: duplicate entry ${key}`,
        `entries[${index}]`,
        SCHEMA_CODE,
        { value },
      ));
    }
    seen.add(key);
  }
  return errors;
}

function validatePipelineSchema(artifact) {
  const errors = [];
  if (!Array.isArray(artifact.flow) || artifact.flow.length === 0) {
    errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: flow must be non-empty array`, 'flow'));
  }
  if (typeof artifact.strict !== 'boolean') {
    errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: strict must be explicitly set to true|false`, 'strict'));
  }
  if (typeof artifact.entrypoint !== 'boolean') {
    errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: entrypoint must be explicitly set to true|false`, 'entrypoint'));
  }
  if (artifact.required_context !== undefined && (
    !Array.isArray(artifact.required_context) ||
    artifact.required_context.some((value) => typeof value !== 'string' || value.length === 0)
  )) {
    errors.push(schemaDiagnostic(
      artifact,
      `Pipeline ${where(artifact)}: required_context must be array of non-empty strings if provided`,
      'required_context',
    ));
  }
  if (artifact.strict === true) {
    if (typeof artifact.message !== 'string' || artifact.message.length === 0) {
      errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: message is required when strict=true`, 'message'));
    }
    if (artifact.strictCode !== undefined && (typeof artifact.strictCode !== 'string' || artifact.strictCode.length === 0)) {
      errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: strictCode must be non-empty string if provided`, 'strictCode'));
    }
  }
  if (Array.isArray(artifact.flow)) {
    for (let index = 0; index < artifact.flow.length; index++) {
      const step = artifact.flow[index];
      if (!isObject(step)) {
        errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: each flow step must be object`, `flow[${index}]`));
        continue;
      }
      try {
        stepKind(step);
      } catch (error) {
        errors.push(schemaDiagnostic(artifact, `Pipeline ${where(artifact)}: ${error.message}`, `flow[${index}]`));
      }
    }
  }
  return errors;
}

function validateConditionSchema(artifact) {
  const errors = [];
  if (!Array.isArray(artifact.steps) || artifact.steps.length === 0) {
    errors.push(schemaDiagnostic(artifact, `Condition ${where(artifact)}: steps must be non-empty array`, 'steps'));
  }
  try {
    normalizeWhenExpr(artifact.when);
  } catch (error) {
    errors.push(schemaDiagnostic(artifact, `Condition ${where(artifact)}: invalid when — ${error.message}`, 'when'));
  }
  if (Array.isArray(artifact.steps)) {
    for (let index = 0; index < artifact.steps.length; index++) {
      const step = artifact.steps[index];
      if (!isObject(step)) {
        errors.push(schemaDiagnostic(artifact, `Condition ${where(artifact)}: each step must be object`, `steps[${index}]`));
        continue;
      }
      try {
        stepKind(step);
      } catch (error) {
        errors.push(schemaDiagnostic(artifact, `Condition ${where(artifact)}: ${error.message}`, `steps[${index}]`));
      }
    }
  }
  return errors;
}

function validateRuleSchema(artifact, dictionaries, operators) {
  const errors = [];
  if (artifact.role !== 'check' && artifact.role !== 'predicate') {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: role must be check|predicate`, 'role'));
    return errors;
  }
  if (typeof artifact.operator !== 'string' || artifact.operator.length === 0) {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: operator required`, 'operator'));
    return errors;
  }

  if (artifact.role === 'check') {
    errors.push(...validateCheckRuleSchema(artifact, operators));
  } else {
    errors.push(...validatePredicateRuleSchema(artifact, operators));
  }

  errors.push(...validateOperatorParams(artifact, dictionaries));
  errors.push(...validateOptionalMeta(artifact));
  errors.push(...validateOptionalAggregate(artifact));
  return errors;
}

function validateCheckRuleSchema(artifact, operators) {
  const errors = [];
  if (!LEVELS.has(artifact.level)) {
    errors.push(schemaDiagnostic(artifact, `Check rule ${where(artifact)}: level must be WARNING|ERROR|EXCEPTION`, 'level'));
  }
  if (typeof artifact.code !== 'string' || artifact.code.length === 0) {
    errors.push(schemaDiagnostic(artifact, `Check rule ${where(artifact)}: code required`, 'code'));
  }
  if (typeof artifact.message !== 'string' || artifact.message.length === 0) {
    errors.push(schemaDiagnostic(artifact, `Check rule ${where(artifact)}: message required`, 'message'));
  }
  if (!operators.check[artifact.operator]) {
    errors.push(schemaDiagnostic(
      artifact,
      `Check rule ${where(artifact)}: unknown operator ${artifact.operator}`,
      'operator',
      'UNKNOWN_OPERATOR',
      { operator: artifact.operator, role: artifact.role },
    ));
  }
  return errors;
}

function validatePredicateRuleSchema(artifact, operators) {
  const errors = [];
  const forbiddenProperties = ['level', 'code', 'message'].filter((name) => artifact[name] !== undefined);
  if (forbiddenProperties.length > 0) {
    errors.push(schemaDiagnostic(
      artifact,
      `Predicate rule ${where(artifact)}: must not have level/code/message`,
      forbiddenProperties[0],
      SCHEMA_CODE,
      { properties: forbiddenProperties },
    ));
  }
  if (!operators.predicate[artifact.operator]) {
    errors.push(schemaDiagnostic(
      artifact,
      `Predicate rule ${where(artifact)}: unknown operator ${artifact.operator}`,
      'operator',
      'UNKNOWN_OPERATOR',
      { operator: artifact.operator, role: artifact.role },
    ));
  }
  return errors;
}

function validateOperatorParams(artifact, dictionaries) {
  const errors = [];
  for (const [name, path] of [['field', artifact.field], ['value_field', artifact.value_field]]) {
    try {
      assertSafePath(path);
    } catch (error) {
      errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: ${name} ${error.message}`, name));
    }
  }
  if (artifact.operator === 'any_filled') {
    const fieldProperty = Array.isArray(artifact.fields) ? 'fields' : 'paths';
    const fields = Array.isArray(artifact.fields) ? artifact.fields : (Array.isArray(artifact.paths) ? artifact.paths : null);
    if (!Array.isArray(fields) || fields.length === 0) {
      errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: any_filled requires fields[]`, 'fields'));
    } else {
      for (let index = 0; index < fields.length; index++) {
        try {
          assertSafePath(fields[index]);
        } catch (error) {
          errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: fields ${error.message}`, `${fieldProperty}[${index}]`));
        }
      }
      const wildcard = fields.map((field) => typeof field === 'string' && field.includes('[*]'));
      if (wildcard.some(Boolean) && !wildcard.every(Boolean)) {
        errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: any_filled must not mix wildcard and non-wildcard fields`, fieldProperty));
      }
      if (wildcard.every(Boolean)) {
        const bases = new Set(fields.map((field) => field.slice(0, field.lastIndexOf('[*]') + 3)));
        if (bases.size !== 1) {
          errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: any_filled wildcard fields must share one base pattern`, fieldProperty));
        }
        if (artifact.aggregate && !new Set(['EACH', 'ALL']).has(artifact.aggregate.mode)) {
          errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: any_filled wildcard aggregate.mode must be EACH|ALL`, 'aggregate.mode'));
        }
      }
    }
  }
  if (artifact.operator === 'in_dictionary') {
    if (!artifact.dictionary || artifact.dictionary.type !== 'static' || typeof artifact.dictionary.id !== 'string') {
      errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: in_dictionary requires dictionary{type:static,id}`, 'dictionary'));
    } else if (!dictionaries.has(artifact.dictionary.id)) {
      errors.push(schemaDiagnostic(
        artifact,
        `Rule ${where(artifact)}: dictionary not found: ${artifact.dictionary.id}`,
        'dictionary.id',
        'DICTIONARY_NOT_FOUND',
        { dictionaryId: artifact.dictionary.id },
      ));
    }
  }
  if (FIELD_COMPARE_OPERATORS.has(artifact.operator) && (typeof artifact.value_field !== 'string' || artifact.value_field.length === 0)) {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: ${artifact.operator} requires value_field`, 'value_field'));
  }
  if (artifact.operator === 'matches_regex') {
    const flagsError = validateRegexFlags(artifact);
    if (flagsError) errors.push(flagsError);
    if (typeof artifact.value !== 'string' || artifact.value.length === 0) {
      errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: matches_regex requires value (regex string)`, 'value'));
    } else {
      try {
        const flags = flagsError ? '' : (typeof artifact.flags === 'string' ? artifact.flags : '');
        const pattern = String(artifact.value).replace(/\\\\/g, '\\');
        new RegExp(pattern, flags);
        const redosFindings = lintRegexReDoS(pattern);
        if (redosFindings.length > 0) {
          errors.push(schemaDiagnostic(
            artifact,
            `Rule ${where(artifact)}: matches_regex pattern has potential ReDoS risk`,
            'value',
            'REGEX_REDOS_RISK',
            { findings: redosFindings },
            'warning',
          ));
        }
      } catch (error) {
        errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: matches_regex has invalid regex pattern — ${error.message}`, 'value'));
      }
    }
  }
  return errors;
}

function validateRegexFlags(artifact) {
  if (artifact.flags === undefined) return null;
  if (typeof artifact.flags !== 'string' || !REGEX_FLAGS_RE.test(artifact.flags)) {
    return schemaDiagnostic(
      artifact,
      `Rule ${where(artifact)}: matches_regex flags must contain only i, m, s without repeats`,
      'flags',
      'RULE_REGEX_FLAGS_INVALID',
      { value: artifact.flags },
    );
  }
  return null;
}

function validateOptionalMeta(artifact) {
  if (artifact.meta !== undefined && !isObject(artifact.meta)) {
    return [schemaDiagnostic(artifact, `Rule ${where(artifact)}: meta must be an object if provided`, 'meta')];
  }
  return [];
}

function validateOptionalAggregate(artifact) {
  const errors = [];
  if (artifact.aggregate === undefined) return errors;
  if (!isObject(artifact.aggregate)) {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: aggregate must be an object if provided`, 'aggregate'));
    return errors;
  }
  if (artifact.aggregate.mode !== undefined) {
    if (typeof artifact.aggregate.mode !== 'string' || artifact.aggregate.mode.length === 0) {
      errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: aggregate.mode must be non-empty string`, 'aggregate.mode'));
    } else {
      const validModes = artifact.role === 'check' ? VALID_CHECK_AGGREGATE_MODES : VALID_PREDICATE_AGGREGATE_MODES;
      if (!validModes.has(artifact.aggregate.mode)) {
        errors.push(schemaDiagnostic(
          artifact,
          `Rule ${where(artifact)}: aggregate.mode "${artifact.aggregate.mode}" is not valid for role=${artifact.role}. Allowed: ${[...validModes].join(', ')}`,
          'aggregate.mode',
        ));
      }
    }
  }
  if (artifact.aggregate.onEmpty !== undefined) {
    if (typeof artifact.aggregate.onEmpty !== 'string' || artifact.aggregate.onEmpty.length === 0) {
      errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: aggregate.onEmpty must be non-empty string`, 'aggregate.onEmpty'));
    } else {
      const allowed = artifact.role === 'check'
        ? new Set(['PASS', 'FAIL', 'ERROR'])
        : new Set(['TRUE', 'FALSE', 'UNDEFINED', 'ERROR']);
      if (!allowed.has(artifact.aggregate.onEmpty)) {
        errors.push(schemaDiagnostic(
          artifact,
          `Rule ${where(artifact)}: aggregate.onEmpty "${artifact.aggregate.onEmpty}" is invalid. Allowed: ${[...allowed].join(', ')}`,
          'aggregate.onEmpty',
        ));
      }
    }
  }
  if (artifact.aggregate.op !== undefined && !new Set(['=', '==', '!=', '>', '>=', '<', '<=']).has(artifact.aggregate.op)) {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: aggregate.op is invalid`, 'aggregate.op'));
  }
  if (artifact.aggregate.value !== undefined && (typeof artifact.aggregate.value !== 'number' || !Number.isFinite(artifact.aggregate.value))) {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: aggregate.value must be a finite number`, 'aggregate.value'));
  }
  if (artifact.aggregate.summaryIssue !== undefined && typeof artifact.aggregate.summaryIssue !== 'boolean') {
    errors.push(schemaDiagnostic(artifact, `Rule ${where(artifact)}: aggregate.summaryIssue must be boolean`, 'aggregate.summaryIssue'));
  }
  return errors;
}

function validateCodeUniqueness(artifacts) {
  const errors = [];
  const codes = new Map();
  for (const artifact of artifacts) {
    if (artifact.type !== 'rule' || artifact.role !== 'check') continue;
    if (codes.has(artifact.code)) {
      const first = codes.get(artifact.code);
      errors.push(artifactDiagnostic(artifact, {
        code: 'DUPLICATE_CHECK_CODE',
        message: `Duplicate check code "${artifact.code}": already used by ${where(first)}, conflict with ${where(artifact)}`,
        phase: UNIQUENESS_PHASE,
        path: 'code',
        details: { code: artifact.code, firstArtifactId: first.id },
      }));
    } else {
      codes.set(artifact.code, artifact);
    }
  }
  return errors;
}

module.exports = { validateSchema, validateCodeUniqueness };
