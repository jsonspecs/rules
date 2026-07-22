# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [4.0.1] - 2026-07-22

- Correct the historical RC.6 migration guides: no RC.6-compatible npm package was
  published, and the RC.6 implementation is available only at repository revision
  `193a4a2`.

## [4.0.0] - 2026-07-22

- Implement `jsonspecs/spec` 1.0.0-rc.7 and accept only RC.7 snapshots.
- Replace flat-leaf wildcard matching with structural candidate expansion over real
  nested payload arrays.
- Preserve absent concrete paths after the final wildcard so presence rules can report
  fields such as `items[1].sku` without an `actual` value.
- Keep absence before a later wildcard branchless, terminal non-empty containers
  unavailable to operators, and exact `$context` paths separate from wildcard fields.
- Pre-parse wildcard paths into immutable tokens during compilation and execute their
  numeric odometer traversal in a dedicated runtime module.
- Preserve the exact decimal spelling of exact index tokens in synthesized wildcard
  issue paths, including indices outside the binary64 safe-integer range.
- Preserve exhaustive ALL/ANY/COUNT evaluation, all-`SKIP` behavior, `onEmpty`, and
  aggregate counters over the RC.7 structural population.
- Reject RC.6 and older snapshots with `UNSUPPORTED_SPEC_VERSION` and provide an
  RC.7 migration guide without a compatibility profile.
- Vendor and pass all 309 normative conformance fixtures from spec commit
  `f474b5924b55e20e61a8760f0ea752d630ccdf69`.

## [3.0.0] - 2026-07-22

- Implement `jsonspecs/spec` 1.0.0-rc.5 and snapshot formatVersion 2.
- Unify check/predicate operators into PASS/FAIL/SKIP and add closed JSON Schema
  contracts for external operators.
- Replace fv1 source arrays, scopes and entrypoints with opaque artifact maps,
  exact references, explicit exports, full closure and a combined DAG.
- Add strict I-JSON parsing, binary64 guards, JCS whole-snapshot hashing and the
  closed normative result contract.
- Execute the portable regex language through `re2-wasm`.
- Deep-freeze exported built-in operator definitions and their nested schemas.
- Reject cyclic host values and huge sparse arrays without blocking evaluation.
- Replace recursive control-flow traversal and execution with explicit stacks so valid
  deep graphs do not depend on the Node.js call-stack limit.
- Contain self-throwing `Proxy` values through private `WeakSet` abort markers and
  preserve `INVALID_PAYLOAD` versus `INVALID_CONTEXT` classification.
- Enforce portable regex expansion limits and finite external-operator contracts.
- Render an empty complemented character class as a valid never-matching RE2
  expression instead of rejecting the snapshot.
- Validate and index dictionaries in linear time for constant-time built-in lookup.
- Vendor and pass all 281 normative conformance fixtures from spec commit
  `853ecaaeaf0e775c2bb69cf3d46dae076e689f54`; CI verifies the source tree before
  running it and compares results through the JSON data model.
- Remove legacy `role`, `strict`, `control`, trace-in-result, `payload.__context`,
  `required_context`, object steps and formatVersion 1 compilation.

## [2.4.0] - 2026-07-21

- Renamed the primary npm package to `@jsonspecs/rules`.
- Added a `jsonspecs` compatibility package that re-exports `@jsonspecs/rules`.
- Updated package smoke tests to verify both scoped and compatibility package imports.

## [2.3.4] - 2026-07-20

- Updated package metadata, badges, and trusted publishing documentation for the `jsonspecs/rules` repository rename.

## [2.3.3] - 2026-07-20

- Updated package metadata and documentation links for the GitHub repository transfer.
- Prepared trusted publishing metadata for the new GitHub owner/repository identity.

## [2.3.2] - 2026-07-20

- Hardened runtime abort serialization so hostile thrown objects, including self-throwing `Proxy` values, cannot escape `runPipeline()`.
- Contained trace-redactor error inspection when the thrown value is not safely inspectable.

