const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine, Operators, validate, inspect, computeSourceHash, compileSnapshot } = require('..');

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

test('grouped wildcard any_filled evaluates each sibling group', () => {
  const artifacts = [
    { id: 'library.group', type: 'rule', description: 'group', role: 'check', operator: 'any_filled', fields: ['docs[*].serial', 'docs[*].number'], aggregate: { mode: 'EACH', onEmpty: 'FAIL' }, level: 'ERROR', code: 'DOC.REQUIRED', message: 'doc required' },
    { id: 'entry.group', type: 'pipeline', description: 'group', strict: false, entrypoint: true, flow: [{ rule: 'library.group' }] },
  ];
  const engine = createEngine({ operators: Operators });
  const result = engine.runPipeline(engine.compile(artifacts), { payload: { docs: [{ serial: 'A', number: '' }, { serial: '', number: '' }] } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].field, 'docs[1].serial');
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

test('trace basic redacts values and verbose uses redactor', () => {
  const engine = createEngine({ operators: Operators }); const prepared = engine.compile(source());
  const basic = engine.runPipeline(prepared, { payload: { x: 'secret' } }, { trace: 'basic' });
  assert.equal(basic.trace.some((entry) => Object.hasOwn(entry.details || {}, 'actual')), false);
  const verbose = engine.runPipeline(prepared, { payload: { x: 'secret' } }, { trace: 'verbose', traceRedactor: () => '[redacted]' });
  assert.equal(verbose.trace.some((entry) => Object.values(entry.details || {}).includes('[redacted]')), true);
});

test('snapshot hash is verified', () => {
  const artifacts = source();
  const snapshot = { format: 'jsonspecs-snapshot', formatVersion: 1, sourceHash: computeSourceHash(artifacts), engine: { minVersion: '2.0.0' }, artifacts };
  assert.equal(compileSnapshot(snapshot).kind, 'prepared-jsonspecs');
  snapshot.artifacts[0].field = 'y';
  assert.throws(() => compileSnapshot(snapshot), (error) => error.diagnostics[0].code === 'SNAPSHOT_HASH_MISMATCH');
});
