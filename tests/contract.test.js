const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine, Operators, validate, inspect, computeSourceHash, compileSnapshot } = require('..');
const { version: packageVersion } = require('../package.json');

function source(operator = 'not_empty') {
  return [
    { id: 'library.required', type: 'rule', description: 'required', role: 'check', operator, level: 'ERROR', code: 'X.REQUIRED', message: 'required', field: 'x' },
    { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, required_context: [], flow: [{ rule: 'library.required' }] },
  ];
}

test('validate returns structured diagnostics without throwing', () => {
  const result = validate([{ id: 'bad', type: 'pipeline', description: 'bad', strict: false, entrypoint: true, flow: [] }]);
  assert.equal(result.ok, false);
  assert.equal(typeof result.diagnostics[0].code, 'string');
  assert.equal(result.diagnostics[0].level, 'error');
});

test('prepared artifact is opaque and inspect is read-only', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(source());
  assert.deepEqual(Object.keys(prepared).sort(), ['artifactType', 'diagnostics', 'kind', 'sourceHash', 'version']);
  assert.equal(prepared.registry, undefined);
  assert.equal(inspect(prepared).getArtifact('entry.main').id, 'entry.main');
});

test('runtime rejects foreign artifact and never throws', () => {
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline({}, { pipelineId: 'x', payload: {} });
  assert.equal(result.status, 'ABORT');
  assert.equal(result.control, 'STOP');
  assert.equal(result.error.code, 'INVALID_COMPILED_ARTIFACT');
  assert.equal('stack' in result.error, false);
});

test('payload safety errors and operator contract violations are coded', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(source());
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(engine.runPipeline(prepared, { payload: cyclic }).error.code, 'PAYLOAD_CYCLE_DETECTED');
  assert.equal(engine.runPipeline(prepared, { payload: { 'x.y': 1, x: { y: 2 } } }).error.code, 'CONFLICTING_PAYLOAD_PATHS');
  const custom = createEngine({ operators: { check: { ...Operators.check, broken: () => ({ ok: true }) }, predicate: Operators.predicate } });
  const broken = custom.compile(source('broken'));
  assert.equal(custom.runPipeline(broken, { payload: { x: 1 } }).error.code, 'OPERATOR_CONTRACT_VIOLATION');
});

test('context safety errors are coded like payload safety errors', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(source());
  const cyclic = {}; cyclic.self = cyclic;

  assert.equal(engine.runPipeline(prepared, { payload: { x: 'ok' }, context: cyclic }).error.code, 'PAYLOAD_CYCLE_DETECTED');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'ok' }, context: JSON.parse('{"__proto__":1}') }).error.code, 'DANGEROUS_PAYLOAD_KEY');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'ok' }, context: { k: Infinity } }).error.code, 'PAYLOAD_NOT_JSON_SAFE');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'ok' }, context: { k: new Date('2026-01-01T00:00:00Z') } }).error.code, 'PAYLOAD_NOT_JSON_SAFE');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'ok' }, context: [] }).error.code, 'INVALID_EVALUATION_INPUT');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'ok' }, context: 'bad' }).error.code, 'INVALID_EVALUATION_INPUT');
});

test('deep payload and context inputs abort with structured depth errors', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(source());

  {
    const result = engine.runPipeline(prepared, { payload: { x: 'ok', deep: nestedObject(300) } });
    assert.equal(result.status, 'ABORT');
    assert.equal(result.error.code, 'PAYLOAD_TOO_DEEP');
    assert.equal(result.error.details.maxDepth, 256);
    assert.equal(result.error.details.path.startsWith('deep.'), true);
  }

  {
    const result = engine.runPipeline(prepared, { payload: { x: 'ok' }, context: { deep: nestedObject(300) } });
    assert.equal(result.status, 'ABORT');
    assert.equal(result.error.code, 'PAYLOAD_TOO_DEEP');
    assert.equal(result.error.details.maxDepth, 256);
    assert.equal(result.error.details.path.startsWith('deep.'), true);
  }
});

