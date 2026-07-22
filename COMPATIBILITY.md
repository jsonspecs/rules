# Compatibility contract

`@jsonspecs/rules` 4.0.0 implements `jsonspecs/spec` 1.0.0-rc.6 and accepts only
snapshot `formatVersion: 2`. The normative behavior is the projection defined by
the [upstream specification](https://github.com/jsonspecs/spec/blob/d75024047437ce0119a28c6ceda818eb79c4f302/SPEC.md).
The vendored 308-fixture suite is pinned to spec commit
`d75024047437ce0119a28c6ceda818eb79c4f302` and is compared byte for byte with a
checkout of that commit before execution.

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
schema handling, result fields, accepted snapshot set, or any normative specification
behavior is a breaking change.

Version 4 has no RC.5 compatibility profile. A snapshot declaring
`specVersion: "1.0.0-rc.5"` is rejected with `UNSUPPORTED_SPEC_VERSION`; consumers
must rebuild the snapshot with RC.6 and recompute `sourceHash`.
