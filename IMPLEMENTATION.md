# Engine implementation

This document describes the Node.js implementation in `@jsonspecs/rules`. It is
not a copy of the behavioral contract and does not redefine it.

Normative behavior is defined by
[`jsonspecs/spec` 1.0.0-rc.7](https://github.com/jsonspecs/spec/blob/f474b5924b55e20e61a8760f0ea752d630ccdf69/SPEC.md).
The exact source commit used by the test suite is stored in
`tests/conformance/spec-commit.txt`.

## Compilation

`createEngine()` builds an immutable registry from the built-in definitions and
the supplied external operators. Operator JSON Schemas are compiled once with
Ajv. Contracts must enumerate the accepted configuration, `inputs`, and immediate
`params` names and must close each of those object levels.

`compileSnapshot()` then runs these phases:

1. clone and validate the I-JSON snapshot envelope;
2. verify the JCS `sourceHash`;
3. validate artifact shapes and operator contracts;
4. parse portable regular expressions and enforce their compilation budgets;
5. build dictionary membership indexes;
6. pre-parse wildcard paths into immutable key/index/wildcard tokens while retaining
   the exact decimal spelling of every index;
7. validate exact references, the combined control-flow graph, and closure;
8. reject unresolved operator names only after independent defects are excluded.

The prepared result exposes only its format and ruleset identity. Executable state,
operator functions, indexes, and artifacts remain in a private `WeakMap`.

## Evaluation

`runPipeline()` validates `pipelineId`, `payload`, and `context` before executing a
step. Host objects are checked iteratively for invalid containers, cycles, sparse
arrays, unsafe keys, non-finite numbers, and depth. Payload and context are cloned
and frozen before path resolution.

Internal aborts carry a private `WeakSet` mark. Catch boundaries test that mark by
identity, so even a `Proxy` that throws itself cannot trigger another trap through
`instanceof` or error-property inspection. Untrusted payload failures and context
failures retain their respective error codes.

Exact payload and context operands use private flat path projections. Wildcard fields
use a separate structural resolver over the frozen nested payload: it enumerates real
array indexes in numeric odometer order and retains an absent candidate when only the
exact suffix after the final wildcard is impassable. An impassable branch before a
later wildcard produces no synthetic indexes. Array access uses a numeric index only
when JavaScript can represent it safely; synthesized paths always use the authored text.

Pipeline execution, condition traversal, and nested pipeline calls use explicit stacks
rather than the JavaScript call stack. Operators receive a frozen invocation containing
resolved values, never the complete payload or resolver. An absent structural candidate
reuses the same core-level absence behavior as an exact field.

## Regular expressions and dictionaries

Portable patterns are parsed into an internal syntax tree and rendered for
`re2-wasm`. The parser rejects syntax outside the specified language and checks the
pattern length, individual quantifiers, nested bounded-repeat factor, and expanded
atom count before invoking RE2.

Dictionary entries are validated and indexed by scalar type during compilation.
Built-in membership operators use private `Set` indexes, while external operators
still receive the immutable normative entries array.

## Verification

`npm run test:conformance` reads the pinned spec commit, verifies the checked-out
`jsonspecs/spec` repository at that exact commit, compares every fixture byte for
byte, and only then executes the suite. Result comparison is performed over the JSON
data model, ignoring host prototypes and classes. Rejection identifiers are compared
even when the expected identifier is absent.

See [TESTING.md](TESTING.md) for the remaining release checks.