## [2.3.1] - 2026-07-20

- Publish future tagged releases directly under `latest`, removing the obsolete token-based promotion workflow.
- Hardened transport normalization with the `"[MaxDepth]"` marker for over-deep values.
- Added full depth validation for public custom-operator result surfaces.
- Truncated operator trace details without changing evaluation verdicts.
- Narrowed the `matches_regex` nested-quantifier heuristic to unbounded outer repetition.
- Sanitized `OPERATOR_CONTRACT_VIOLATION` details so invalid operator results expose only status metadata.
- Extended the never-throws runtime boundary to envelope and options parsing.
- Applied the unbounded outer repetition gate to every current `matches_regex` ReDoS heuristic.

## [2.3.0] - 2026-07-20

- Added warning-level compile diagnostics for potentially dangerous `matches_regex` patterns, including nested quantified groups and overlapping quantified alternations.
- Added deterministic JSON depth limits for artifacts, payload, and context. Over-deep runtime input now aborts with `PAYLOAD_TOO_DEEP`; over-deep source artifacts fail validation with `ARTIFACT_TOO_DEEP`.
- Successful `validate()` and `compile()` calls can now expose non-blocking warning diagnostics.
- Documented the threat model for trusted rule artifacts versus untrusted runtime payload and context.
- Added `npm run test:perf` as a smoke gate for large flat payloads, wildcard scans, issue growth, and synthetic large rulesets.

## [2.2.0] - 2026-07-19

- Runtime results now include `ruleset.engineVersion` alongside `sourceHash`.
- Operator `EXCEPTION` results now abort with `OPERATOR_FAULT` and sanitized `{operator, ruleId}` details.
- Multi-field operator issues now serialize `field: null` when no concrete field exists.
- Numeric string coercion now accepts only decimal strings matching the documented grammar and rejects hex, whitespace-padded, `Infinity`, `NaN`, dotted-edge, and underscore forms.
- `matches_regex.flags` is now limited at compile time and in the exported schema to `i`, `m`, and `s` without repeats.
- `in_dictionary` now matches string, number, and boolean scalar entries by strict equality; `null` dictionary entries now fail validation.
- Runtime issues now always include `pipelineId` for the immediate enclosing pipeline.
- Runtime context is now JSON-safe cloned and validated like payload, so cycles, dangerous keys, non-finite numbers, and non-plain values in context abort before evaluation.
- Added strict type-assertion operators `is_boolean`, `is_string`, `is_number`, and `is_integer` in check and predicate roles.
- Added the check-only `not_true` operator for absence-tolerant negative flag checks.
- Added the `{ "not": <expr> }` form for recursive `condition.when` expressions.
- Documentation now matches runtime behavior for dictionary entry matching, `any_filled.paths`, regex backslash normalization, date comparison failures, public ruleset provenance, and operator fault semantics.

## [2.1.2] - 2026-07-19

- Reject calendar-impossible `YYYY-MM-DD` values instead of silently normalizing them during date comparisons.
- Make wildcard group ordering independent of the host locale.
- Publish tagged releases from GitHub Actions through npm trusted publishing with OIDC.

## [2.1.1] - 2026-07-12

- Refreshed README, Russian README, specification, operators reference, compatibility notes, and package metadata for the v2.1 public contract.
- Added a testing guide covering current gates and recommended follow-up coverage.

## [2.1.0] - 2026-07-12

- Added ruleset provenance to runtime results, including snapshot ruleset versions.
- Exported JSON Schema 2020-12 documents for artifacts and snapshots.

## [2.0.0] - 2026-07-12

