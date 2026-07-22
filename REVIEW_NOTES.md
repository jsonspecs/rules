# @jsonspecs/rules 4.0.0 review notes

## Baseline

- Source repository: `jsonspecs/rules`
- Base commit: `4b4d6fe42e9972e730648f71a6db49b733f201bf`
- Target specification: `jsonspecs/spec` 1.0.0-rc.7
- Specification commit: `f474b5924b55e20e61a8760f0ea752d630ccdf69`

RC.7 is an exact-index portability erratum over the immutable RC.6 release. It keeps
the DSL and operator boundary closed while requiring an authored decimal index to
survive compilation and concrete-path synthesis unchanged. All 309 normative fixtures
pass. `any_filled.fields[]` still rejects wildcard paths because aggregation is defined
only for the primary `field` operand.

## Architecture

- `src/json`: strict I-JSON boundary and RFC 8785 hashing.
- `src/regex`: normative grammar parser and RE2-WASM renderer.
- `src/operators`: unified built-in and external PASS/FAIL/SKIP contracts.
- `src/compiler`: envelope, local schemas, operator schemas, exact references,
  combined DAG and full closure as independent phases.
- `src/runtime`: tuple guards, exact flat projection, structural wildcard expansion,
  invocation, aggregation, issues, execution and result as independent phases.

Every implementation module starts with a Russian description of its responsibility;
comments inside the code explain ordering, portability and security invariants.

## Verification

- 24 package and hostile-JS regression tests include RC.6 rejection, structural absent
  paths, exact large-index preservation, immutable built-ins,
  self-throwing proxies, cyclic host values, huge sparse arrays, shared references
  and a 10,000-pipeline graph.
- 309/309 normative conformance fixtures on Node.js 20, 22 and 24.
- README smoke, package-install smoke for CJS/ESM, and performance smoke pass.
- `npm ci` and full `prepublishOnly` pass from the lockfile.
- `npm audit --omit=dev`: 0 vulnerabilities.
- The packed CommonJS and ESM consumer smoke test installs the real 4.0.0 tarball.

## Deliberate boundaries

- Only snapshot formatVersion 2 and specVersion 1.0.0-rc.7 are accepted; there is no
  RC.6 compatibility profile.
- fv1 migration belongs to `@jsonspecs/cli`; v4 runtime contains no compatibility
  interpreter.
- External operator business equivalence remains the operator pack's contract and
  requires shared golden vectors across runtimes.
- Trace stays outside the normative result and is not reintroduced in this release.
- The package links to the upstream behavior specification and ships implementation
  notes instead of a duplicated normative text.