test('legacy payload.__context uses the same safety checks', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(source());
  const payload = { x: 'ok', __context: JSON.parse('{"__proto__":1}') };
  assert.equal(engine.runPipeline(prepared, { payload }).error.code, 'DANGEROUS_PAYLOAD_KEY');
});

test('runtime uses a checked copy of input context', () => {
  const externalContext = { k: 'v' };
  const custom = createEngine({
    operators: {
      check: {
        ...Operators.check,
        context_stays_cloned(rule, ctx) {
          externalContext.k = 'mutated';
          const got = ctx.get('$context.k');
          return { status: got.ok && got.value === 'v' ? 'OK' : 'FAIL' };
        },
      },
      predicate: Operators.predicate,
    },
  });
  const artifacts = [
    { id: 'library.context.clone', type: 'rule', description: 'clone', role: 'check', operator: 'context_stays_cloned', field: 'x', level: 'ERROR', code: 'CTX.CLONE', message: 'clone' },
    { id: 'entry.context', type: 'pipeline', description: 'context', strict: false, entrypoint: true, flow: [{ rule: 'library.context.clone' }] },
  ];

  const result = custom.runPipeline(custom.compile(artifacts), { payload: { x: 'ok' }, context: externalContext });
  assert.equal(result.status, 'OK');
  assert.equal(externalContext.k, 'mutated');
});

test('input.context resolves $context fields', () => {
  const engine = createEngine({ operators: Operators });
  const artifacts = [
    { id: 'library.context.eq', type: 'rule', description: 'context eq', role: 'check', operator: 'field_equals_field', field: 'x', value_field: '$context.k', level: 'ERROR', code: 'CTX.EQ', message: 'eq' },
    { id: 'entry.context', type: 'pipeline', description: 'context', strict: false, entrypoint: true, flow: [{ rule: 'library.context.eq' }] },
  ];
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { x: 'v' }, context: { k: 'v' } });
  assert.equal(result.status, 'OK');
});

test('type assertion check operators use strict type semantics', () => {
  const engine = createEngine({ operators: Operators });
  const cases = [
    { operator: 'is_boolean', ok: [true, false], fail: ['true', 1, null, {}] },
    { operator: 'is_string', ok: ['text', ''], fail: [1, true, null, {}] },
    { operator: 'is_number', ok: [1, 1.5], fail: ['1', true, null, {}] },
    { operator: 'is_integer', ok: [1, 1.0], fail: [1.5, '1', true, null, {}] },
  ];

  for (const fixture of cases) {
    const direct = Operators.check[fixture.operator]({ field: 'x' }, directCtx({}));
    assert.equal(direct.status, 'FAIL', `${fixture.operator} absent direct status`);
    assert.equal(Operators.check[fixture.operator]({ field: 'x' }, directCtx({ x: Object.create(null) })).status, 'FAIL', `${fixture.operator} object direct status`);

    const prepared = engine.compile(typeAssertionCheckArtifacts(fixture.operator));
    assert.equal(engine.runPipeline(prepared, { payload: {} }).status, 'ERROR', `${fixture.operator} absent runtime`);
    for (const value of fixture.ok) {
      assert.equal(engine.runPipeline(prepared, { payload: { x: value } }).status, 'OK', `${fixture.operator} OK for ${String(value)}`);
    }
    for (const value of fixture.fail) {
      assert.equal(engine.runPipeline(prepared, { payload: { x: value } }).status, 'ERROR', `${fixture.operator} FAIL for ${String(value)}`);
    }
  }
});

