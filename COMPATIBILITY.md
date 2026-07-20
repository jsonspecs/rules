# Compatibility contract

The semver-stable public surface is exported from the package root: `createEngine`, `Operators`, `validate`, `compileSnapshot`, `inspect`, `computeSourceHash`, `formatDiagnostics`, `formatRuntimeError`, `deepGet`, `CompilationError`, and `RuntimeError`. Files under `src/**` are internal.

Prepared artifacts are opaque branded objects. Consumers must use `inspect()` and must not rely on compiler storage. Runtime results always contain `status`, `control`, and `issues`; `trace` is absent unless explicitly enabled. ABORT errors contain `{code,message,details}` and never expose a stack.

Stable runtime error codes include `INVALID_COMPILED_ARTIFACT`, `PIPELINE_ID_REQUIRED`, `PIPELINE_NOT_FOUND`, `INVALID_EVALUATION_INPUT`, payload safety codes, `OPERATOR_CONTRACT_VIOLATION`, `OPERATOR_FAULT`, `TRACE_REDACTOR_ERROR`, and the neutral fallback `RUNTIME_ABORT`.

Every trace entry has one shape: `{kind:"TRACE",artifactType:"jsonspecs",artifactId,step,at,outcome,details?}`. Stable `step` values are `pipeline.start`, `pipeline.finish`, `pipeline.abort`, `pipeline.strict`, `rule.start`, `rule.finish`, `condition.evaluate`, `predicate.aggregate`, `check.aggregate`, `context.required`, and `operator.trace`. Legacy `message/data/ts` fields are not emitted.

The normative snapshot shape is `{format:"jsonspecs-snapshot",formatVersion:1,sourceHash,engine:{minVersion},artifacts,meta?}`. `sourceHash` is SHA-256 over the canonicalized artifacts and is verified by `compileSnapshot()`. `engine.minVersion` is a complete SemVer 2.0.0 version and is compared to the running engine using full SemVer precedence, not only its major component.

## 2.3.0 minor behavior changes

- Successful `validate()` and `compile()` calls may include warning-level diagnostics. Warnings do not make validation fail and do not block compilation.
- `matches_regex` patterns are linted for common ReDoS-prone constructs at compile time. The diagnostic code is `REGEX_REDOS_RISK`, the level is `warning`, and the linter is heuristic: it highlights risk but does not prove linear-time regex safety.
- Source artifacts now have a deterministic maximum JSON depth. Inputs that exceed it fail source validation with `ARTIFACT_TOO_DEEP`.
- Runtime payload and context now have the same deterministic maximum JSON depth. Inputs that exceed it abort with `PAYLOAD_TOO_DEEP` instead of depending on the JavaScript stack limit.
- Payload size, issue-count size, and transport-result size limits remain caller responsibilities unless a future major or explicitly documented minor adds a public engine limit.

## 2.2.0 minor behavior changes

- Numeric string coercion is stricter: only documented decimal strings are numeric. Hex strings, whitespace-padded strings, `Infinity`, `NaN`, leading or trailing dot forms, and underscore-separated numbers now fail numeric comparisons instead of being accepted by JavaScript coercion.
- Operator-reported `EXCEPTION` now returns ABORT with `OPERATOR_FAULT`, a generic message, and `{operator, ruleId}` details. The original operator error message is no longer part of the transport-safe result.
- Runtime context is now validated and cloned with the same safe-json guarantees as payload. Cyclic context values, dangerous keys, non-finite numbers, non-plain values, arrays, and primitive context inputs now abort instead of being read as-is.
- Additive 2.2.0 extensions include strict type-assertion operators, the check-only `not_true` operator, and `condition.when` negation with `{not: ...}`.
- Operator packs follow normal JavaScript object composition: when consumers use object spread, the last property with a given operator name wins. Project-local operators may override built-ins by being spread after `Operators.check` or `Operators.predicate`.

Changing an exported name, accepted input shape, diagnostic/runtime code, result field, trace event, operator context, introspection model, or snapshot semantics is a breaking change.
