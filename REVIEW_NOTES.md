# @jsonspecs/rules 3.0.0 review notes

## Baseline

- Source repository: `jsonspecs/rules`
- Base commit: `107026b67131bcc874820968ae44a6f50aa2fd47`
- Target specification: `jsonspecs/spec` 1.0.0-rc.5
- Specification commit: `0dbd42533f46541c69dcb17eb52bd2fdae9e8a42`

The specification review found no blocking contradiction. Its repository gates and
all 267 fixtures pass. One residual coverage note is handled defensively in this
implementation: `any_filled.fields[]` rejects wildcard paths because aggregation is
defined only for the primary `field` operand.

## Architecture

- `src/json`: strict I-JSON boundary and RFC 8785 hashing.
- `src/regex`: normative grammar parser and RE2-WASM renderer.
- `src/operators`: unified built-in and external PASS/FAIL/SKIP contracts.
- `src/compiler`: envelope, local schemas, operator schemas, exact references,
  combined DAG and full closure as independent phases.
- `src/runtime`: tuple guards, flat projection, invocation, aggregation, issues,
  execution and result as independent phases.

Every implementation module starts with a Russian description of its responsibility;
comments inside the code explain ordering, portability and security invariants.

## Verification

- 15 package and hostile-JS regression tests, including immutable built-ins, cyclic
  host values, huge sparse arrays, shared references and a 10,000-pipeline graph.
- 267/267 normative conformance fixtures on Node.js 20, 22 and 24.
- README smoke, package-install smoke for CJS/ESM, and performance smoke pass.
- `npm ci` and full `prepublishOnly` pass from the lockfile.
- `npm audit --omit=dev`: 0 vulnerabilities.
- npm tarball: `jsonspecs-rules-3.0.0.tgz`, 42 files, about 88 KB compressed.

## Deliberate boundaries

- Only snapshot formatVersion 2 and specVersion 1.0.0-rc.5 are accepted.
- fv1 migration belongs to `@jsonspecs/cli`; v3 runtime contains no compatibility
  interpreter.
- External operator business equivalence remains the operator pack's contract and
  requires shared golden vectors across runtimes.
- Trace stays outside the normative result and is not reintroduced in this release.
