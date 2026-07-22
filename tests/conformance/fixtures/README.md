# Conformance fixtures

This tree is a **normative appendix** of the specification (SPEC.md §7.3): the spec
text and the fixtures version together, atomically, under one tag. Passing every
fixture of a version is a necessary condition of a conformance claim — not a
sufficient one; the SPEC text is the canon (SPEC.md §7.3).

## Format

Evaluation fixture — run the input against the snapshot, compare the normative
projection (SPEC.md §7.2) structurally:

```json
{
  "name": "d13/value-check-skips-on-absent",
  "snapshot": { "format": "jsonspecs-snapshot", "formatVersion": 2, "...": "..." },
  "operators": [],
  "input": { "pipelineId": "checks.main", "payload": {}, "context": {} },
  "expected": { "status": "OK", "issues": [], "ruleset": { "...": "..." } }
}
```

Rejection fixture — the snapshot MUST be refused before any evaluation:

```json
{ "name": "d04/reject-lookahead", "snapshot": { "...": "..." }, "operators": [],
  "expected": { "verdict": "reject" } }
```

Raw I-JSON rejection fixture — pass `snapshotText` to the implementation's text
adapter without parsing it in the runner first:

```json
{ "name": "d28/reject-duplicate-json-member", "snapshotText": "{...}",
  "operators": [], "expected": { "verdict": "reject" } }
```

`operators` is the set of registered non-built-in operator names for the fixture
(conformance is relative to equal operator sets — SPEC.md §7.1). `identifier` in a
rejection `expected` is present only where the spec makes the rejection cause itself
normative (`OPERATOR_NOT_FOUND`). The rejection `expected` object is closed. When
`identifier` is absent, the runner must assert that the implementation did not report
`OPERATOR_NOT_FOUND`; it must not ignore an implementation-reported
`OPERATOR_NOT_FOUND`.

Comparison is **structural JSON equality** (SPEC.md §6.1): array order matters, object
key order does not, absent key ≠ key with `null`, numbers compare as binary64 values.
Host prototypes, classes, map implementations, and property iteration order are not JSON
data and must not affect equality.

## Layout

Directories map to decisions (`DECISIONS.md`) and semantic areas:
`d01-numbers`, `d02-length`, `d03-string-strict`, `d04-regex`, `d05-order`,
`d06-hash`, `d08-representation`, `d09-guards`, `d10-operators`, `d11-snapshot`,
`d13-absence`, `d19-unified-rules`, `d20-aggregation`, `d21-bundle`,
`d22-evaluation`, `d23-binary64`, `d24-closed-schemas`, `d26-format`, `d27-inputs`,
`d28-hash`, `d29-removed`, `d31-wildcard`, `operators`, `semantics`. `operators` provides the complete
built-in outcome matrix: PASS, FAIL with issue shape, and SKIP wherever the operator's
absence semantics admits SKIP.

The reserved test-only operators `conformance.rule.throw`,
`conformance.rule.invalid_result`, `conformance.rule.tri`,
`conformance.rule.params`, and `conformance.rule.inputs` are registered by the
fixture runner only. `tri` maps input strings `PASS`, `SKIP`, and `FAIL` to the
same-named outcomes, `THROW` to a host exception, and `INVALID` to an out-of-contract
result, so mixed populations, exhaustive aggregate evaluation, and late contract
violations can be tested portably. `params`
pins the closed `{outcome}` parameter schema. `inputs` pins core path resolution and
the absent-key versus present-`null` distinction. They are not production operators.

## Maintenance

Fixtures are generated: edit `tools/generate-fixtures.mjs`, run it, commit both.
CI fails if the tree and the generator diverge. `tools/validate-fixtures.mjs` checks
structure and `sourceHash` integrity (JCS/RFC 8785 + SHA-256) of every snapshot.
`tools/JcsUtf16Check.java` independently rebuilds the complete UTF-16 edge snapshot
and verifies the same `sourceHash` on Java.
The hash-mismatch fixtures (including the unknown-operator precedence vector) and the
overflowing-snapshot-number fixture are necessarily exempt
because their intended malformed boundary prevents that check. Raw I-JSON fixtures
have no parsed snapshot on purpose.
For ABORT fixtures the validator checks only the presence of `input.payload`: its
type is deliberately wrong in `INVALID_PAYLOAD`/`INVALID_CONTEXT` fixtures and is
the tested runtime's business.

---

Дерево — **нормативное приложение** спеки (§7.3): текст и фикстуры версионируются
одним тегом. Прохождение всех фикстур версии — необходимое, но не достаточное условие
декларации конформанса; канон — текст спеки (SPEC.md §7.3). Сравнение — структурное равенство JSON нормативной проекции
(§7.2). Отсутствие `identifier` в `expected` тоже проверяется. Прототипы, классы, внутреннее представление объектов и порядок обхода
полей языка реализации не участвуют в сравнении. Фикстуры генерируются из `tools/generate-fixtures.mjs`; правки — в генераторе.
