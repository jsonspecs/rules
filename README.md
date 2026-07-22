# @jsonspecs/rules

Deterministic JSON rules runtime for Node.js. Version 3 implements the executable
contract of `jsonspecs/spec` **1.0.0-rc.5** and runs its 267 normative fixtures.

The engine validates a closed snapshot once, verifies its JCS `sourceHash`, binds
built-in and external operators, and returns a deterministic result with ordered
business issues and ruleset provenance.

## Install

```bash
npm install @jsonspecs/rules
```

Node.js 20 or newer is required. Regular expressions execute through RE2 compiled
to WebAssembly (`re2-wasm`), so accepted patterns do not block the event loop with
catastrophic backtracking and package installation does not require a native build
toolchain.

## Basic use

```js
const {
  compileSnapshot,
  computeSourceHash,
  runPipeline,
} = require("@jsonspecs/rules");

const snapshot = {
  format: "jsonspecs-snapshot",
  formatVersion: 2,
  specVersion: "1.0.0-rc.5",
  exports: ["customer.validate"],
  artifacts: {
    "customer.validate": {
      type: "pipeline",
      steps: ["customer.name.required"],
    },
    "customer.name.required": {
      type: "rule",
      operator: "not_empty",
      field: "customer.name",
      issue: {
        level: "ERROR",
        code: "CUSTOMER.NAME.REQUIRED",
        message: "Customer name is required",
      },
    },
  },
};

snapshot.sourceHash = computeSourceHash(snapshot);
const prepared = compileSnapshot(snapshot);
const result = runPipeline(prepared, {
  pipelineId: "customer.validate",
  payload: { customer: { name: "" } },
  context: {},
});
```

`pipelineId` is always explicit. `payload` and `context` are nested JSON objects;
pre-flattened payloads and `payload.__context` are not part of the contract.

## External operators

An operator package exports a map from immutable names to `{ schema, evaluate }`.
The schema is a closed JSON Schema draft-07 contract for operator-specific rule
configuration. The engine resolves paths and passes values only; an operator never
receives the payload, context, a resolver, or the use site.

```js
const { createEngine } = require("@jsonspecs/rules");

const engine = createEngine({
  operators: {
    "credit.age_at_least": {
      schema: {
        type: "object",
        properties: {
          inputs: {
            type: "object",
            properties: { age: { type: "string", minLength: 1 } },
            required: ["age"],
            additionalProperties: false,
          },
          params: {
            type: "object",
            properties: { minimum: { type: "integer", minimum: 0 } },
            required: ["minimum"],
            additionalProperties: false,
          },
        },
        required: ["inputs", "params"],
        additionalProperties: false,
      },
      evaluate({ inputs, params }) {
        if (!("age" in inputs)) return "SKIP";
        return Number.isInteger(inputs.age) && inputs.age >= params.minimum ? "PASS" : "FAIL";
      },
    },
  },
});
```

`evaluate` returns exactly `PASS`, `FAIL`, or `SKIP`. A thrown value becomes
`ABORT OPERATOR_FAULT`; any other return value becomes
`ABORT OPERATOR_CONTRACT_VIOLATION`. Built-in names are reserved and cannot be
overridden.

## Public API

- `createEngine({ operators? })`
- `builtInOperators` — deeply immutable built-in definitions and schemas
- `CompilationError` for rejected snapshots
- `compileSnapshot(snapshot)` / `engine.compileSnapshot(snapshot)`
- `compileSnapshotText(text)` for strict I-JSON parsing with duplicate-key checks
- `validate(snapshot)`
- `runPipeline(prepared, { pipelineId, payload, context? })`
- `inspect(prepared)`
- `computeSourceHash(snapshot)`
- `formatDiagnostics()` and `formatRuntimeError()`

`compileSnapshot` accepts only formatVersion 2. Source artifacts, folders, imports,
descriptions and authoring metadata are builder/CLI concerns.

## Banking use

The runtime is suitable for deterministic validation and business-rule decisions in
credit workflows and payment gateways: required data, eligibility, consistency,
limits expressed by operators, routing conditions, sanctions flags, and ordered
business diagnostics. Amount arithmetic and domain calculations belong in dedicated
decimal/operator packages; this module orchestrates their boolean outcomes and audit
facts. Services remain responsible for transport byte limits, authentication,
authorization, snapshot delivery, and deployment provenance of external operator
packs.

See [SPEC.md](SPEC.md), [OPERATORS.md](OPERATORS.md),
[MIGRATION_V3.md](MIGRATION_V3.md), and [TESTING.md](TESTING.md).
