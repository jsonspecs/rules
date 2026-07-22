# Testing

```bash
npm test                  # package API tests
npm run test:conformance  # all 267 jsonspecs/spec RC.5 fixtures
npm run test:smoke        # executable README flow
npm run test:perf         # broad compile/runtime budgets
npm run test:pack         # install the actual npm tarball through CJS and ESM
```

`tests/conformance/spec-commit.txt` pins the exact specification commit. Updating
the fixture tree and this pin is one reviewed change; hand-editing expected results
inside this repository is forbidden. The specification text remains the arbiter if
an implementation and a fixture disagree.

Before publishing, `prepublishOnly` runs unit, conformance, package, and performance
checks. CI should additionally run `npm audit --omit=dev`, `npm pack --dry-run`, and
verify a clean worktree after all generated checks.
