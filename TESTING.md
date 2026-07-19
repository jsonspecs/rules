# Testing guide

## Current gates

Run before release:

```bash
npm test
npm run test:smoke
npm run test:pack
```

What they cover today:

- compiler phases and structured diagnostics;
- safe JSON boundary for artifacts and payloads;
- opaque prepared artifacts and introspection;
- runtime status/control contract;
- grouped wildcard `any_filled`;
- aggregate modes including `MIN`/`MAX`;
- trace modes, redaction, and redactor failure containment;
- snapshot hash and SemVer compatibility;
- JSON Schema parity fixtures;
- CommonJS and ESM packed-consumer smoke tests.

## Release publishing

The npm package trusts the GitHub Actions workflow `.github/workflows/release.yml`
from `catindev/jsonspecs` for `npm publish`. The release job runs on a GitHub-hosted
runner with `id-token: write`, uses npm 11.18.0, and does not use a long-lived npm
token. Trusted publishing generates provenance automatically.

Tagged releases are published under the `next` dist-tag. The separate promotion
workflow retains `NPM_TOKEN` because npm trusted publishing does not authorize
`npm dist-tag` operations.

## Recommended additions

### P1

- Compile-time diagnostic code test for dangerous path segments:
  - `field: "__proto__.x"`;
  - `value_field: "$context.constructor.x"`;
  - `fields[]` / `paths[]` in `any_filled`.
- TypeScript contract smoke that imports `index.d.ts` from the packed package and compiles sample CJS/ESM consumers.
- Executable README examples so public snippets cannot drift from the current `runPipeline(prepared, input, options)` API.
- JSON Schema parity fixtures for every artifact family and every aggregate mode.
- Operator contract tests for custom operators returning non-JSON-safe `actual`, `meta`, and `failures`.

### P2

- Property-style matrix for all built-in operators across absent/null/empty/string/number/date inputs.
- Snapshot compatibility fixtures for prerelease/build metadata edge cases.
- Introspection immutability tests for all `inspect()` collections.
- Trace event snapshot tests for nested condition/pipeline combinations.
