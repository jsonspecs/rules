const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020');
const artifactSchema = require('../schema/artifact.schema.json');
const snapshotSchema = require('../schema/snapshot.schema.json');
const { validate, computeSourceHash } = require('..');

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
ajv.addSchema(artifactSchema);
const validateArtifactSchema = ajv.getSchema(artifactSchema.$id);
const validateSnapshotSchema = ajv.compile(snapshotSchema);

const structuralCases = [
  {
    name: 'valid check rule',
    valid: true,
    artifact: { id: 'library.name', type: 'rule', description: 'name', role: 'check', operator: 'not_empty', level: 'ERROR', code: 'NAME.REQUIRED', message: 'required', field: 'name' },
  },
  {
    name: 'check rule without code',
    valid: false,
    artifact: { id: 'library.name', type: 'rule', description: 'name', role: 'check', operator: 'not_empty', level: 'ERROR', message: 'required', field: 'name' },
  },
  {
    name: 'pipeline with empty flow',
    valid: false,
    artifact: { id: 'entry.main', type: 'pipeline', description: 'main', strict: false, entrypoint: true, flow: [] },
  },
  {
    name: 'valid dictionary',
    valid: true,
    artifact: { id: 'codes', type: 'dictionary', description: 'codes', entries: ['A', 'B'] },
  },
  {
    name: 'predicate with check-only aggregate mode',
    valid: false,
    artifact: { id: 'entry.main.present', type: 'rule', description: 'present', role: 'predicate', operator: 'not_empty', field: 'name', aggregate: { mode: 'EACH' } },
  },
];

for (const fixture of structuralCases) {
  test(`artifact schema parity: ${fixture.name}`, () => {
    assert.equal(validateArtifactSchema(fixture.artifact), fixture.valid, JSON.stringify(validateArtifactSchema.errors));
    const compilerResult = validate([fixture.artifact]);
    assert.equal(compilerResult.ok, fixture.valid);
  });
}

test('snapshot schema accepts versioned normative snapshot', () => {
  const artifacts = [{ id: 'codes', type: 'dictionary', description: 'codes', entries: ['A'] }];
  const snapshot = {
    format: 'jsonspecs-snapshot',
    formatVersion: 1,
    sourceHash: computeSourceHash(artifacts),
    engine: { minVersion: '2.0.0' },
    artifacts,
    meta: { projectId: 'demo', rulesetVersion: '1.0.0' },
  };
  assert.equal(validateSnapshotSchema(snapshot), true, JSON.stringify(validateSnapshotSchema.errors));
});
