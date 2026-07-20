# JSONSpecs

[![CI](https://github.com/catindev/jsonspecs/actions/workflows/ci.yml/badge.svg)](https://github.com/catindev/jsonspecs/actions)
[![npm](https://img.shields.io/npm/v/jsonspecs)](https://www.npmjs.com/package/jsonspecs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)

Declarative validation engine for JSON rules and deterministic validation pipelines.

Rules are plain JSON artifacts. JSONSpecs validates and prepares them once, runs a named pipeline against a JSON payload, and returns a transport-safe result with stable statuses, issues, diagnostics, optional trace, and ruleset provenance. The package has no runtime dependencies.

```bash
npm install jsonspecs
```

Both CommonJS and ESM consumers are supported:

```js
const { createEngine, Operators } = require("jsonspecs");
```

```js
import { createEngine, Operators } from "jsonspecs";
```

## Concepts

| Artifact | Purpose |
| --- | --- |
| `rule` | Atomic check or predicate backed by one operator. |
| `condition` | Predicate guard plus steps that run only when the guard is true. |
| `pipeline` | Ordered scenario composed from rules, conditions, and sub-pipelines. |
| `dictionary` | Static value list used by `in_dictionary`. |

The usual production flow is:

1. author JSON artifacts;
2. validate them and fix diagnostics;
3. prepare or build a deterministic snapshot;
4. evaluate the prepared artifact with `{ pipelineId, payload, context }`.

`jsonspecs` is loader-agnostic. Filesystem loading, project manifests, Studio UI, and snapshot builds are provided by [`jsonspecs-cli`](https://www.npmjs.com/package/jsonspecs-cli), not by the core engine.

## Quick start

```js
const { createEngine, Operators, formatDiagnostics } = require("jsonspecs");

const artifacts = [
  {
    id: "library.person.first_name_required",
    type: "rule",
    description: "First name must be filled",
    role: "check",
    operator: "not_empty",
    level: "ERROR",
    code: "PERSON.FIRST_NAME.REQUIRED",
    message: "First name is required",
    field: "person.firstName",
  },
  {
    id: "registration.pipeline",
    type: "pipeline",
    description: "Person registration validation",
    entrypoint: true,
    strict: false,
    required_context: ["currentDate"],
    flow: [{ rule: "library.person.first_name_required" }],
  },
];

const engine = createEngine({ operators: Operators });

const validation = engine.validate(artifacts);
if (!validation.ok) {
  throw new Error(formatDiagnostics(validation.diagnostics));
}

const prepared = engine.compile(artifacts);

const result = engine.runPipeline(prepared, {
  pipelineId: "registration.pipeline",
  payload: {
    person: { firstName: "Ivan" },
  },
  context: {
    currentDate: "2026-03-27",
  },
});

// {
//   status: "OK",
//   control: "CONTINUE",
//   issues: [],
//   ruleset: { sourceHash: "..." }
// }
```

If exactly one pipeline has `entrypoint: true`, `pipelineId` may be omitted. The older signature `runPipeline(prepared, pipelineId, payload, options)` remains available for compatibility, but new code should use the object input form.

## Public API

Everything exported from the package root is the supported public surface. Files under `src/**` are internal.

| Export | Description |
| --- | --- |
| `createEngine({ operators })` | Creates an engine bound to an operator pack. |
| `Operators` | Built-in check and predicate operators. |
| `validate(artifacts, options?)` | Non-throwing source validation using the built-in operators unless `options.operators` is provided. |
| `compileSnapshot(snapshot, options?)` | Validates snapshot integrity and prepares it for runtime. |
| `inspect(prepared)` | Read-only introspection over a prepared artifact. |
| `computeSourceHash(artifacts)` | Canonical SHA-256 over artifacts. |
| `formatDiagnostics(diagnostics)` | Compact human-readable diagnostics formatter. |
| `formatRuntimeError(error)` | Compact runtime error formatter. |
| `deepGet(payload, path)` | Backward-compatible field lookup helper. New operators should prefer `ctx.get()`. |
| `CompilationError` / `RuntimeError` | Typed errors for compile-time and internal runtime failures. |

### `engine.validate(artifacts, options?)`

Returns `{ ok, diagnostics }` and never throws for ordinary source errors. Successful validation may still return warning-level diagnostics; warnings do not make `ok` false.

Diagnostics are structured:

```js
{
  code: "ARTIFACT_REF_NOT_FOUND",
  level: "error",
  message: "Reference not found: library.person.email",
  phase: "reference_validation",
  artifactId: "registration.pipeline",
  path: "flow[1].rule",
  location: "/rules/registration.pipeline.json"
}
```

Compiler phases are intentionally phase-fail-fast for errors: a failed phase returns all error diagnostics from that phase and later dependent phases are not executed. Warning diagnostics are non-blocking.

### `engine.compile(artifacts, options?)`

Returns an opaque prepared artifact:

```js
{
  kind: "prepared-jsonspecs",
  artifactType: "jsonspecs",
  version: "1",
  sourceHash: "...",
  diagnostics: []
}
```

Runtime internals are stored outside the public object. Use `inspect(prepared)` instead of reading private compiler structures.

`options.sources` may be a `Map<artifactId, string | { file, line?, column? }>` and is used to populate diagnostic locations.

### `engine.compileSnapshot(snapshot, options?)`

Snapshots are deterministic production artifacts:

```js
{
  "format": "jsonspecs-snapshot",
  "formatVersion": 1,
  "sourceHash": "...",
  "engine": { "minVersion": "2.1.1" },
  "artifacts": [],
  "meta": {
    "projectId": "checkout-rules",
    "projectTitle": "Checkout rules",
    "description": "Checkout validation",
    "rulesetVersion": "1.0.0"
  }
}
```

`compileSnapshot()` verifies snapshot shape, SemVer engine compatibility, and `sourceHash`. Runtime results created from a snapshot carry `ruleset.sourceHash`, `ruleset.projectId`, and `ruleset.rulesetVersion`.

### `engine.runPipeline(prepared, input, options?)`

```js
const result = engine.runPipeline(prepared, {
  pipelineId: "registration.pipeline",
  payload: { person: { firstName: "" } },
  context: { currentDate: "2026-03-27" },
}, {
  trace: "basic",
});
```

`input.payload` must be a JSON object. It may be nested or already flattened with dot-notation keys. `input.context` is exposed to rules as `$context.*`.

Runtime result:

```js
{
  status: "OK" | "OK_WITH_WARNINGS" | "ERROR" | "EXCEPTION" | "ABORT",
  control: "CONTINUE" | "STOP",
  issues: [],
  ruleset: {
    sourceHash: "...",
    projectId: "checkout-rules",
    rulesetVersion: "1.0.0"
  },
  trace: [] // present only when trace is enabled
}
```

Issue shape:

```js
{
  kind: "ISSUE",
  level: "ERROR",
  code: "PERSON.FIRST_NAME.REQUIRED",
  message: "First name is required",
  field: "person.firstName",
  ruleId: "library.person.first_name_required",
  pipelineId: "registration.pipeline",
  stepId: "optional-step-id",
  expected: "...",
  actual: "",
  meta: {}
}
```

`ABORT` is not a validation result. It means the runtime boundary caught a payload, operator, trace redactor, or engine fault. It always returns `control: "STOP"` and a transport-safe error:

```js
{
  status: "ABORT",
  control: "STOP",
  issues: [],
  error: {
    code: "DANGEROUS_PAYLOAD_KEY",
    message: "Dangerous key at __proto__",
    details: { "path": "__proto__" }
  }
}
```

Stacks are not exposed in runtime results.

### `inspect(prepared)`

Use introspection to build UIs, docs, debug views, or APIs:

```js
const view = engine.inspect(prepared);

view.listEntrypoints();
view.listArtifacts({ type: "rule" });
view.getArtifact("library.person.first_name_required");
view.getPipelineSteps("registration.pipeline");
view.getConditionModel("library.person.has_document");
view.listDictionaries();
view.stats();
```

## Trace

Trace is disabled by default and absent from the result unless enabled.

| Option | Behaviour |
| --- | --- |
| `false` / omitted | No `trace` field. |
| `true` / `"basic"` | Structural trace without raw payload values. |
| `"verbose"` | Trace may include detailed values after `traceRedactor` is applied. |

Every trace entry has one shape:

```js
{
  kind: "TRACE",
  artifactType: "jsonspecs",
  artifactId: "registration.pipeline",
  step: "pipeline.start",
  outcome: "start",
  at: "2026-07-12T10:00:00.000Z",
  details: {}
}
```

## Safety guarantees

The engine treats artifacts, payloads, and context objects as untrusted JSON at the technical boundary:

- dangerous keys `__proto__`, `prototype`, and `constructor` are rejected;
- prototype-chain reads are avoided;
- cyclic artifacts, payloads, and context objects are rejected;
- unsupported JSON values are rejected or normalized at the runtime boundary;
- artifacts, payloads, and context objects have a deterministic JSON depth limit;
- `matches_regex` patterns are linted for common ReDoS risks at compile time as warning diagnostics;
- prepared artifacts are opaque and immutable from the public API;
- runtime results are safe to `JSON.stringify()` and round-trip through JSON.

Regex linting is a heuristic guardrail, not a linear-time guarantee. Rule artifacts and custom operators are trusted author inputs; runtime payload and context are untrusted inputs. Callers remain responsible for message-size, issue-count, and transport-result limits at their boundary.

## JSON Schema

The package exports JSON Schema 2020-12 documents:

```js
const artifactSchema = require("jsonspecs/schema");
const snapshotSchema = require("jsonspecs/schema/snapshot");
```

JSON Schema covers structural validation. Cross-artifact references, operator existence, visibility, uniqueness, aggregate semantics, and pipeline cycles are validated by `validate()` / `compile()`.

## Artifact rules

Artifact IDs control visibility:

- `library.*` artifacts are globally visible;
- pipeline-local artifacts are visible through their dotted scope;
- pipelines can call other pipelines by full id;
- dictionaries are globally addressable by id.

Result levels:

| Level | Meaning | Pipeline behaviour |
| --- | --- | --- |
| `WARNING` | Soft issue. | Accumulated; does not stop execution. |
| `ERROR` | Validation failure. | Accumulated; final `control` is `STOP`. |
| `EXCEPTION` | Hard block. | Stops execution immediately. |

Built-in operators and custom operator authoring are documented in [OPERATORS.md](./OPERATORS.md). The normative artifact format is documented in [SPEC.md](./SPEC.md), and public compatibility rules are documented in [COMPATIBILITY.md](./COMPATIBILITY.md).

## Custom operators

Custom operators receive `(rule, ctx)`. New operators should use the stable context helpers:

```js
function amount_gt_zero(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL", actual: undefined };

  const value = Number(got.value);
  return {
    status: Number.isFinite(value) && value > 0 ? "OK" : "FAIL",
    actual: got.value,
  };
}
```

Register custom operators by extending the built-in pack:

```js
const engine = createEngine({
  operators: {
    check: { ...Operators.check, amount_gt_zero },
    predicate: { ...Operators.predicate },
  },
});
```

Operator packs are ordinary JavaScript objects. If multiple spreads define the
same operator name, the last property wins; project-local operators may
intentionally override built-ins by placing them after `...Operators.check` or
`...Operators.predicate`.

## Tests

```bash
npm test
npm run test:smoke
npm run test:pack
npm run test:perf
```

`test:pack` installs the packed package into clean CommonJS and ESM consumers and verifies the published artifact shape.
`test:perf` is a smoke gate for large flat payloads, wildcard scans, issue growth, and synthetic large rulesets.

Current coverage and recommended additions are tracked in [TESTING.md](./TESTING.md).