test('type assertion predicate operators use strict type semantics', () => {
  const engine = createEngine({ operators: Operators });
  const cases = [
    { operator: 'is_boolean', trueValues: [true, false], falseValues: ['true', 1, null, {}] },
    { operator: 'is_string', trueValues: ['text', ''], falseValues: [1, true, null, {}] },
    { operator: 'is_number', trueValues: [1, 1.5], falseValues: ['1', true, null, {}] },
    { operator: 'is_integer', trueValues: [1, 1.0], falseValues: [1.5, '1', true, null, {}] },
  ];

  for (const fixture of cases) {
    const direct = Operators.predicate[fixture.operator]({ field: 'x' }, directCtx({}));
    assert.equal(direct.status, 'UNDEFINED', `${fixture.operator} absent direct status`);
    assert.equal(Operators.predicate[fixture.operator]({ field: 'x' }, directCtx({ x: Object.create(null) })).status, 'FALSE', `${fixture.operator} object direct status`);

    const prepared = engine.compile(typeAssertionPredicateArtifacts(fixture.operator));
    assert.equal(engine.runPipeline(prepared, { payload: { y: '' } }).status, 'OK', `${fixture.operator} absent runtime`);
    for (const value of fixture.trueValues) {
      assert.equal(engine.runPipeline(prepared, { payload: { x: value, y: '' } }).status, 'ERROR', `${fixture.operator} TRUE for ${String(value)}`);
    }
    for (const value of fixture.falseValues) {
      assert.equal(engine.runPipeline(prepared, { payload: { x: value, y: '' } }).status, 'OK', `${fixture.operator} FALSE for ${String(value)}`);
    }
  }
});

test('not_true is a check-only absence-tolerant flag guard', () => {
  assert.equal(Operators.predicate.not_true, undefined);

  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(notTrueArtifacts());

  const fail = engine.runPipeline(prepared, { payload: { x: true } });
  assert.equal(fail.status, 'ERROR');
  assert.equal(fail.issues.length, 1);

  for (const payload of [
    { x: false },
    { x: 'true' },
    { x: 1 },
    { x: 0 },
    { x: null },
    { x: '' },
    { x: {} },
    {},
  ]) {
    const result = engine.runPipeline(prepared, { payload });
    assert.equal(result.status, 'OK', JSON.stringify(payload));
    assert.equal(result.issues.length, 0);
  }
});

