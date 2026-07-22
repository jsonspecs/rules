# Compatibility contract

`@jsonspecs/rules` 3.0.0 implements `jsonspecs/spec` 1.0.0-rc.5 and accepts only
snapshot `formatVersion: 2`. The normative behavior is the projection defined by
the bundled `SPEC.md`; the vendored 267-fixture suite is pinned to spec commit
`0dbd42533f46541c69dcb17eb52bd2fdae9e8a42`.

The semver-stable package-root API is `createEngine`, `builtInOperators`,
`CompilationError`, `compileSnapshot`, `compileSnapshotText`, `validate`,
`runPipeline`, `inspect`, `computeSourceHash`, `formatDiagnostics`, and
`formatRuntimeError`. Files under `src/**` are internal.

Prepared snapshots are opaque immutable objects. Runtime results contain only the
closed specification fields: `status`, `issues`, `ruleset`, and `error` on ABORT.
Tracing and implementation version reporting, if added later, must use a separate
non-normative API.

`builtInOperators` is inspection-only and deeply immutable. Its exported schemas cannot
be changed to alter validation performed by engines created later in the same process.

External operators use the synchronous `{schema,evaluate}` boundary documented in
`OPERATORS.md`. Changing invocation presence semantics, the outcome enum, operator
schema handling, result fields, accepted snapshot set, or any normative SPEC behavior
is a breaking change.
