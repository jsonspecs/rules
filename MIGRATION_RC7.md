# Migration from RC.6 to Rules 4.0.0 / RC.7

Rules 4.0.0 accepts only `jsonspecs/spec` 1.0.0-rc.7. There is no compatibility
profile or automatic version substitution for RC.6.

1. Change the snapshot `specVersion` to `"1.0.0-rc.7"`.
2. Rebuild the complete snapshot and recompute `sourceHash`.
3. Run the full 309-fixture RC.7 conformance suite.

An RC.6 snapshot is rejected with `UNSUPPORTED_SPEC_VERSION`, even if the executable
artifact graph did not otherwise change.

RC.7 closes the portability gap for exact index tokens. The engine retains their
authored decimal spelling for synthesized wildcard issue paths and does not use an
unsafe JavaScript number to address an array. No operator, DSL field, snapshot field,
result field, or `formatVersion` was added.

The complete behavior is defined by the pinned
[RC.7 specification](https://github.com/jsonspecs/spec/blob/f474b5924b55e20e61a8760f0ea752d630ccdf69/SPEC.md)
and its [migration guide](https://github.com/jsonspecs/spec/blob/f474b5924b55e20e61a8760f0ea752d630ccdf69/MIGRATION_RC7.md).
