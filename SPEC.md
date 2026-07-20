# JSONSpecs: Artifact Format Specification

> The compiler and runtime behaviour is normatively defined by this document.

## Table of contents

1. [Common rules for all artifacts](#1-common-rules-for-all-artifacts)
2. [Identifiers and visibility](#2-identifiers-and-visibility)
3. [Reference resolution](#3-reference-resolution)
4. [Artifact: rule](#4-artifact-rule)
   - 4.1 [Common schema](#41-common-schema)
   - 4.2 [Check rule](#42-check-rule)
   - 4.3 [Predicate rule](#43-predicate-rule)
   - 4.4 [Operators](#44-operators)
   - 4.5 [Wildcards and aggregation](#45-wildcards-and-aggregation)
5. [Artifact: condition](#5-artifact-condition)
6. [Artifact: pipeline](#6-artifact-pipeline)
7. [Artifact: dictionary](#7-artifact-dictionary)
8. [Steps (steps / flow)](#8-steps-steps--flow)
9. [Payload field semantics](#9-payload-field-semantics)
10. [Compiler behaviour](#10-compiler-behaviour)
11. [Runtime behaviour](#11-runtime-behaviour)
12. [Security and threat model](#12-security-and-threat-model)

---

## 1. Common rules for all artifacts

Each artifact is a self-contained JSON object (typically one `.json` file).
All fields listed as required below are validated by the compiler in phase 1 (`buildRegistry`)
or phase 2 (`validateSchema`). A missing required field is a compilation error —
`engine.compile()` throws `CompilationError` with a full list of errors.

**Fields required for every artifact regardless of type:**

| Field         | Type              | Required | Description                                                      |
| ------------- | ----------------- | -------- | ---------------------------------------------------------------- |
| `id`          | string, non-empty | yes      | Unique identifier. Must be set explicitly on every artifact.     |
| `type`        | string            | yes      | Artifact type: `rule`, `condition`, `pipeline`, or `dictionary`. |
| `description` | string            | yes      | Human-readable description. Must not be an empty string.         |

> Duplicate `id` values cause a compilation error. Two artifacts in the same rule pack cannot share the same `id`.

---

## 2. Identifiers and visibility

### Visibility rules

The compiler applies these visibility rules in phase 4 (`validateRefs`):

| Artifact                  | Visible from                                                           |
| ------------------------- | ---------------------------------------------------------------------- |
| `library.*`               | anywhere: any pipeline, condition, or other library artifact           |
| `{pipelineId}.*`          | only from the pipeline with the same `{pipelineId}` and its conditions |
| any pipeline by full `id` | any other pipeline can call it via its full absolute `id`              |
| `dictionaries/*`          | globally from any rule                                                 |

Nested pipelines do not inherit the parent's visibility:
`registration.base_validate.rule_username` is not directly visible from `registration` —
only through the nested pipeline `registration.base_validate`.

---

## 3. Reference resolution

When a pipeline or condition step references a rule, condition, or sub-pipeline,
the compiler resolves the reference by the following algorithm:

| Reference form                    | Behaviour                                         | Example                                    |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Starts with `library.`            | absolute reference, used as-is                    | `"library.common.email_format"`            |
| Contains `.` (but not `library.`) | absolute reference, used as-is                    | `"internal.checkout.blocks.payment"`       |
| No `.`                            | scoped ref: expanded to `{scopePipelineId}.{ref}` | `"rule_amount"` → `"checkout.rule_amount"` |

The scope for a pipeline is its own `id`. The scope for a condition is inferred from the
condition's `id` — the prefix up to (not including) the last `.`.

---

## 4. Artifact: rule

### 4.1 Common schema

| Field         | Type   | Required               | Allowed values             | Description                                                                                         |
| ------------- | ------ | ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`          | string | yes                    | unique                     |                                                                                                     |
| `type`        | string | yes                    | `"rule"`                   |                                                                                                     |
| `description` | string | yes                    | non-empty                  |                                                                                                     |
| `role`        | string | **yes**                | `"check"` \| `"predicate"` | Determines rule type and which fields are required                                                  |
| `operator`    | string | **yes**                | see section 4.4            | Operator name from the registered operator pack                                                     |
| `field`       | string | yes for most operators | dot-notation path          | Payload field the operator is applied to. Supports `[*]` (section 4.5) and `$context.*` (section 9) |
| `meta`        | object | optional               | any object                 | Arbitrary metadata. Passed through to trace and issues. Does not affect execution logic             |
| `aggregate`   | object | optional               | see section 4.5            | Aggregation settings for wildcard fields                                                            |

### 4.2 Check rule

Applied when `role: "check"`. Evaluates a condition and creates an `issue` in the result
when it fails.

**Additional required fields:**

| Field     | Type   | Required | Allowed values                            | Description                                                                                                                          |
| --------- | ------ | -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `level`   | string | **yes**  | `"WARNING"` \| `"ERROR"` \| `"EXCEPTION"` | Escalation level on failure                                                                                                          |
| `code`    | string | **yes**  | non-empty, unique in pack                 | Machine-readable error code. Uniqueness is enforced by the compiler — two check rules with the same `code` cause a compilation error |
| `message` | string | **yes**  | non-empty                                 | Human-readable error message                                                                                                         |

**Example:**

```json
{
  "id": "library.order.amount_required",
  "type": "rule",
  "description": "Order amount must be filled",
  "role": "check",
  "operator": "not_empty",
  "field": "order.amount",
  "level": "ERROR",
  "code": "ORDER.AMOUNT.REQUIRED",
  "message": "Order amount is required"
}
```

### 4.3 Predicate rule

Applied when `role: "predicate"`. Returns `TRUE` or `FALSE` and is used in the `when`
expression of a condition artifact. Produces no issues.

**Forbidden fields for `role: "predicate"`:** `level`, `code`, `message`.
Their presence causes a compilation error.

**Example:**

```json
{
  "id": "library.order.pred_is_international",
  "type": "rule",
  "description": "Order is flagged as international",
  "role": "predicate",
  "operator": "equals",
  "field": "order.flags.isInternational",
  "value": true
}
```

### 4.4 Operators

#### Check operators

| Operator                            | Additional rule fields                       | Semantics                                                                             | Behaviour when field is absent        |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `not_empty`                         | —                                            | field is present and not `null`, `""`, or `undefined`                                 | FAIL                                  |
| `is_empty`                          | —                                            | field is absent, `null`, or `""`                                                      | OK (absent = empty)                   |
| `is_boolean`                        | —                                            | `typeof field === "boolean"`                                                          | FAIL                                  |
| `is_string`                         | —                                            | `typeof field === "string"`                                                           | FAIL                                  |
| `is_number`                         | —                                            | `typeof field === "number"`                                                           | FAIL                                  |
| `is_integer`                        | —                                            | field is a number with zero fractional part                                           | FAIL                                  |
| `equals`                            | `value: any`                                 | `field === value` (strict equality)                                                   | FAIL                                  |
| `not_equals`                        | `value: any`                                 | `field !== value`                                                                     | FAIL                                  |
| `not_true`                          | —                                            | field is absent, `null`, `""`, or any value except strict `true`                       | OK                                    |
| `contains`                          | `value: string`                              | string field contains `value` as substring                                            | FAIL                                  |
| `matches_regex`                     | `value: string` (regex), `flags?: string`    | string field matches regex pattern in `value`                                         | FAIL                                  |
| `greater_than`                      | `value: number \| "YYYY-MM-DD"`              | field > value; numeric or date comparison (type auto-detected)                        | FAIL                                  |
| `less_than`                         | `value: number \| "YYYY-MM-DD"`              | field < value                                                                         | FAIL                                  |
| `length_equals`                     | `value: number`                              | `String(field).length === value`                                                      | FAIL                                  |
| `length_max`                        | `value: number`                              | `String(field).length <= value`                                                       | FAIL                                  |
| `field_equals_field`                | `value_field: string`                        | `field === value_field` (both must be present)                                        | FAIL if either field is absent        |
| `field_not_equals_field`            | `value_field: string`                        | `field !== value_field`                                                               | FAIL if either field is absent        |
| `field_greater_than_field`          | `value_field: string`                        | `field > value_field`; types must match (both numeric or both dates)                  | FAIL on type mismatch or absent field |
| `field_less_than_field`             | `value_field: string`                        | `field < value_field`                                                                 | FAIL on type mismatch or absent field |
| `field_greater_or_equal_than_field` | `value_field: string`                        | `field >= value_field`                                                                | FAIL on type mismatch or absent field |
| `field_less_or_equal_than_field`    | `value_field: string`                        | `field <= value_field`                                                                | FAIL on type mismatch or absent field |
| `in_dictionary`                     | `dictionary: { type: "static", id: string }` | field value is in the dictionary's `entries` list                                     | FAIL                                  |
| `any_filled`                        | `fields: string[]` or `paths: string[]`      | at least one field in the list is non-empty. `field` is ignored; `fields` is canonical | FAIL if none are filled               |

> **`any_filled`** is special: it takes `fields[]` instead of `field`. The `field` property may be omitted. `paths[]` is accepted as a legacy alias for `fields[]`; `fields[]` is the canonical form.

> **`in_dictionary`** `dictionary.type`: only `"static"` is supported. Other values cause a runtime error.

> **`matches_regex`** `flags`: if present, the compiler accepts only a string made from `i`, `m`, and `s` without repeated characters.

> **Type assertion operators** never coerce values. For `is_integer`, JSON does not distinguish `1` and `1.0`: both parse to the number value `1` and both pass. A value such as `1.5` fails.

Operator packs are ordinary JavaScript objects passed to `createEngine({ operators })`.
When a caller builds a pack with object spread and the same operator name appears
more than once, JavaScript's last property wins. Project-local operators may
therefore override built-ins by being spread after `Operators.check` or
`Operators.predicate`.

> **`matches_regex`** escaping: before passing `value` to `new RegExp()`, the engine performs one replacement pass over the pattern string: each pair of consecutive backslashes is replaced by one backslash. This supports patterns such as `^\\d{6}$`. This is not iterative unescaping; authors who need regex syntax for a literal backslash must account for JSON string escaping and this single replacement pass.

> **`greater_than`, `less_than`, `field_*_field`**: only finite numbers, numeric strings matching `^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$`, and strict `YYYY-MM-DD` dates are compared. Calendar-impossible dates such as `2026-02-30` are not dates. If the value type cannot be determined, the result is FAIL.

#### Predicate operators

A subset of check operators. **Not available as predicates:** `any_filled`, `length_equals`, `length_max`, `not_true`.

Available: `not_empty`, `is_empty`, `is_boolean`, `is_string`, `is_number`,
`is_integer`, `equals`, `not_equals`, `contains`, `matches_regex`,
`greater_than`, `less_than`, `field_equals_field`, `field_not_equals_field`,
`field_greater_than_field`, `field_less_than_field`,
`field_greater_or_equal_than_field`, `field_less_or_equal_than_field`, `in_dictionary`.

Predicate operators return `TRUE`, `FALSE`, or `UNDEFINED`.
The runtime treats `UNDEFINED` as `FALSE`.

### 4.5 Wildcards and aggregation

If `field` contains `[*]`, the rule is applied to all matching keys in the payload.

**Syntax:** any number of `[*]` segments:

```
"accounts[*].balance"
"accounts[*].transactions[*].amount"
```

**The `aggregate` field:**

```json
"aggregate": {
  "mode": "ALL",
  "onEmpty": "PASS",
  "summaryIssue": true,
  "op": ">=",
  "value": 2
}
```

| Sub-field      | Type    | Applicability          | Description                                                                |
| -------------- | ------- | ---------------------- | -------------------------------------------------------------------------- |
| `mode`         | string  | optional               | Aggregation mode (see tables below)                                        |
| `onEmpty`      | string  | optional               | Behaviour when the wildcard matches zero fields                            |
| `summaryIssue` | boolean | check, `ALL` mode only | `true` = produce one summary issue instead of one issue per failed element |
| `op`           | string  | `COUNT` mode only      | Comparison operator: `==`, `!=`, `>`, `>=`, `<`, `<=`. Default: `>=`       |
| `value`        | number  | `COUNT` mode only      | Target count for comparison. Required when mode is `COUNT`                 |

**Aggregation modes for `role: "check"`:**

| mode    | Default | Semantics                                                                                                             |
| ------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `EACH`  | **yes** | one issue per failed element                                                                                          |
| `ALL`   | no      | all elements must pass; without `summaryIssue` — one issue per failure; with `summaryIssue: true` — one summary issue |
| `COUNT` | no      | checks that the number of passing elements satisfies `op value`                                                       |
| `MIN`   | no      | extracts the minimum value and applies the operator to it                                                             |
| `MAX`   | no      | extracts the maximum value and applies the operator to it                                                             |

**Aggregation modes for `role: "predicate"`:**

| mode    | Default | Semantics                                                    |
| ------- | ------- | ------------------------------------------------------------ |
| `ANY`   | **yes** | `TRUE` if at least one element returned `TRUE`               |
| `ALL`   | no      | `TRUE` if all elements returned `TRUE`                       |
| `COUNT` | no      | `TRUE` if the number of `TRUE` elements satisfies `op value` |

> `MIN` and `MAX` are not supported for `role: "predicate"` — compilation error.

**`onEmpty` behaviour (wildcard matched zero fields):**

| Value       | check (default: `PASS`)                    | predicate (default: `UNDEFINED`)              |
| ----------- | ------------------------------------------ | --------------------------------------------- |
| `PASS`      | rule passes, no issue created              | —                                             |
| `FAIL`      | rule fails, issue created                  | —                                             |
| `TRUE`      | —                                          | predicate returns `TRUE`                      |
| `FALSE`     | —                                          | predicate returns `FALSE`                     |
| `UNDEFINED` | treated as `PASS`                          | predicate returns `FALSE` (UNDEFINED → FALSE) |
| `ERROR`     | runtime throws, pipeline ends with `ABORT` | same                                          |

---

## 5. Artifact: condition

Executes a list of steps (`steps`) only when the `when` expression is truthy.

### Schema

| Field         | Type             | Required | Allowed values           | Description                                                                     |
| ------------- | ---------------- | -------- | ------------------------ | ------------------------------------------------------------------------------- |
| `id`          | string           | yes      | unique                   |                                                                                 |
| `type`        | string           | yes      | `"condition"`            |                                                                                 |
| `description` | string           | yes      | non-empty                |                                                                                 |
| `when`        | string \| object | **yes**  | see below                | Activation condition                                                            |
| `steps`       | array            | **yes**  | non-empty array of steps | Steps executed when `when` is true. Each step is an object with exactly one key |

### The `when` field

Four allowed forms:

```json
"when": "pred_is_international"
```

```json
"when": { "all": ["pred_a", "pred_b"] }
```

```json
"when": { "any": ["pred_a", "pred_b"] }
```

```json
"when": { "not": "pred_a" }
```

| Form               | Semantics                                                  |
| ------------------ | ---------------------------------------------------------- |
| string             | single predicate; condition activates if it returns `TRUE` |
| `{ "all": [...] }` | all predicates must return `TRUE`                          |
| `{ "any": [...] }` | at least one predicate must return `TRUE`                  |
| `{ "not": expr }`  | activates if the nested expression is false                |

`all`, `any`, and `not` support recursive nesting:

```json
"when": {
  "all": [
    "library.shipping.pred_address_missing",
    {
      "not": {
        "any": ["library.order.pred_is_express", "library.order.pred_is_international"]
      }
    }
  ]
}
```

Each element is a reference to a rule with `role: "predicate"`.
A reference to a `role: "check"` artifact causes a compilation error.

Predicate operators are three-valued (`TRUE`, `FALSE`, `UNDEFINED`), but a leaf
predicate with `UNDEFINED` is converted to `FALSE` before the enclosing
expression is evaluated. Therefore `not` inverts that boolean value: if
`"when": { "not": "pred_has_field" }` references a predicate whose field is
absent, the predicate returns `UNDEFINED`, the leaf becomes `FALSE`, `not`
turns it into `TRUE`, and the condition activates.

### Scope inference from id

The compiler determines the condition's `scopePipelineId` as the prefix of `id`
up to (not including) the last `.`:

```
"library.order.cond_international_block"  →  scope: "library.order"
"checkout.cond_amount_check"              →  scope: "checkout"
```

If no `.` is present in the `id`, it is a compilation error.

### Example

```json
{
  "id": "library.order.cond_international_block",
  "type": "condition",
  "description": "If order is international, run additional address checks",
  "when": {
    "any": [
      "library.order.pred_is_international",
      "library.shipping.pred_address_is_foreign"
    ]
  },
  "steps": [
    { "rule": "library.shipping.destination_country_required" },
    { "rule": "library.shipping.destination_country_allowed" },
    { "condition": "library.shipping.cond_customs_declaration_if_required" }
  ]
}
```

---

## 6. Artifact: pipeline

Describes an ordered sequence of steps — the primary validation scenario.

### Schema

| Field              | Type     | Required                           | Allowed values           | Description                                                                                            |
| ------------------ | -------- | ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `id`               | string   | yes                                | unique                   |                                                                                                        |
| `type`             | string   | yes                                | `"pipeline"`             |                                                                                                        |
| `description`      | string   | yes                                | non-empty                |                                                                                                        |
| `entrypoint`       | boolean  | **yes**                            | `true` \| `false`        | Explicit declaration required. Compiler rejects pipelines without this field                           |
| `strict`           | boolean  | **yes**                            | `true` \| `false`        | Explicit declaration required. Compiler rejects pipelines without this field                           |
| `flow`             | array    | **yes**                            | non-empty array of steps | Steps executed in order                                                                                |
| `message`          | string   | required when `strict: true`       | non-empty                | Message for the summary EXCEPTION issued on strict escalation                                          |
| `strictCode`       | string   | optional, only with `strict: true` | non-empty                | Code for the summary EXCEPTION. Default: `"STRICT_PIPELINE_FAILED"`                                    |
| `required_context` | string[] | optional                           | array of context keys    | Context keys that must be present in runtime input `context` or legacy payload `__context`. Missing keys cause an EXCEPTION before any steps run |

### The `entrypoint` field

| Value   | Meaning                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| `true`  | Top-level scenario. Marks this pipeline as an intended entry point for external callers. |
| `false` | Internal block. Intended to be referenced only from another pipeline's `flow`.           |

### The `strict` field

When `strict: true`, the runtime checks the issues accumulated inside the pipeline after
all steps complete. If at least one issue has `level: "ERROR"` or `level: "EXCEPTION"`,
a summary EXCEPTION issue is added and execution stops (`STOP`).
The individual rules inside a strict pipeline retain their original levels — only the
group's final behaviour changes.

### DAG enforcement

The pipeline call graph (`{ "pipeline": "..." }` in `flow`) must be a directed acyclic graph.
A cycle causes a compilation error:

```
Pipeline cycle detected: pipeline_A -> pipeline_B -> pipeline_A
```

### Examples

```json
{
  "id": "entrypoints.registration.full_validation",
  "type": "pipeline",
  "description": "Public entry point for full registration validation",
  "entrypoint": true,
  "strict": false,
  "required_context": ["currentDate"],
  "flow": [
    { "pipeline": "internal.registration.identity_block" },
    { "pipeline": "internal.registration.document_block" }
  ]
}
```

```json
{
  "id": "internal.checkout.blocks.payment",
  "type": "pipeline",
  "description": "Strict payment data validation block",
  "entrypoint": false,
  "strict": true,
  "message": "Payment data validation failed",
  "strictCode": "PAYMENT_BLOCK_FAILED",
  "flow": [
    { "rule": "library.payment.amount_positive" },
    { "rule": "library.payment.currency_allowed" },
    { "condition": "library.payment.cond_card_fields_if_card_type" }
  ]
}
```

## 7. Artifact: dictionary

A named list of allowed values for use with the `in_dictionary` operator.
Globally accessible from any rule.

### Schema

| Field         | Type   | Required | Allowed values  | Description            |
| ------------- | ------ | -------- | --------------- | ---------------------- |
| `id`          | string | yes      | unique          |                        |
| `type`        | string | yes      | `"dictionary"`  |                        |
| `description` | string | yes      | non-empty       |                        |
| `entries`     | array  | **yes**  | non-empty array | List of allowed values |

### `entries` format

Each element may be:

| Form                     | Comparison                                      |
| ------------------------ | ----------------------------------------------- |
| scalar value             | `value === entry`                               |
| object with `code`       | `value === entry.code`                          |
| object with `value`      | `value === entry.value`                         |
| object with both fields  | `value === entry.code || value === entry.value` |

Runtime comparison is strict (`===`) and does not coerce values. Scalar entries may use JSON scalar types such as string, number, or boolean; `null` entries are invalid. The type of the payload field value must match the type in `entries`. Object entries are checked against both `code` and `value` when those fields are present; the object shape does not select only one comparison field. At runtime, an object with neither `code` nor `value` is a non-match. Normative artifacts should still provide at least one of those fields so compiler validation can accept the dictionary.

### Example

```json
{
  "id": "document_type_codes",
  "type": "dictionary",
  "description": "Allowed document type codes",
  "entries": ["21", "22", "31", "32", "36", "99"]
}
```

## 8. Steps (steps / flow)

Steps are used in pipeline `flow` and condition `steps`.
Each step is an object with **exactly one** of three allowed keys.

### Allowed step formats

```json
{ "rule": "<ref>" }
{ "condition": "<ref>" }
{ "pipeline": "<ref>" }
```

An object with two or more keys, or with an unknown key, is a compilation error.

### Optional `stepId` field

A step may include `stepId: string` — a stable identifier for tracing and auditing.
It does not affect execution logic.

```json
{ "rule": "library.order.amount_required", "stepId": "step_001" }
```

### Step references

| Key         | References                                | Resolution                                        |
| ----------- | ----------------------------------------- | ------------------------------------------------- |
| `rule`      | artifact with `type: "rule"` (any `role`) | section 3 rules; supports scoped refs             |
| `condition` | artifact with `type: "condition"`         | section 3 rules; supports scoped refs             |
| `pipeline`  | artifact with `type: "pipeline"`          | absolute `id` only; scoped refs are not supported |

> A `{ "rule": "..." }` step referencing a predicate rule is syntactically valid and compiles
> without error. At runtime the predicate executes, but its `TRUE`/`FALSE` result is ignored —
> no issue is created, the flow is not stopped.

## 9. Payload field semantics

### `field` format

The value of `field` is a dot-notation path to a key in the flat payload map:

```
"order.amount"
"user.email"
"accounts[0].balance"
"accounts[*].balance"   ← wildcard
```

The engine accepts both nested JSON objects and pre-flattened maps
(`flattenPayload` is idempotent — flat input passes through unchanged).

### Context access: `$context.*`

Fields with the `$context.` prefix are read from the `context` object in the request,
not from the `payload`:

```json
{
  "field": "$context.currentDate",
  "operator": "field_less_or_equal_than_field",
  "value_field": "document.issueDate"
}
```

`$context.*` is a reserved prefix. Wildcards (`[*]`) inside `$context.*` are not supported.

### Empty value semantics

`not_empty` considers a field empty if it:

- is absent from the flat map (`deepGet` returned `ok: false`), or
- equals `null`, or
- equals `""` (empty string).

`false`, `0`, and `[]` are **not** considered empty.

`is_empty`: inverse of `not_empty`. If the field is absent, returns `OK` (absent = empty).

## 10. Compiler behaviour

Compilation runs sequentially in 7 phases and is **phase-fail-fast** for errors.
The first phase that finds errors completes its pass, returns all errors found
inside that phase, and prevents later phases from running. Errors from different
phases are therefore not mixed; `validate()` exposes diagnostics from that first
failing phase only. Warning diagnostics do not stop compilation and may be
returned by successful `validate()` and `compile()` calls.

| Phase                       | What is checked                                          | Stop condition                              |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| 1. `buildRegistry`          | `id` uniqueness, presence of `id`, `type`, `description` | all registry errors in one pass             |
| 2. `validateSchema`         | artifact structure per type                              | all schema errors in one pass               |
| 3. `validateCodeUniqueness` | uniqueness of `code` among check rules                   | all duplicates in one pass                  |
| 4. `validateRefs`           | references and visibility                                | all reference errors in one pass            |
| 5. `buildConditions`        | condition step normalisation                             | assert (should not fail if phases 1–4 pass) |
| 6. `buildPipelines`         | pipeline step normalisation                              | assert                                      |
| 7. `validatePipelineDAG`    | absence of cycles in the pipeline call graph             | all cycles in one pass                      |

`engine.compile()` throws `CompilationError` with the full list of errors if any phase fails. If no errors exist, `compile()` succeeds even when warning diagnostics were collected.

## 11. Runtime behaviour

### `status` and `control` result matrix

| Situation                                                       | `status`           | `control`  |
| --------------------------------------------------------------- | ------------------ | ---------- |
| No issues at all                                                | `OK`               | `CONTINUE` |
| Only `WARNING`-level issues                                     | `OK_WITH_WARNINGS` | `CONTINUE` |
| At least one `ERROR` (no `EXCEPTION`)                           | `ERROR`            | `STOP`     |
| An `EXCEPTION`-level rule fired, or strict escalation triggered | `EXCEPTION`        | `STOP`     |
| Engine runtime exception                                        | `ABORT`            | —          |

### Issue object fields

| Field        | Type           | Always present | Description                                                                                           |
| ------------ | -------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `kind`       | string         | yes            | Always `"ISSUE"`                                                                                      |
| `level`      | string         | yes            | `WARNING`, `ERROR`, or `EXCEPTION`                                                                    |
| `code`       | string         | yes            | Code from the rule, or `strictCode` from the pipeline                                                 |
| `message`    | string         | yes            | Message from the rule, or `message` from the pipeline                                                 |
| `field`      | string \| null | yes            | Payload field (for wildcards: the concrete key, not the pattern). `null` for strict escalation issues |
| `ruleId`     | string         | yes            | `id` of the rule. For strict escalation: `"pipeline:{pipelineId}"`                                    |
| `expected`   | any            | no             | Expected value (`value` or `dictionary` from the rule)                                                |
| `actual`     | any            | no             | Actual value of the field in the payload                                                              |
| `stepId`     | string         | no             | `stepId` from the step, if set                                                                        |
| `meta`       | object         | no             | `meta` from the rule, or aggregation metadata                                                         |
| `pipelineId` | string         | yes            | Immediate enclosing pipeline that produced the issue                                                  |

### Level behaviour at runtime

| `level`     | Issue created | Pipeline stops       | Contributes to `status`                    |
| ----------- | ------------- | -------------------- | ------------------------------------------ |
| `WARNING`   | yes           | no                   | `OK_WITH_WARNINGS` (if no ERROR/EXCEPTION) |
| `ERROR`     | yes           | no                   | `ERROR`                                    |
| `EXCEPTION` | yes           | **yes, immediately** | `EXCEPTION`                                |

After stopping on `EXCEPTION`, remaining pipeline steps are not executed.
Already-accumulated issues are preserved in the response.

## 12. Security and threat model

Runtime `payload` and `context` are treated as untrusted input. Rule artifacts,
dictionaries, snapshots, and custom operator code are treated as trusted author
input, but trusted authors can still accidentally write expensive rules. In
particular, JavaScript regular expressions are not guaranteed to run in linear
time.

The compiler lints `matches_regex` patterns for common ReDoS-prone constructs,
including overlapping quantified alternations and nested quantified groups when
the outer group uses unbounded repetition (`*`, `+`, or `{n,}`). Nested
quantifiers under bounded outer repetition (`?`, `{n}`, or `{n,m}`) are not
classified in this release. Such findings are emitted as `REGEX_REDOS_RISK`
diagnostics with `level: "warning"`. The linter is a heuristic detector; it
highlights known risk patterns but is not a proof that accepted regular
expressions are safe for all inputs.

Artifacts, runtime payload, runtime context, transport-normalized runtime
results, trace details, and public custom-operator result surfaces have a
deterministic maximum JSON depth of 256. Over-deep artifacts fail source
validation with `ARTIFACT_TOO_DEEP`. Over-deep payload or context input aborts
evaluation with `PAYLOAD_TOO_DEEP`. Over-deep operator result surfaces abort
with `OPERATOR_CONTRACT_VIOLATION`. Transport normalization truncates over-deep
values with the string marker `"[MaxDepth]"`; trace truncation does not affect
the evaluation verdict.

The engine does not impose a normative limit on total payload size, number of
produced issues, or serialized result size. Callers are responsible for those
limits at the transport or service boundary.

# Public runtime contract (v2)

`validate(artifacts, options)` returns `{ok, diagnostics}` and does not throw for invalid source. Successful validation may include warning diagnostics. Every diagnostic has stable `code`, `level`, `message`, `phase`, `artifactId`, `path`, and `location` fields. Compiler phases construct these fields directly; they are not inferred from message text. `path` identifies the offending property relative to the artifact, while `location` is `file`, `file:line`, or `file:line:column` when supplied through `options.sources`, and `null` otherwise. `compile()` returns an opaque `prepared-jsonspecs` artifact; runtime internals are available only through `inspect()`.

`runPipeline(prepared, {pipelineId?, payload, context?}, options)` accepts only a prepared artifact. If `pipelineId` is omitted, exactly one pipeline must be marked `entrypoint`. After a prepared artifact is accepted, `runPipeline` returns a runtime result and does not throw; unexpected runtime faults are contained as ABORT results. `payload` and `context` must be JSON-safe objects within the maximum JSON depth. Runtime clones and validates `context` before evaluation; the legacy `payload.__context` source follows the same checks. Runtime results for a valid prepared artifact always include `status`, `control`, `issues`, and `ruleset`. `ruleset.sourceHash` identifies the compiled artifacts; `ruleset.engineVersion` is the version of the loaded jsonspecs engine from its `package.json`; snapshot builds additionally expose optional `rulesetVersion` and `projectId`. ABORT results produced after a prepared artifact is accepted preserve the same `ruleset`. ABORT includes `{code,message,details}`, never a stack. Trace is disabled by default and enabled with `basic` or `verbose`.

An exception thrown by `traceRedactor` is contained and returned as ABORT with `TRACE_REDACTOR_ERROR`; it never escapes `runPipeline`. Unexpected engine faults use the neutral fallback code `RUNTIME_ABORT`.

Trace entries use one structural contract: `{kind:"TRACE",artifactType:"jsonspecs",artifactId,step,at,outcome,details?}`. The normative `step` enum is `pipeline.start`, `pipeline.finish`, `pipeline.abort`, `pipeline.strict`, `rule.start`, `rule.finish`, `condition.evaluate`, `predicate.aggregate`, `check.aggregate`, `context.required`, and `operator.trace`. Basic mode removes runtime values; verbose details pass through `traceRedactor` when provided. Operator-provided trace details are transport-normalized before the trace event is recorded, so over-deep values are truncated with `"[MaxDepth]"`.

Custom check operators return `OK|FAIL|EXCEPTION`; predicate operators return `TRUE|FALSE|UNDEFINED|EXCEPTION`. `ctx.get(path)` returns `{ok,value}` where `ok` is a boolean property. Any other operator result aborts with `OPERATOR_CONTRACT_VIOLATION`; details contain only `{operator, ruleId, returnedStatus}` and no other data returned by the operator. Over-deep values in `result.actual`, `result.meta`, `result.failures[*].actual`, or `result.failures[*].meta` also abort with `OPERATOR_CONTRACT_VIOLATION`.

When an operator reports `EXCEPTION`, runtime aborts with `OPERATOR_FAULT`. The public error message is generic: `Operator <operator> failed for rule <ruleId>`. `details` contains only `{operator, ruleId}`. The original operator error message and stack are not included in the transport-safe result. Built-in operator `EXCEPTION` results follow the same rule. Details for both `OPERATOR_FAULT` and `OPERATOR_CONTRACT_VIOLATION` exclude data returned by the operator.

Terminology note: `EXCEPTION` has three distinct meanings in v2. A check rule with `level: "EXCEPTION"` creates an issue and stops the flow with result status `EXCEPTION`. An operator result with `status: "EXCEPTION"` is an operator fault and produces ABORT with `OPERATOR_FAULT`. ABORT is the runtime run status for failures that prevent normal rule evaluation from completing.

Normative snapshots have `format: "jsonspecs-snapshot"`, `formatVersion: 1`, canonical `sourceHash`, `engine.minVersion`, `artifacts`, and optional project `meta`. `engine.minVersion` must be a complete SemVer 2.0.0 version; compatibility uses SemVer precedence across major, minor, patch, and prerelease identifiers. They are consumed only through `compileSnapshot()`.