- Added structured diagnostics, non-throwing validation, opaque prepared artifacts, introspection, deterministic snapshots, and coded runtime errors.
- Hardened artifact and payload processing against cycles, dangerous keys, prototype-chain reads, conflicting paths, and invalid operator results.
- Runtime results are transport-safe, always include `control`, never expose stacks, and omit trace by default.
- Added grouped `any_filled`, full aggregate validation, entrypoint inference, and recursive pipeline/condition cycle analysis.
- Compiler phases now emit diagnostic codes, artifact ids, property paths, and source locations directly instead of deriving them from message text.
- Snapshot compatibility now validates complete SemVer 2.0.0 versions and compares major, minor, patch, and prerelease precedence.
- Fixed wildcard `any_filled` group discovery for groups whose listed fields are all absent, including nested groups and `ALL` summaries.
- Unified every trace event under the structural contract, balanced predicate boundaries, and contained throwing trace redactors.
- Added verified CommonJS and ESM packed-consumer smoke tests.

## [1.1.0] - 2026-03-29

### Added

- Official runtime operator context helpers: `ctx.get(path)` and `ctx.has(path)`.
- Public type definitions for the richer operator context, including `getDictionary()` and `payloadKeys`.
- Regression test covering custom operators that use `ctx.get()` or `ctx.has()` without importing `deepGet`.

### Changed

- Built-in check and predicate operators now use `ctx.get()` internally instead of calling `deepGet(ctx.payload, ...)` directly.
- Documentation now recommends `ctx.get()` / `ctx.has()` as the preferred contract for new custom operators.

### Compatibility

- `deepGet()` remains exported and supported for backward compatibility and advanced use cases.

Format: [Semantic Versioning](https://semver.org/)

## [1.0.1] — 2026-03-29

### Fixed

- `compile()` now deep-clones and deep-freezes source artifacts before building the compiled bundle. Mutating the original artifact objects after compilation no longer changes runtime behavior.
- `runPipeline()` now applies `strict: true` semantics at the top-level pipeline boundary, not only for nested pipeline steps.

### Tests

- Added contract tests for top-level strict escalation.
- Added contract tests proving compiled bundles are detached from source artifacts.

## [1.0.0] — 2026

### Initial release

**Core engine**

- `createEngine({ operators })` — creates engine instance bound to operator pack
- `engine.compile(artifacts, options?)` — compiles artifact array, returns `compiled` object
- `engine.runPipeline(compiled, pipelineId, payload)` — runs a named entrypoint pipeline

**Compiler (7 phases)**

- Phase 1: artifact registry with duplicate detection
- Phase 2: schema validation per artifact type
- Phase 3: error code uniqueness across check rules
- Phase 4: cross-artifact reference validation
- Phase 5–6: compile-time normalization of conditions and pipelines
- Phase 7: DAG validation (cycle detection)

**Runtime**

- Accumulates all issues in a single pass (does not stop on ERROR)
- EXCEPTION level stops the pipeline immediately
- Strict pipeline groups escalate to EXCEPTION if any check fails
- `OK_WITH_WARNINGS` status for passes with WARNING-level issues
- Full execution trace always included in result
- Accepts both flat (`{ "a.b": 1 }`) and nested (`{ a: { b: 1 } }`) payloads
- Wildcard field patterns (`items[*].qty`)
- `$context.*` field references for runtime context injection

**Built-in operators**

- 17 check operators: `not_empty`, `is_empty`, `equals`, `not_equals`, `contains`,
  `matches_regex`, `in_dictionary`, `greater_than`, `less_than`, `length_equals`,
  `length_max`, `any_filled`, `field_equals_field`, `field_not_equals_field`,
  `field_less_than_field`, `field_greater_than_field`, `field_less_or_equal_than_field`,
  `field_greater_or_equal_than_field`
- 13 predicate operators (same names, predicate semantics)

**Fixed in 1.0.0**

- `matches_regex`: invalid regex pattern now caught at compile time with `CompilationError`
- `matches_regex`: added optional `flags` field (e.g. `"flags": "i"` for case-insensitive)
- `runPipeline`: added optional `{ trace: false }` option to suppress trace collection
- `ABORT` result status documented as part of the public result contract
