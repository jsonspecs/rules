# Compatibility contract

The semver-stable public surface is exported from the package root: `createEngine`, `Operators`, `validate`, `compileSnapshot`, `inspect`, `computeSourceHash`, `formatDiagnostics`, `formatRuntimeError`, `deepGet`, `CompilationError`, and `RuntimeError`. Files under `src/**` are internal.

Prepared artifacts are opaque branded objects. Consumers must use `inspect()` and must not rely on compiler storage. Runtime results always contain `status`, `control`, and `issues`; `trace` is absent unless explicitly enabled. ABORT errors contain `{code,message,details}` and never expose a stack.

Stable runtime error codes include `INVALID_COMPILED_ARTIFACT`, `PIPELINE_ID_REQUIRED`, `PIPELINE_NOT_FOUND`, `INVALID_EVALUATION_INPUT`, payload safety codes, `OPERATOR_CONTRACT_VIOLATION`, `TRACE_REDACTOR_ERROR`, and the neutral fallback `RUNTIME_ABORT`.

Every trace entry has one shape: `{kind:"TRACE",artifactType:"jsonspecs",artifactId,step,at,outcome,details?}`. Stable `step` values are `pipeline.start`, `pipeline.finish`, `pipeline.abort`, `pipeline.strict`, `rule.start`, `rule.finish`, `condition.evaluate`, `predicate.aggregate`, `check.aggregate`, `context.required`, and `operator.trace`. Legacy `message/data/ts` fields are not emitted.

The normative snapshot shape is `{format:"jsonspecs-snapshot",formatVersion:1,sourceHash,engine:{minVersion},artifacts,meta?}`. `sourceHash` is SHA-256 over the canonicalized artifacts and is verified by `compileSnapshot()`. `engine.minVersion` is a complete SemVer 2.0.0 version and is compared to the running engine using full SemVer precedence, not only its major component.

Changing an exported name, accepted input shape, diagnostic/runtime code, result field, trace event, operator context, introspection model, or snapshot semantics is a breaking change.
