# Testing

```bash
npm test                  # package API tests
npm run test:conformance  # source check and all 308 jsonspecs/spec RC.6 fixtures
npm run test:smoke        # executable README flow
npm run test:perf         # broad compile/runtime budgets
npm run test:pack         # install the actual npm tarball through CJS and ESM
```

`tests/conformance/spec-commit.txt` pins the exact specification commit. The command
requires a checkout at that commit in `.conformance-spec` or `../spec`, then compares
the complete fixture tree byte for byte before executing it. Updating the fixture tree
and this pin is one reviewed change; hand-editing expected results inside this
repository is forbidden. The upstream specification text remains the arbiter if an
implementation and a fixture disagree.

The package test suite separately verifies that an otherwise valid RC.5 snapshot is
rejected with `UNSUPPORTED_SPEC_VERSION`; RC.5 fixtures are not part of the normative
RC.6 corpus.

Before publishing, `prepublishOnly` runs unit, conformance, package, and performance
checks. CI should additionally run `npm audit --omit=dev`, `npm pack --dry-run`, and
verify a clean worktree after all generated checks.
