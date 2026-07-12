# Compatibility contract

The semver-stable public surface is exported from the package root: `createEngine`, `Operators`, `validate`, `compileSnapshot`, `inspect`, `computeSourceHash`, `formatDiagnostics`, `formatRuntimeError`, `deepGet`, `CompilationError`, and `RuntimeError`. Files under `src/**` are internal.

Prepared artifacts are opaque branded objects. Consumers must use `inspect()` and must not rely on compiler storage. Runtime results always contain `status`, `control`, and `issues`; `trace` is absent unless explicitly enabled. ABORT errors contain `{code,message,details}` and never expose a stack.

The normative snapshot shape is `{format:"jsonspecs-snapshot",formatVersion:1,sourceHash,engine:{minVersion},artifacts,meta?}`. `sourceHash` is SHA-256 over the canonicalized artifacts and is verified by `compileSnapshot()`.

Changing an exported name, accepted input shape, diagnostic/runtime code, result field, trace event, operator context, introspection model, or snapshot semantics is a breaking change.