test('check operator EXCEPTION aborts as OPERATOR_FAULT without leaking source error', () => {
  const custom = createEngine({
    operators: {
      check: { ...Operators.check, secret_check: () => ({ status: 'EXCEPTION', error: new Error('SECRET') }) },
      predicate: Operators.predicate,
    },
  });
  const artifacts = source('secret_check');
  const result = custom.runPipeline(custom.compile(artifacts), { payload: { x: 1 } });

  assert.equal(result.status, 'ABORT');
  assert.equal(result.error.code, 'OPERATOR_FAULT');
  assert.equal(result.error.message, 'Operator secret_check failed for rule library.required');
  assert.deepEqual(result.error.details, { operator: 'secret_check', ruleId: 'library.required' });
  assert.deepEqual(result.ruleset, { sourceHash: computeSourceHash(artifacts), engineVersion: packageVersion });
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('predicate operator EXCEPTION aborts as OPERATOR_FAULT without leaking source error', () => {
  const custom = createEngine({
    operators: {
      check: Operators.check,
      predicate: { ...Operators.predicate, secret_predicate: () => ({ status: 'EXCEPTION', error: new Error('SECRET') }) },
    },
  });
  const artifacts = [
    { id: 'library.secret.pred', type: 'rule', description: 'predicate', role: 'predicate', operator: 'secret_predicate', field: 'x' },
    { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
    { id: 'library.secret.cond', type: 'condition', description: 'condition', when: 'library.secret.pred', steps: [{ rule: 'library.after' }] },
    { id: 'entry.secret', type: 'pipeline', description: 'pipeline', strict: false, entrypoint: true, flow: [{ condition: 'library.secret.cond' }] },
  ];
  const result = custom.runPipeline(custom.compile(artifacts), { payload: { x: 1, y: 'ok' } });

  assert.equal(result.status, 'ABORT');
  assert.equal(result.error.code, 'OPERATOR_FAULT');
  assert.equal(result.error.message, 'Operator secret_predicate failed for rule library.secret.pred');
  assert.deepEqual(result.error.details, { operator: 'secret_predicate', ruleId: 'library.secret.pred' });
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('grouped wildcard any_filled evaluates each sibling group', () => {
  const artifacts = [
    { id: 'library.group', type: 'rule', description: 'group', role: 'check', operator: 'any_filled', fields: ['docs[*].serial', 'docs[*].number'], aggregate: { mode: 'EACH', onEmpty: 'FAIL' }, level: 'ERROR', code: 'DOC.REQUIRED', message: 'doc required' },
    { id: 'entry.group', type: 'pipeline', description: 'group', strict: false, entrypoint: true, flow: [{ rule: 'library.group' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { docs: [{ serial: 'A', number: '' }, { serial: '', number: '' }] } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].field, 'docs[1]');
  assert.equal(result.issues[0].meta.reason, 'ANY_FILLED_GROUP_EMPTY');
});

test('grouped wildcard discovers groups from sibling keys and supports ALL summary', () => {
  const artifacts = [
    { id: 'library.group', type: 'rule', description: 'group', role: 'check', operator: 'any_filled', fields: ['docs[*].serial', 'docs[*].number'], aggregate: { mode: 'ALL', onEmpty: 'FAIL', summaryIssue: true }, level: 'ERROR', code: 'DOC.REQUIRED', message: 'doc required' },
    { id: 'entry.group', type: 'pipeline', description: 'group', strict: false, entrypoint: true, flow: [{ rule: 'library.group' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { docs: [{ type: 'passport' }, { type: 'license' }] } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].field, 'docs[*]');
  assert.equal(result.issues[0].meta.failedCount, 2);
});

test('MIN aggregate uses synthetic get/has context', () => {
  const artifacts = [
    { id: 'library.min', type: 'rule', description: 'min', role: 'check', operator: 'greater_than', field: 'items[*].amount', value: 0, aggregate: { mode: 'MIN', onEmpty: 'FAIL' }, level: 'ERROR', code: 'MIN', message: 'min' },
    { id: 'entry.min', type: 'pipeline', description: 'min', strict: false, entrypoint: true, flow: [{ rule: 'library.min' }] },
  ];
  const engine = createEngine({ operators: Operators });
  assert.equal(engine.runPipeline(engine.compile(artifacts), { payload: { items: [{ amount: 1 }, { amount: 2 }] } }).status, 'OK');
});

test('runtime result survives exact JSON roundtrip', () => {
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(source()), { payload: { x: '' } }, { trace: false });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('multi-field issue serializes field as null when no concrete field exists', () => {
  const artifacts = [
    {
      id: 'library.contact.any',
      type: 'rule',
      description: 'contact any',
      role: 'check',
      operator: 'any_filled',
      fields: ['phone', 'email'],
      level: 'ERROR',
      code: 'CONTACT.REQUIRED',
      message: 'contact required',
    },
    { id: 'entry.contact', type: 'pipeline', description: 'contact', strict: false, entrypoint: true, flow: [{ rule: 'library.contact.any' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = JSON.parse(JSON.stringify(engine.runPipeline(engine.compile(artifacts), { payload: { phone: '', email: '' } })));
  assert.equal(Object.hasOwn(result.issues[0], 'field'), true);
  assert.equal(result.issues[0].field, null);
});

test('numeric comparisons reject hex-like strings through public runPipeline', () => {
  const artifacts = [
    { id: 'library.amount.gt', type: 'rule', description: 'amount gt', role: 'check', operator: 'greater_than', field: 'amount', value: 10, level: 'ERROR', code: 'AMOUNT.GT', message: 'amount gt' },
    { id: 'entry.amount', type: 'pipeline', description: 'amount', strict: false, entrypoint: true, flow: [{ rule: 'library.amount.gt' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { amount: '0x1A' } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.issues[0].code, 'AMOUNT.GT');
});

test('date comparisons reject impossible calendar dates through public runPipeline', () => {
  const artifacts = [
    { id: 'library.date.gt', type: 'rule', description: 'date gt', role: 'check', operator: 'greater_than', field: 'date', value: '2026-01-01', level: 'ERROR', code: 'DATE.GT', message: 'date gt' },
    { id: 'entry.date', type: 'pipeline', description: 'date', strict: false, entrypoint: true, flow: [{ rule: 'library.date.gt' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { date: '2026-02-30' } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.issues[0].code, 'DATE.GT');
});

test('in_dictionary matches scalar entries with strict types for checks', () => {
  const engine = createEngine({ operators: Operators });

  {
    const artifacts = dictionaryCheckArtifacts([1, 2, 3]);
    const prepared = engine.compile(artifacts);
    assert.equal(engine.runPipeline(prepared, { payload: { x: 1 } }).status, 'OK');
    assert.equal(engine.runPipeline(prepared, { payload: { x: 4 } }).status, 'ERROR');
    assert.equal(engine.runPipeline(prepared, { payload: { x: '1' } }).status, 'ERROR');
  }

  {
    const prepared = engine.compile(dictionaryCheckArtifacts([true]));
    assert.equal(engine.runPipeline(prepared, { payload: { x: true } }).status, 'OK');
  }

  {
    const prepared = engine.compile(dictionaryCheckArtifacts(['21', 21]));
    assert.equal(engine.runPipeline(prepared, { payload: { x: '21' } }).status, 'OK');
    assert.equal(engine.runPipeline(prepared, { payload: { x: 21 } }).status, 'OK');
  }
});

test('in_dictionary matches scalar entries with strict types for predicates in when', () => {
  const engine = createEngine({ operators: Operators });

  {
    const prepared = engine.compile(dictionaryPredicateArtifacts([1, 2, 3]));
    assert.equal(engine.runPipeline(prepared, { payload: { x: 1, y: '' } }).status, 'ERROR');
    assert.equal(engine.runPipeline(prepared, { payload: { x: 4, y: '' } }).status, 'OK');
    assert.equal(engine.runPipeline(prepared, { payload: { x: '1', y: '' } }).status, 'OK');
  }

  {
    const prepared = engine.compile(dictionaryPredicateArtifacts([true]));
    assert.equal(engine.runPipeline(prepared, { payload: { x: true, y: '' } }).status, 'ERROR');
  }

  {
    const prepared = engine.compile(dictionaryPredicateArtifacts(['21', 21]));
    assert.equal(engine.runPipeline(prepared, { payload: { x: '21', y: '' } }).status, 'ERROR');
    assert.equal(engine.runPipeline(prepared, { payload: { x: 21, y: '' } }).status, 'ERROR');
  }
});

test('when.not inverts predicate boolean results', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(whenNotArtifacts({ not: 'library.pred' }));

  assert.equal(engine.runPipeline(prepared, { payload: { x: 'yes', y: '' } }).status, 'OK');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'no', y: '' } }).status, 'ERROR');
});

test('when.not activates when the nested predicate is undefined', () => {
  const engine = createEngine({ operators: Operators });
  const artifacts = [
    { id: 'library.pred', type: 'rule', description: 'predicate', role: 'predicate', operator: 'not_empty', field: 'missing' },
    { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
    { id: 'library.cond', type: 'condition', description: 'condition', when: { not: 'library.pred' }, steps: [{ rule: 'library.after' }] },
    { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ condition: 'library.cond' }] },
  ];
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { y: '' } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.issues[0].code, 'Y');
});

test('when.not supports nested all and any expressions', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(nestedWhenNotArtifacts());

  assert.equal(engine.runPipeline(prepared, { payload: { a: true, b: false, c: false, y: '' } }).status, 'ERROR');
  assert.equal(engine.runPipeline(prepared, { payload: { a: true, b: true, c: false, y: '' } }).status, 'OK');
  assert.equal(engine.runPipeline(prepared, { payload: { a: false, b: false, c: false, y: '' } }).status, 'OK');
});

test('when.not double negation is equivalent to the predicate', () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(whenNotArtifacts({ not: { not: 'library.pred' } }));

  assert.equal(engine.runPipeline(prepared, { payload: { x: 'yes', y: '' } }).status, 'ERROR');
  assert.equal(engine.runPipeline(prepared, { payload: { x: 'no', y: '' } }).status, 'OK');
});

test('when.not validates nested predicate references and invalid forms', () => {
  {
    const result = validate([
      { id: 'library.check', type: 'rule', description: 'check', role: 'check', operator: 'not_empty', field: 'x', level: 'ERROR', code: 'X', message: 'x' },
      { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
      { id: 'library.cond', type: 'condition', description: 'condition', when: { not: 'library.check' }, steps: [{ rule: 'library.after' }] },
      { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ condition: 'library.cond' }] },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'WHEN_RULE_MUST_BE_PREDICATE' && item.path === 'when.not'), true);
  }

  {
    const result = validate([
      { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
      { id: 'library.cond', type: 'condition', description: 'condition', when: { not: [] }, steps: [{ rule: 'library.after' }] },
      { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ condition: 'library.cond' }] },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'SCHEMA_VALIDATION_ERROR' && item.path === 'when'), true);
  }
});

test('rule issue carries entrypoint pipelineId when rule is in entrypoint flow', () => {
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(source()), { payload: { x: '' } });
  assert.equal(result.issues[0].pipelineId, 'entry.main');
});

test('rule issue carries nested pipelineId when rule is in nested pipeline flow', () => {
  const artifacts = [
    { id: 'library.required', type: 'rule', description: 'required', role: 'check', operator: 'not_empty', field: 'x', level: 'ERROR', code: 'X', message: 'x' },
    { id: 'internal.block', type: 'pipeline', description: 'block', strict: false, entrypoint: false, flow: [{ rule: 'library.required' }] },
    { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ pipeline: 'internal.block' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { x: '' } });
  assert.equal(result.issues[0].pipelineId, 'internal.block');
});

test('rule issue inside condition carries the calling nested pipelineId', () => {
  const artifacts = [
    { id: 'library.always', type: 'rule', description: 'always', role: 'predicate', operator: 'equals', field: 'kind', value: 'run' },
    { id: 'library.required', type: 'rule', description: 'required', role: 'check', operator: 'not_empty', field: 'x', level: 'ERROR', code: 'X', message: 'x' },
    { id: 'library.when', type: 'condition', description: 'when', when: 'library.always', steps: [{ rule: 'library.required' }] },
    { id: 'internal.block', type: 'pipeline', description: 'block', strict: false, entrypoint: false, flow: [{ condition: 'library.when' }] },
    { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ pipeline: 'internal.block' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { kind: 'run', x: '' } });
  assert.equal(result.issues[0].pipelineId, 'internal.block');
});

test('runtime result carries ruleset provenance from compiled source and snapshot', () => {
  const engine = createEngine({ operators: Operators });
  const artifacts = source();
  const direct = engine.runPipeline(engine.compile(artifacts), { payload: { x: 'ok' } });
  assert.deepEqual(direct.ruleset, { sourceHash: computeSourceHash(artifacts), engineVersion: packageVersion });

  const snapshot = {
    format: 'jsonspecs-snapshot',
    formatVersion: 1,
    sourceHash: computeSourceHash(artifacts),
    engine: { minVersion: '2.0.0' },
    artifacts,
    meta: { projectId: 'demo', rulesetVersion: '1.2.3' },
  };
  const result = engine.runPipeline(engine.compileSnapshot(snapshot), { payload: { x: 'ok' } });
  assert.deepEqual(result.ruleset, {
    sourceHash: snapshot.sourceHash,
    engineVersion: packageVersion,
    rulesetVersion: '1.2.3',
    projectId: 'demo',
  });
});

function dictionaryCheckArtifacts(entries) {
  return [
    { id: 'dict.values', type: 'dictionary', description: 'values', entries },
    { id: 'library.dict.check', type: 'rule', description: 'dict check', role: 'check', operator: 'in_dictionary', field: 'x', dictionary: { type: 'static', id: 'dict.values' }, level: 'ERROR', code: 'X.DICT', message: 'dict' },
    { id: 'entry.dict', type: 'pipeline', description: 'dict', strict: false, entrypoint: true, flow: [{ rule: 'library.dict.check' }] },
  ];
}

function dictionaryPredicateArtifacts(entries) {
  return [
    { id: 'dict.values', type: 'dictionary', description: 'values', entries },
    { id: 'library.dict.pred', type: 'rule', description: 'dict predicate', role: 'predicate', operator: 'in_dictionary', field: 'x', dictionary: { type: 'static', id: 'dict.values' } },
    { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
    { id: 'library.dict.condition', type: 'condition', description: 'condition', when: 'library.dict.pred', steps: [{ rule: 'library.after' }] },
    { id: 'entry.dict', type: 'pipeline', description: 'dict', strict: false, entrypoint: true, flow: [{ condition: 'library.dict.condition' }] },
  ];
}

function whenNotArtifacts(when) {
  return [
    { id: 'library.pred', type: 'rule', description: 'predicate', role: 'predicate', operator: 'equals', field: 'x', value: 'yes' },
    { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
    { id: 'library.cond', type: 'condition', description: 'condition', when, steps: [{ rule: 'library.after' }] },
    { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ condition: 'library.cond' }] },
  ];
}

function nestedWhenNotArtifacts() {
  return [
    { id: 'library.pred_a', type: 'rule', description: 'a', role: 'predicate', operator: 'equals', field: 'a', value: true },
    { id: 'library.pred_b', type: 'rule', description: 'b', role: 'predicate', operator: 'equals', field: 'b', value: true },
    { id: 'library.pred_c', type: 'rule', description: 'c', role: 'predicate', operator: 'equals', field: 'c', value: true },
    { id: 'library.after', type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
    { id: 'library.cond', type: 'condition', description: 'condition', when: { all: ['library.pred_a', { not: { any: ['library.pred_b', 'library.pred_c'] } }] }, steps: [{ rule: 'library.after' }] },
    { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [{ condition: 'library.cond' }] },
  ];
}

function typeAssertionCheckArtifacts(operator) {
  return [
    { id: `library.${operator}.check`, type: 'rule', description: operator, role: 'check', operator, field: 'x', level: 'ERROR', code: `TYPE.${operator.toUpperCase()}`, message: operator },
    { id: `entry.${operator}`, type: 'pipeline', description: operator, strict: false, entrypoint: true, flow: [{ rule: `library.${operator}.check` }] },
  ];
}

function typeAssertionPredicateArtifacts(operator) {
  return [
    { id: `library.${operator}.predicate`, type: 'rule', description: operator, role: 'predicate', operator, field: 'x' },
    { id: `library.${operator}.after`, type: 'rule', description: 'after', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: `TYPE.${operator.toUpperCase()}.AFTER`, message: 'after' },
    { id: `library.${operator}.condition`, type: 'condition', description: operator, when: `library.${operator}.predicate`, steps: [{ rule: `library.${operator}.after` }] },
    { id: `entry.${operator}`, type: 'pipeline', description: operator, strict: false, entrypoint: true, flow: [{ condition: `library.${operator}.condition` }] },
  ];
}

function notTrueArtifacts() {
  return [
    { id: 'library.flag.not_true', type: 'rule', description: 'flag', role: 'check', operator: 'not_true', field: 'x', level: 'ERROR', code: 'FLAG.TRUE', message: 'flag true' },
    { id: 'entry.flag', type: 'pipeline', description: 'flag', strict: false, entrypoint: true, flow: [{ rule: 'library.flag.not_true' }] },
  ];
}

function directCtx(payload) {
  return {
    payload,
    payloadKeys: Object.keys(payload),
    get(path) {
      return Object.hasOwn(payload, path)
        ? { ok: true, value: payload[path] }
        : { ok: false, value: undefined };
    },
    has(path) {
      return Object.hasOwn(payload, path);
    },
  };
}

function nestedObject(depth) {
  let value = 'leaf';
  for (let index = 0; index < depth; index++) value = { x: value };
  return value;
}

test('trace basic redacts values and verbose uses redactor', () => {
  const engine = createEngine({ operators: Operators }); const prepared = engine.compile(source());
  const basic = engine.runPipeline(prepared, { payload: { x: 'secret' } }, { trace: 'basic' });
  assert.equal(basic.trace.some((entry) => Object.hasOwn(entry.details || {}, 'actual')), false);
  const verbose = engine.runPipeline(prepared, { payload: { x: 'secret' } }, { trace: 'verbose', traceRedactor: () => '[redacted]' });
  assert.equal(verbose.trace.some((entry) => entry.details === '[redacted]'), true);
});

test('throwing trace redactor is contained as coded ABORT', () => {
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(source()), { payload: { x: 'secret' } }, { trace: 'verbose', traceRedactor() { throw new Error('redactor boom'); } });
  assert.equal(result.status, 'ABORT');
  assert.equal(result.control, 'STOP');
  assert.equal(result.error.code, 'TRACE_REDACTOR_ERROR');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('trace has one structural shape with pipeline boundaries', () => {
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(source()), { payload: { x: 'ok' } }, { trace: 'basic' });
  assert.equal(result.trace[0].step, 'pipeline.start');
  assert.equal(result.trace.at(-1).step, 'pipeline.finish');
  for (const entry of result.trace) {
    assert.deepEqual(Object.keys(entry).filter((key) => ['kind', 'artifactType', 'artifactId', 'step', 'at', 'outcome', 'details'].includes(key)).sort(), Object.keys(entry).sort());
    assert.equal(typeof entry.step, 'string');
    assert.notEqual(entry.step, '');
    assert.equal(entry.artifactType, 'jsonspecs');
    assert.equal(Object.hasOwn(entry, 'message'), false);
    assert.equal(Object.hasOwn(entry, 'data'), false);
    assert.equal(Object.hasOwn(entry, 'ts'), false);
  }
});

test('condition predicate trace does not emit legacy event shape', () => {
  const artifacts = [
    { id: 'entry.cond.is_set', type: 'rule', description: 'predicate', role: 'predicate', operator: 'not_empty', field: 'x' },
    { id: 'entry.cond.required', type: 'rule', description: 'required', role: 'check', operator: 'not_empty', field: 'y', level: 'ERROR', code: 'Y', message: 'y' },
    { id: 'entry.cond.when_set', type: 'condition', description: 'condition', when: 'is_set', steps: [{ rule: 'required' }] },
    { id: 'entry.cond', type: 'pipeline', description: 'pipeline', strict: false, entrypoint: true, flow: [{ condition: 'when_set' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const trace = engine.runPipeline(engine.compile(artifacts), { payload: { x: 'yes', y: 'yes' } }, { trace: 'basic' }).trace;
  assert.equal(trace.some((entry) => Object.hasOwn(entry, 'message') || Object.hasOwn(entry, 'data') || Object.hasOwn(entry, 'ts')), false);
  assert.equal(trace.some((entry) => entry.step === 'condition.evaluate'), true);
});

test('direct predicate rule emits balanced trace boundaries', () => {
  const artifacts = [
    { id: 'entry.pred.is_set', type: 'rule', description: 'predicate', role: 'predicate', operator: 'not_empty', field: 'x' },
    { id: 'entry.pred', type: 'pipeline', description: 'pipeline', strict: false, entrypoint: true, flow: [{ rule: 'is_set' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const trace = engine.runPipeline(engine.compile(artifacts), { payload: { x: 'yes' } }, { trace: 'basic' }).trace;
  assert.deepEqual(trace.filter((entry) => entry.artifactId === 'entry.pred.is_set').map((entry) => entry.step), ['rule.start', 'rule.finish']);
});

test('snapshot hash is verified', () => {
  const artifacts = source();
  const snapshot = { format: 'jsonspecs-snapshot', formatVersion: 1, sourceHash: computeSourceHash(artifacts), engine: { minVersion: '2.0.0' }, artifacts };
  assert.equal(compileSnapshot(snapshot).kind, 'prepared-jsonspecs');
  snapshot.artifacts[0].field = 'y';
  assert.throws(() => compileSnapshot(snapshot), (error) => error.diagnostics[0].code === 'SNAPSHOT_HASH_MISMATCH');
});
