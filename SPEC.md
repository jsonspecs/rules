# JSONSpecs Behavior Specification

**Version:** 1.0.0-rc.5 · **Status:** Release Candidate — the `v1.0.0` tag is applied after
cross-implementation comparison on a live stand (see repository README, Release process).

This specification is the canon of runtime behavior for a given version. It states only
expected behavior. The reasoning behind every decision lives in a separate document —
`DECISIONS.md` / `DECISIONS_RU.md` — which in turn refers to the prototype
implementation (`source/`) whose practical experience produced these decisions.

**Notation.** `[D1]`…`[D30]` refer to numbered decisions in `DECISIONS.md`;
`[DR-I]`…`[DR-VIII]` refer to its addenda. MUST/MUST NOT/SHOULD/MAY per RFC 2119.

---

## 1. Introduction and scope

This specification defines the observable behavior of a JSONSpecs rules runtime:

1. the format of rule artifacts and snapshots;
2. the semantics of built-in operators — what they decide, not how;
3. the format and content of the evaluation result.

Two conformant implementations, given the same snapshot, the same `payload`, and the same
`context`, MUST produce identical normative results (Part III defines the normative
surface) and MUST accept or reject the same set of inputs. For snapshots using
non-built-in operators this guarantee is bounded by §7.1. `[D17]` The text of this
specification is the canon; the fixture suite is a mandatory but not sufficient check
of a conformance claim (§7.3).

This specification does not define APIs, function names, internal representations,
compilation strategies, the moment at which validation occurs, performance characteristics,
or transport-level limits on payload or result size. An implementation MAY compile
snapshots ahead of time, interpret them directly, build any intermediate structure, or
none — these choices are invisible to conformance. `[D12]`

The key words MUST, MUST NOT, SHOULD, MAY are to be interpreted as described in RFC 2119.

Custom-operator business semantics are outside this core specification. The specification
does define their complete extension boundary: compile-time contracts, invocation shape,
operator result shape, and unknown-operator rejection. A package that claims equivalent
custom-operator behavior across runtimes additionally follows the operator-pack profile
in §7.1. `[D10][D27]`

---

## 2. Data model

### 2.1 Values

A *value* is a JSON value: `null`, boolean, number, string, array, or object. There is no
`undefined` in the data model. Where an implementation's host language distinguishes
"absent" from "null", only the JSON-visible distinction is normative: a key that is not
present versus a key whose value is `null`.

All input documents (snapshot, payload, context) and the normative result are I-JSON
documents. The separately supplied `pipelineId` MUST likewise contain Unicode scalar
values only.
Object member names MUST be unique and strings MUST contain Unicode scalar values only:
unpaired UTF-16 surrogates are forbidden. An adapter accepting JSON text MUST detect both
conditions before an ordinary lossy parse; a parser that silently keeps one duplicate
member or materializes a lone surrogate is insufficient. Snapshot violations cause
rejection. Payload/context transport rejection occurs before the evaluation tuple exists
and is therefore outside the runtime `ABORT` channel. `[D28]`

Structures that cannot round-trip through I-JSON serialization (cyclic references and
host-specific types) are outside the model. JSON number tokens enter the model only after
the normative conversion in §2.2; overflow to infinity is rejected at the relevant
boundary (§4.10, §5.1).

**Maximum depth.** Depth is defined algorithmically: a scalar or an empty container has
depth 1; a non-empty container has depth 1 + the maximum depth of its members. Every
input document — the complete snapshot, the payload, and the context — MUST NOT exceed depth
**256**: depth 256 is accepted, 257 is rejected (Part II). `[D9][DR-IV]` The limit is an
*input guard*, not a constraint on the result: a result built from bounded inputs is
bounded by construction plus fixed envelope overhead, and no normative depth limit
applies to it: moving accepted `issue.meta` into the result envelope must not make the
result invalid.

Values that are not JSON documents (host-language cycles, functions, BigInt and the
like) are outside the data model entirely; how an implementation's API boundary treats
them is an adapter concern, out of scope. `[DR-IV]`

**Reserved keys.** The object keys `__proto__`, `prototype`, and `constructor` are
forbidden in payload and context at any depth. This is a contract rule, not a
platform-specific defense: implementations on platforms with no prototype semantics MUST
reject these keys all the same, otherwise identical inputs would produce different
verdicts across implementations. `[D9]`

### 2.2 Numbers

The number domain is exactly the finite values of **IEEE 754 binary64**. `[D1][D23]`

- Every JSON number token MUST be converted to binary64 using round-to-nearest,
  ties-to-even. This conversion is normative and applies equally to snapshots, payload,
  context, and custom-operator parameters.
- If conversion produces `+Infinity` or `-Infinity`, the document is outside the model:
  the snapshot is rejected and payload/context produce structured `ABORT` (§5.1). An
  arbitrary-precision implementation, such as Java `BigDecimal`, MUST perform this
  conversion explicitly before execution.
- Every finite conversion result is accepted. Thus `0.1` denotes its nearest binary64
  value, while the token `9007199254740993` denotes `9007199254740992`. There is no
  "outside the determinism guarantee" category.
- Overflow is rejected; underflow and subnormal values follow ordinary
  round-to-nearest-even. `-0` is normalized to `+0` on every normative surface.
- Integers in ±(2^53 − 1) are represented exactly. `1` and `1.0` denote the same value.
  `is_integer` accepts any finite binary64 value with zero fractional part.

**Numeric strings.** In ordered comparisons (§2.5) a string is *numeric* if and only if it
matches:

```
^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$
```

A matching string is numeric only when round-to-nearest-even conversion produces a finite
binary64 value. Thus `"1e400"` is a valid JSON string but not a numeric string for ordered
comparison. Strings outside the grammar are likewise non-numeric regardless of what a
host language's lenient parser accepts (`" 5"`, `"0x10"`, `"5,0"`, `"Infinity"`).

### 2.3 Strings

Strings are sequences of Unicode code points.

**Length.** Wherever this specification measures string length (`length_equals`,
`length_max`), the unit is the **Unicode code point**. `[D2]` A surrogate pair counts
as one. Implementations whose native string length is UTF-16 code units (JavaScript,
Java) MUST count code points explicitly.

Grapheme clusters are never used: their definition depends on the Unicode version and
would make results release-dependent.

### 2.4 Equality

Two values are *equal* when:

- both are `null`; or
- both are booleans with the same value; or
- both are numbers with the same binary64 value (`1 == 1.0`); or
- both are strings with the same sequence of code points.

Values of different types are never equal: `1` ≠ `"1"`, `false` ≠ `0`, `null` ≠ `""`.
There is no coercion. Arrays and objects are never equal to anything under this relation
(equality is defined for scalar comparison in operators; deep structural equality is not
part of the operator model).

### 2.5 Ordered comparison

Ordered comparison (`greater_than`, `less_than`, `field_*_field`) operates on two operands
classified independently:

| Operand | Classification |
| --- | --- |
| JSON number | **number** |
| string matching the numeric grammar (§2.2) | **number** (converted to binary64) |
| string matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` that is a valid proleptic Gregorian calendar date | **date** |
| anything else (booleans, `null`, arrays, objects, other strings) | **unclassified** |

Calendar validity includes month range 01–12, day range valid for the month, and leap-year
rules for February; `2026-02-30` and `2026-13-01` are not dates. The year range is
0000–9999. Date ordering is chronological (equivalently: lexicographic over the canonical
`YYYY-MM-DD` string).

A comparison is *determined* only when both operands classify to the **same** kind
(both numbers or both dates). If either operand is unclassified, or the kinds differ, the
comparison is *undetermined*, and the operator returns `FAIL` for present operands.

Note the classification is disjoint by construction: no string is simultaneously numeric
and a date.

### 2.6 Emptiness

A field is *empty* when it is:

- **absent** — its path does not resolve in the flattened payload (§2.7); or
- `null`; or
- `""` (the empty string).

`false`, `0`, `[]`, and `{}` are **not** empty.

### 2.7 Paths, flattening, and field resolution

**Path syntax.** A field reference is a dot-notation path over the flat payload map:

```
order.amount
accounts[0].balance
accounts[*].balance          ← wildcard, §3.6
$context.currentDate         ← context access
```

**Normative input form.** `[D15]` The payload and the context are ordinary nested JSON
objects. The flat path → value map below is an **internal projection** that defines
path resolution — it is not an input format: accepting pre-flattened input is an
implementation adapter outside this contract. So that every leaf has exactly one
unambiguous path, object keys in payload and context MUST NOT be empty and MUST NOT
contain `.`, `[` or `]` — such keys are unaddressable, and the input is rejected
(Part II, `INVALID_PAYLOAD_KEY` / `INVALID_CONTEXT_KEY`).

**Flattening (internal projection).** Normatively defined as follows:

- A nested object key `k` under prefix `p` produces paths `p.k…`; an array element at
  index `i` under prefix `p` produces paths `p[i]…`.
- **Leaves** are: scalars (`null`, boolean, number, string), the empty object `{}`, and
  the empty array `[]`. A leaf's path maps to its value.
- A **non-empty container does not itself appear** in the flat map — only its
  descendants' paths do. Given `{"a": [1]}`, the flat map is `{"a[0]": 1}`; the path `a`
  is *absent*. Given `{"a": []}`, the flat map is `{"a": []}` and `a` resolves to the
  value `[]` (which is non-empty per §2.6).

**Resolution.** Resolving path `f` against the flat map yields either
*(present, value)* or *absent*. There is no partial resolution and no prototype-chain
or default-value fallback.

**Path grammar.** `[DR-IV]` A field reference MUST match:

```ebnf
path      = [ "$context." ] , segment , { "." , segment } ;
segment   = key , { index } ;
key       = key-char , { key-char } ;                  (* non-empty *)
key-char  = ? any code point except "." "[" "]" ? ;
index     = "[" , ( "0" | nz-digit , { digit } ) , "]"  (* no leading zeros *)
          | "[*]" ;
digit     = "0" | nz-digit ;
nz-digit  = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

Paths violating the grammar (empty segments, `a..b`, leading-zero indexes like
`a[01]`) make the artifact invalid. `[*]` is permitted only where §3.6 allows it;
`value_field` and `$context.*` paths MUST NOT contain `[*]`.

**Context access.** Paths with the reserved prefix `$context.` resolve against the
`context` input instead of the payload, with the same resolution semantics. Wildcards are
not permitted inside `$context.*` paths (artifact rejection). The prefix is reserved:
a payload key literally named `$context` has no special meaning and is unreachable via
`$context.*` paths.

The legacy mechanism of passing context inside the payload under a `__context` key does
**not** exist in this specification: `__context` is an ordinary payload key with no
special semantics. `[D11]`

---

## 3. Operator semantics

### 3.1 Operator model

A *rule* applies one operator to payload and, possibly, context. A rule has no
`check` or `predicate` role: it is one business condition whose consequences are
determined by its use site (§5.3–§5.4). `[D19]`

The normative operator outcome is exactly one of `PASS`, `FAIL`, `SKIP`:

- `PASS` — the condition is satisfied;
- `FAIL` — the condition is not satisfied;
- `SKIP` — the condition is semantically not applicable to this input.

A returned value outside this closed enum, including the string `EXCEPTION`, causes
`ABORT OPERATOR_CONTRACT_VIOLATION`. A thrown exception or host panic causes
`ABORT OPERATOR_FAULT`. The reaction is independent of whether the rule is invoked
from a step or from `when`. A business stop is expressed only by a rule `FAIL` with
`issue.level: "EXCEPTION"`; an operator neither selects a level nor creates an issue.
`[D17][D19]`

Operator behavior is a pure function of one core-built invocation. The invocation is
the following abstract record; its property names and presence semantics are normative,
while its host-language representation is not:

```text
{
  field?: JSON value,
  fields?: [{ value?: JSON value }, ...],
  value?: JSON value,
  value_field?: JSON value,
  inputs?: { <declared name>: JSON value, ... },
  dictionary?: [scalar, ...],
  params?: JSON object
}
```

`field` and `value_field` contain resolved values, not authored paths. `fields` has one
entry per authored path in the same order; an entry without `value` represents an absent
path. `inputs` contains a configured name only when its path resolves; a configured path
that is absent at runtime therefore produces an absent member, not automatic `SKIP`.
`dictionary`
contains the referenced entries. Literal `value` and validated `params` are passed
verbatim. A property not accepted or configured by the operator's contract is absent.
The invocation never contains the whole payload, the whole context, a path resolver,
concrete path strings, or an equivalent of `ctx.get()`. Core separately retains paths
needed for issue attribution. Operators MUST NOT depend on the use site, evaluation
order, wall-clock time, locale, or any other ambient state. `[D27]`

For every resolved operand, an absent path is represented by an absent key; a present
JSON `null` is represented by a present key whose value is `null`. This distinction
applies recursively to the named `inputs` map and is identical across runtimes.

Every operator registers a closed compile-time contract declaring:

1. which standard operands (`field`, `value`, `value_field`, `dictionary`) it accepts,
   the JSON type constraints on their authored configuration, and which combinations
   are required;
2. the allowed and required *configured names* in `inputs`; every configured input value is a path
   checked by the core path grammar (§2.7) and MUST NOT contain `[*]`;
3. a closed schema for constant `params`.

The operator registry is a partial function from a non-empty name to exactly one
contract and implementation. Ambiguous or duplicate bindings are invalid deployment
configuration. Names in the built-in table (§3.2) are reserved: a custom registration
MUST NOT replace, shadow, or alter a built-in operator.

`fields` is not a general custom-operator operand: it exists only for the built-in
`any_filled`. `value` is any I-JSON value unless the operator contract narrows it.
`value` and `value_field` are globally mutually exclusive. "Required input name" means
that the named path MUST be configured in the rule artifact; it does not require that
the path resolve in a particular payload or context.
Compile-time type constraints apply to authored path strings, literal `value`, and the
dictionary reference. They do not validate the runtime JSON values later resolved from
`field` or `value_field`; those values are interpreted by the operator's behavior.

Core resolves all declared paths before invocation. `params` is never interpreted as
input addressing and the operator has no runtime data source with which it could resolve
a path-like string stored there. A thrown exception or host panic uses the existing
`OPERATOR_FAULT` channel; it is never a fourth business outcome.

**Absent-field behavior.** `[D13][D19][D27]`

- **Presence semantics** (`not_empty`, `is_empty`, `not_true`, `any_filled`):
  absence is in their domain; the outcome is listed below.
- **Value semantics** (all other built-ins and every custom operator): when a configured
  `field` or `value_field` path is absent, the operator is not invoked and the rule
  receives `SKIP`. This applies regardless of whether the compile-time contract makes
  that operand required or optional, and to both operands of `field_*_field`. A custom
  operator that needs to observe absence MUST express that dependency through `inputs`.
- **Named inputs** never cause core-level `SKIP`. After all configured paths are
  resolved, the operator is invoked with an `inputs` object containing exactly the
  names whose paths are present. The operator decides whether an omitted value means
  `PASS`, `FAIL`, or `SKIP`.

`SKIP` has no effect in a rule step and maps to `false` in `when`. Requiredness is
therefore always expressed by a separate presence rule.

**String-strict operators** `[D3][DR-I]`: `contains`, `matches_regex`, and
`not_matches_regex` require a string; a present non-string produces `FAIL`. Host
stringification is never applied.

### 3.2 Built-in operators

Every operator in this table is allowed both in a rule step and in `when`. Except for
`any_filled`, every row requires exactly one `field`. The Parameters column is the rest
of the operator's exact closed operand schema; built-ins accept no `inputs` or `params`.
No row permits both `value` and `value_field`. The
"Absent" column gives the rule outcome when the path does not resolve. All
comparisons use §2.4 and §2.5 without other coercion.

| Operator | Parameters | PASS when | Absent |
| --- | --- | --- | --- |
| `not_empty` | — | field is not empty (§2.6) | FAIL |
| `is_empty` | — | field is empty (§2.6) | PASS |
| `not_true` | — | value is anything except boolean `true` | PASS |
| `any_filled` | `fields: path[]` | at least one listed field is not empty; `field` is unused | absence = empty; FAIL when all are empty |
| `is_boolean` | — | value is a boolean | SKIP |
| `is_string` | — | value is a string | SKIP |
| `is_number` | — | value is a number | SKIP |
| `is_integer` | — | value is a number with zero fractional part | SKIP |
| `equals` | `value` | value equals `value` (§2.4) | SKIP |
| `not_equals` | `value` | value does not equal `value` | SKIP |
| `contains` | `value: string` | value contains `value` as a substring | SKIP |
| `matches_regex` | `value: pattern` | string contains a pattern match (§3.4) | SKIP |
| `not_matches_regex` | `value: pattern` | string contains no pattern match | SKIP |
| `greater_than` | `value: number \| numeric-string \| date-string` | comparison is determined and field > value | SKIP |
| `less_than` | `value: number \| numeric-string \| date-string` | comparison is determined and field < value | SKIP |
| `length_equals` | `value: non-negative integer` | string has exactly `value` code points; non-string → FAIL | SKIP |
| `length_max` | `value: non-negative integer` | string has at most `value` code points; non-string → FAIL | SKIP |
| `field_equals_field` | `value_field: path` | both fields are present and equal | SKIP if either is absent |
| `field_not_equals_field` | `value_field: path` | both are present and unequal | SKIP if either is absent |
| `field_greater_than_field` | `value_field: path` | both present, determined, field > value_field | SKIP if either is absent |
| `field_less_than_field` | `value_field: path` | both present, determined, field < value_field | SKIP if either is absent |
| `field_greater_or_equal_than_field` | `value_field: path` | both present, determined, field ≥ value_field | SKIP if either is absent |
| `field_less_or_equal_than_field` | `value_field: path` | both present, determined, field ≤ value_field | SKIP if either is absent |
| `in_dictionary` | `dictionary: id` | value matches an entry (§3.5) | SKIP |
| `not_in_dictionary` | `dictionary: id` | value matches no entry (§3.5) | SKIP |

`any_filled` accepts only `fields[]`; the legacy `paths[]` alias does not exist.
The "required and satisfies X" idiom remains two rules: one presence rule and one
value rule. `[D11][D13]`

### 3.3 Outcome interpretation

| Outcome | Rule step | `when` leaf |
| --- | --- | --- |
| `PASS` | produces nothing | `true` |
| `FAIL` | creates an issue from `rule.issue` | `false`, no issue |
| `SKIP` | produces nothing | `false` |

The `issue` object does not participate in logical evaluation. A rule with
`issue.level: "EXCEPTION"` MAY therefore be used in `when`; it remains an ordinary,
side-effect-free condition at that site. `[D19]`

### 3.4 Regular expressions

`[D4]` This section defines the complete pattern language. It is a portable subset chosen
so that every mainstream backend platform can execute it with its standard regex engine
(it is a strict subset of RE2, of ECMAScript-with-`u`, of `java.util.regex`, and of .NET
non-backtracking mode). The language is implementable by a linear-time
automaton (it is a subset of RE2) — a property of the *language*, not of every
execution: backtracking engines may execute some subset patterns (e.g. `(a+)+$`)
super-linearly. `[D16]` *Security note (informative):* implementations SHOULD execute
patterns with an automaton-based engine or apply equivalent mitigations; the choice is
out of contract scope `[D12]`.

#### 3.4.1 Pattern text

The pattern is interpreted exactly as the string produced by I-JSON decoding. No
additional backslash collapsing, unescaping, normalization, or preprocessing occurs.
Legacy doubled-backslash patterns are normalized once by migration tooling. `[D29]`

#### 3.4.2 Grammar

The decoded pattern MUST conform to:

```ebnf
pattern      = alternation ;
alternation  = concat , { "|" , concat } ;
concat       = { element } ;
element      = anchor | quantified ;
anchor       = "^" | "$" ;
quantified   = atom , [ quantifier ] ;
quantifier   = ( "*" | "+" | "?" | counted ) ;            (* no lazy/possessive modifiers *)
counted      = "{" , int , [ "," , [ int ] ] , "}" ;      (* {n} {n,} {n,m}, n ≤ m *)
atom         = literal | "." | escape | class | group ;
group        = "(" , [ "?:" ] , alternation , ")" ;
class        = "[" , [ "^" ] , class-item , { class-item } , "]" ;
class-item   = class-atom , [ "-" , class-atom ]          (* range: left ≤ right *)
             | class-escape ;
class-atom   = class-literal | escaped-meta | char-escape ;
escape       = escaped-meta | char-escape | class-escape ;
escaped-meta = "\" , ( "\" | "." | "*" | "+" | "?" | "(" | ")" | "[" | "]"
                     | "{" | "}" | "|" | "^" | "$" | "/" | "-" ) ;
char-escape  = "\n" | "\r" | "\t" ;
class-escape = "\d" | "\D" | "\w" | "\W" | "\s" | "\S" ;
int          = digit , { digit } ;                        (* value ≤ 1000 *)
digit        = "0" | nz-digit ;
nz-digit     = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

`literal` is any code point except the metacharacters `\ . * + ? ( ) [ ] { } | ^ $`.
`class-literal` is any code point except `\ ] -`. A literal hyphen in a class MUST be
written as `\-`; an unescaped `-` is always the range operator. A literal `^` is allowed
inside a class anywhere except the first position. Range endpoints are ordered by
Unicode code-point value.

**Explicitly excluded** (their presence makes the pattern, and hence the snapshot,
invalid): backreferences, lookahead/lookbehind `(?= (?! (?<= (?<!`, named groups
`(?<name>`, word boundaries `\b \B`, inline flags `(?i)`, hex/unicode escapes
`\xHH \uHHHH \x{…}` (Unicode characters are written literally or escaped at the JSON
string level, which already provides `\uXXXX`), POSIX classes `[:alpha:]`, nested
classes, octal escapes, and any escape not listed in the grammar.

**Normative limits** (protect against divergent engine-internal limits): every `int` in a
quantifier MUST be ≤ 1000; the decoded pattern MUST be ≤ 1024 code points. Patterns
violating the grammar or the limits make the artifact invalid — this is an artifact
rejection, not a runtime error.

#### 3.4.3 Matching semantics

- The subject is a sequence of Unicode code points; `.` matches any single code point
  except U+000A LINE FEED. It therefore matches U+000D CARRIAGE RETURN, U+0085 NEXT LINE,
  U+2028 LINE SEPARATOR, and U+2029 PARAGRAPH SEPARATOR. (JavaScript implementations MUST
  compile with the `u` flag and compensate for their engine's broader line-terminator
  exclusion.)
- `\d` = `[0-9]`, `\w` = `[0-9A-Za-z_]`, `\s` = `[ \t\n\r\f\v]`, uppercase forms are
  their complements. **ASCII semantics regardless of platform defaults** — engines whose
  defaults are Unicode-aware (e.g. Rust `regex`) MUST compensate. `[D4.1]`
- Matching is a **search**: the pattern matches if any substring (including the empty
  substring) matches. Authors anchor with `^`/`$` explicitly.
- No regex flags exist in version 1. Matching is case-sensitive. `^` matches only the
  absolute start of the subject and `$` only the absolute end; `$` MUST NOT match before
  a final line terminator. `.` does not match U+000A. Implementations MUST compensate for
  different host-engine anchor and dot defaults. A rule containing `flags` is invalid.
  `[D29]`

### 3.5 Dictionaries

A dictionary is a named list of scalar `entries`: strings, finite binary64 numbers, or
booleans. `null`, arrays, objects, and duplicate entries are invalid. Matching uses §2.4
equality, strictly and without coercion; the payload value's type must equal the entry's
type. `in_dictionary` is `PASS` when any entry matches; `not_in_dictionary` is `PASS`
when the field is present and no entry matches. Dictionary labels and code/value aliases
belong to authoring metadata, not the executable format. `[D26]`

### 3.6 Wildcards and aggregation

#### 3.6.1 Wildcard resolution and enumeration order `[D5]`

A `field` path may contain `[*]` segments. Each segment matches non-negative integer
indices at that position in the internal flat map. Resolution returns concrete paths
present after flattening the normative nested JSON input.

Indices are ordered numerically ascending; gaps are allowed. Multiple wildcard
segments are ordered lexicographically by their index tuple, left segment first
(odometer order). This order controls per-element issues.

#### 3.6.2 Aggregation `[D20]`

A rule whose `field` contains `[*]` MUST have `aggregate` with an explicit `mode`.
`aggregate` on a non-wildcard field is invalid. `value_field` MUST NOT contain a
wildcard; aligned comparison of two wildcard paths is not defined in version 1.

| Field | Constraint |
| --- | --- |
| `mode` | required: `ALL`, `ANY`, or `COUNT` |
| `onEmpty` | `PASS`, `FAIL`, or `SKIP`; default `SKIP` |
| `issueMode` | `EACH` or `SUMMARY`; only for `ALL`/`ANY`; required when the rule has `issue`, forbidden otherwise |
| `op`, `value` | `COUNT` only; `op` ∈ `== != > >= < <=`, default `>=`; non-negative integer `value` required |

`issueMode` is forbidden for `COUNT`: its failure always creates one summary issue.
Legacy `EACH`, `MIN`, and `MAX` are not `mode` values in version 1. `[D29]`

**Population and `SKIP` for `ALL`/`ANY`/`COUNT`.** These three modes evaluate as
follows:

1. Resolve the wildcard to a structural match list.
2. If the list is empty, take the outcome from `onEmpty`.
3. Evaluate **every** structural match sequentially in wildcard enumeration order.
   `ALL`, `ANY`, and `COUNT` never short-circuit, even after their logical result is
   already determined. An operator fault or contract violation at any match aborts the
   whole evaluation. Exclude `SKIP` from the effective population. `matched` is
   structural size, `evaluated` is `PASS`+`FAIL`, and `skipped` is `SKIP` count.
4. If structural matches existed but all outcomes were `SKIP`, the whole rule is
   `SKIP`, regardless of `onEmpty`.
5. Otherwise evaluate the aggregate over the effective population.

Thus `onEmpty` means no structural matches, not no computable outcomes.

| mode | PASS when |
| --- | --- |
| `ALL` | every evaluated element is `PASS` |
| `ANY` | at least one evaluated element is `PASS` |
| `COUNT` | the number of `PASS` outcomes satisfies `op value` |

Issues are possible only for final aggregate `FAIL`: `ALL + EACH` reports each
`FAIL`; `ANY + EACH` reports each `FAIL` only when no element passed;
`ALL/ANY + SUMMARY`, `COUNT`, and `onEmpty: "FAIL"` produce one
summary issue. `SKIP` elements never produce issues, and a successful `ANY` emits no
partial issues. One aggregate rule evaluation is atomic for issue production: all of
that rule's `EACH` issues are materialized in wildcard order before §5.6 applies their
levels. Thus multiple `EXCEPTION` issues from one aggregate rule are all retained, and
then execution stops before the next step.

## 4. Artifact formats

### 4.1 Common artifact rules

`snapshot.artifacts` is an object whose member name is the artifact id and whose value
is the artifact object. Every artifact value MUST have:

| Field | Type | Constraint |
| --- | --- | --- |
| `type` | string | one of `"rule"`, `"condition"`, `"pipeline"`, `"dictionary"` |

A snapshot containing an artifact violating these rules is **invalid** (§4.10). An
artifact value has no `id` field: its id is the non-empty member name in `artifacts`,
and uniqueness follows from the I-JSON unique-member rule (§2.1). Unknown fields on an artifact make it invalid
(closed schemas; this keeps typos loud and reserves the namespace for future spec
versions). `description` is not part of the executable format: titles, explanations,
folders, tags, ownership, and project metadata belong to the authoring layer and do
not affect `sourceHash`. `[DR-II][D21]`

### 4.2 Identifiers

An `id` is an opaque non-empty string compared by exact, case-sensitive equality of
its Unicode sequence. Dots, slashes, and other characters create no hierarchy and do
not affect addressing. There are no reserved prefixes: `library.*`, `internal.*`, and
`entrypoints.*`, when used by authoring tools, are ordinary id text with no normative
meaning. `[D21]`

All ids are globally unique within a snapshot because they are object member names.
Artifact ownership, folders, visibility
scopes, local names, orphan scopes, and longest-prefix ownership do not exist in the
executable model.

### 4.3 Reference resolution

Every reference string `r` in a step, a `when` expression, or a dictionary reference
means exactly `snapshot.artifacts[r]`. There is no relative expansion, import
alias, or dependency on the use site. A missing reference or one targeting the wrong
artifact type for its position makes the snapshot invalid.

Imports, aliases, and id-conflict resolution happen in the builder before snapshot
creation. The normative snapshot already contains a closed graph of exact references.

### 4.4 Artifact: `rule`

Fields in addition to §4.1:

| Field | Required | Constraint |
| --- | --- | --- |
| `operator` | yes | non-empty string naming a built-in (§3.2) or registered custom operator (§4.9) |
| `field` | per operator | §2.7 path; unused by `any_filled` |
| `fields` | `any_filled` only | non-empty path array; forbidden for custom operators |
| `inputs` | per operator | closed object of operator-declared names to non-wildcard §2.7 paths `[D27]` |
| `value`, `value_field`, `dictionary` | per operator | Part I; `value` and `value_field` are mutually exclusive; `value_field` contains no `[*]`; `dictionary` is an exact dictionary id |
| `params` | per operator | constant JSON object valid under the operator's closed schema `[D24][D27]` |
| `aggregate` | when `field` contains `[*]` | §3.6; forbidden without wildcard |
| `issue` | optional | issue description for `FAIL` at a rule step |

The closed `issue` object has this shape:

```json
{
  "level": "WARNING | ERROR | EXCEPTION",
  "code": "non-empty string",
  "message": "non-empty string",
  "meta": { "optional": "any JSON object" }
}
```

`level`, `code`, and `message` are required together. `code` is unique among all
rules with `issue` in the snapshot. Optional `issue.meta` is the sole open authored
object in the executable graph. It participates in `sourceHash` and is passed through
verbatim to issues, so it does not weaken determinism. Top-level rule fields `role`,
`level`, `code`, `message`, and `meta` do not exist in fv2. `[D19][D28]`

A rule without `issue` is a complete condition and MAY be used in `when`. A rule
step MUST reference a rule with `issue`, otherwise the snapshot is invalid. A rule
with `issue` MAY be used both in steps and in `when`; `when` ignores `issue`.

**Operator schemas and invocation.** Every built-in and custom operator has the §3.1
compile-time contract. Unknown standard operands, unknown/missing `inputs` names, an
invalid input path, or invalid `params` reject the snapshot. Omit `params` when the
operator has no settings; an operator with required settings requires it. Required
`inputs` names MUST be present in the artifact, but the referenced runtime paths MAY be
absent; §3.1 defines the resulting invocation. The concrete
registration API and schema language are implementation choices, but a cross-runtime
operator pack MUST publish equivalent machine-readable contracts for every runtime.

`params` contains constants only. Strings inside it are not references and create no
graph edges. All runtime dependencies use `field`, `fields`, `value_field`, `inputs`, or
`dictionary`; the core resolves them and passes values, not paths or raw input documents.

### 4.5 Artifact: `condition`

| Field | Required | Constraint |
| --- | --- | --- |
| `when` | yes | when expression |
| `steps` | yes | non-empty array of exact artifact ids (§4.8) |

A when expression is one of:

```text
"rule_ref"
{ "all": [ <when-expression>, … ] }
{ "any": [ <when-expression>, … ] }
{ "not": <when-expression> }
```

An object form is closed and contains exactly one of `all`, `any`, or `not`.
`all`/`any` arrays MUST be non-empty. Every leaf references any valid `rule`;
presence and level of `rule.issue` are irrelevant. A reference to a condition,
pipeline, or dictionary makes the snapshot invalid. Semantics are in §5.4. `[D19]`

### 4.6 Artifact: `pipeline`

| Field | Required | Constraint |
| --- | --- | --- |
| `steps` | yes | non-empty array of exact artifact ids (§4.8) |

Public entry points are listed centrally in `exports` (§4.9). Pipeline fields
`flow`, `strict`, `message`, `strictCode`, and `entrypoint` do not exist. `[D26][D29]`

**No context-requirement field.** `[D14]` Pipelines declare no `required_context` (an
unknown field under closed schemas). Whether the runtime context is complete
is the analyst's explicit decision, expressed as ordinary rules on `$context.*` paths —
e.g. a `not_empty` rule on `$context.currentDate` with the `issue` object chosen by
the analyst — placed where the analyst wants the guarantee (typically
first in an exported pipeline's `steps`). Note the interaction with skip semantics `[D13]`:
value checks against an absent `$context.*` operand are skipped, so a scenario that
depends on context MUST guard it explicitly if absence should be an error.

**Control-flow DAG.** `[D21]` Nodes are all pipeline and condition artifacts. Every
step whose target is a pipeline or condition creates an edge. This combined graph MUST
be acyclic, forbidding both
condition → condition and mixed pipeline → condition → pipeline cycles. Rule leaves in
`when` and dictionary references do not belong to the control-flow DAG.

### 4.7 Artifact: `dictionary`

| Field | Required | Constraint |
| --- | --- | --- |
| `entries` | yes | non-empty array of unique scalar strings, numbers, or booleans |

`null`, arrays, objects, and duplicates under §2.4 equality are invalid. Matching
semantics are defined in §3.5.

### 4.8 Steps

A step is a non-empty string containing an exact artifact id. The target's `type`
determines whether the runtime evaluates a rule, condition, or pipeline. A step targeting
a dictionary is invalid. A rule target without `issue` is invalid because a `FAIL` would
lack normative issue data. Step objects and `stepId` do not exist. `[D19][D26]`

### 4.9 Snapshot format (`formatVersion: 2`)

A snapshot is the unit of distribution and the unit of conformance. `[D11]`

```json
{
  "format": "jsonspecs-snapshot",
  "formatVersion": 2,
  "specVersion": "1.0.0-rc.5",
  "sourceHash": "<64 lowercase hex chars>",
  "exports": ["credit.application"],
  "artifacts": {
    "credit.application": {
      "type": "pipeline",
      "steps": ["customer.name.required"]
    },
    "customer.name.required": {
      "type": "rule",
      "operator": "not_empty",
      "field": "customer.name",
      "issue": { "level": "ERROR", "code": "NAME.REQUIRED", "message": "Name is required" }
    }
  }
}
```

| Field | Required | Constraint |
| --- | --- | --- |
| `format` | yes | exactly `"jsonspecs-snapshot"` |
| `formatVersion` | yes | exactly `2` (integer) |
| `specVersion` | yes | full SemVer 2.0.0 version of this specification the snapshot targets (prereleases included: an rc-suite pins rc versions) |
| `sourceHash` | yes | SHA-256, lowercase hex, over the snapshot with this field omitted, using RFC 8785 (JCS) `[D6][D28]` |
| `exports` | yes | non-empty array of unique exact pipeline ids, strictly sorted by unsigned UTF-16 code units; bundle public API and closure roots `[D21][D28]` |
| `artifacts` | yes | non-empty object from globally unique id to artifact value `[D26]` |

The snapshot envelope is closed: no other top-level fields exist. In particular,
`requires` and snapshot-level `meta` do not exist. `rule.issue.meta` remains allowed by
§4.4 and is hashed as ordinary artifact content.

**Normative `sourceHash`.** `[D28]` Remove only the `sourceHash` member from the parsed
snapshot, serialize the remaining object using RFC 8785 JCS, UTF-8 encode it, and hash
those bytes with SHA-256. No other projection or normalization occurs. In particular,
the verifier MUST reject an unsorted `exports` array rather than sorting it before
verification.

JCS string ordering is lexicographic over raw, unescaped **unsigned UTF-16 code units**,
independent of locale. This applies recursively to object member names, including
artifact ids. Consequently U+10000 (`D800 DC00`) sorts before U+E000. Arrays retain
their authored order; requiring canonical `exports` is what makes its set-like meaning
compatible with hashing.

**Version acceptance.** An implementation declares the exact range of `specVersion`
values it supports and MUST reject any snapshot whose `specVersion` falls outside that
declaration — anything weaker lets two implementations accept different snapshot sets,
defeating the purpose. Prerelease identifiers compare by SemVer precedence. `[DR-IV]`
The snapshot pins the behavior contract (`specVersion`), never an implementation version.

**Operator closure.** The required custom-operator set is derived exactly as all operator
names used by reachable rules minus the built-in names in §3.2. There is no declared
duplicate list. An implementation that does not provide every derived custom operator
MUST reject the snapshot before evaluation with `OPERATOR_NOT_FOUND`. `[D10][D26]`

**Complete artifact closure.** `[D21]` Build a reachability graph rooted at every
`exports` id. Pipeline and condition `steps` create edges; condition `when`
leaves create rule edges; a rule's normative `dictionary` field creates a dictionary
edge. Reachable ids MUST equal the full `artifacts` id set exactly: an unreachable rule,
condition, pipeline, or dictionary makes the snapshot invalid. An authoring project MAY
retain unused files; a production snapshot does not.

### 4.10 The rejection set

A conformant implementation MUST reject — refuse to evaluate any pipeline of — a
snapshot exhibiting any of the following. *When* rejection happens (load, prepare,
first call) is unobservable and unconstrained `[D12]`; *that* it happens before any
evaluation is normative.

1. Violations of the closed snapshot envelope or `exports` schema:
   wrong `format`/`formatVersion`, malformed or unsupported `specVersion`,
   missing/malformed `sourceHash`, empty/duplicate or mistyped exports, or a hash that
   does not equal §4.9.
2. Any artifact member name or value violating §4.1 or its type-specific schema
   (§4.4–§4.8), including regex patterns outside §3.4, legacy `flags`, `strict`, `flow`,
   object steps, object dictionary entries, invalid aggregate combinations, or
   `inputs`/`params` rejected by the contract of a registered operator.
3. Duplicate `issue.code` among rules with `issue`.
4. Any unresolved or wrong-typed exact reference (§4.3), including `when` leaves that
   are not rules, dictionary step targets, and rule step targets without `issue`.
5. A cycle in the combined pipeline/condition control-flow DAG (§4.6).
6. A derived custom operator the implementation does not provide. Before assigning the
   normative identifier `OPERATOR_NOT_FOUND`, the implementation MUST complete every
   validation in items 1–5 and 7–8 that does not require the missing operator's contract.
   This includes the core-owned rule schema, global operand constraints, references,
   cycles, closure, depth, numbers, and the contracts of all registered operators. The
   missing operator's accepted-operand set, configured `inputs` names, and `params`
   schema are not available and therefore are not validated. If an independently
   detectable defect coexists with the missing operator, the verdict is an ordinary
   rejection without that identifier.
7. A snapshot exceeding maximum JSON depth (§2.1), or any
   snapshot number token that does not convert to finite binary64 (§2.2).
8. Any artifact unreachable from `exports` under the complete closure in §4.9.

Two conformant implementations MUST agree on membership in this set for every input.
Diagnostic *texts* and *granularity* for rejected snapshots are informative; the verdict
is normative. `[D7]`

---

## 5. Evaluation semantics

### 5.1 Evaluation input and input validation

Evaluation is a pure function of the tuple:

```
(snapshot, pipelineId, payload, context?)
```

Input validation proceeds in the following normative order; the first failure determines
the outcome (an `ABORT` result, Part III), so implementations agree on *which* error is
reported when several apply:

1. **Pipeline selection.** `pipelineId` MUST be a non-empty I-JSON string (a sequence of
   Unicode scalar values); otherwise return `ABORT INVALID_PIPELINE_ID`,
   `details: {"expected":"non-empty string"}`. It MUST
   exactly equal an id in `exports`; an unknown id or an existing internal
   pipeline that is not exported produces `PIPELINE_NOT_FOUND`,
   `details: {"pipelineId":"<given>"}`. Listing exports is diagnostic tooling's job,
   not part of the runtime error. `[D7][D21]`
2. **Container types.** `payload` MUST be a JSON object — otherwise `ABORT` with
   `INVALID_PAYLOAD`, `details: {"expected": "object"}` (this covers `null`, arrays,
   scalars). An omitted `context` is exactly equivalent to `{}`. When supplied,
   `context` MUST be a JSON object — otherwise `INVALID_CONTEXT`, same details.
   Payload is checked before context. `[D27]`
3. **Key scan.** `[D15]` A key is *dangerous* if it is a reserved key (§2.1); a key is
   *invalid* if it is empty (`""`) or contains `.`, `[` or `]`. The scan is top-down
   and does not enter the subtree under a dangerous or invalid key — a violation is
   *visible* only when all its ancestor keys are clean, so its `parentPath` is always
   a well-formed dot path (root = `""`). Among visible violations the precedence is:
   dangerous in payload, dangerous in context, invalid in payload, invalid in
   context; within a class, the lexicographically smallest `(parentPath, key)` pair
   (code-point order, `parentPath` first). Codes: `DANGEROUS_PAYLOAD_KEY`,
   `DANGEROUS_CONTEXT_KEY`, `INVALID_PAYLOAD_KEY`, `INVALID_CONTEXT_KEY`; details:
   `{"parentPath": "…", "key": "…"}`.
4. **Numbers.** Recursively convert every numeric value to binary64 under §2.2.
   Overflow in payload produces `INVALID_PAYLOAD_NUMBER`; overflow in context produces
   `INVALID_CONTEXT_NUMBER`; details are `{"path":"…"}`. Payload precedes context;
   within one document choose the lexicographically smallest path by code point.
   Normalize `-0` to `0`.
5. **Depth.** §2.1 depth of payload ≤ 256 — otherwise `PAYLOAD_TOO_DEEP`,
   `details: {"maxDepth": 256}`; likewise context — `CONTEXT_TOO_DEEP`.

All input-validation failures are `ABORT` (the evaluation could not be performed).
There is no separate required-context phase `[D14]`: context completeness is checked by
ordinary rules, inside `steps`, like everything else. Payload flattening (§2.7) is not
a validation step: any JSON object is flattenable.

### 5.2 Execution order

The selected pipeline's `steps` execute sequentially. A condition target whose guard is
true executes its `steps` sequentially in place; a `pipeline` step executes the
referenced pipeline's `steps` in place. The resulting order of rule evaluations is the
depth-first, left-to-right traversal of the step tree — *document order*. Issues appear
in the result in document order; within one rule evaluation, per-element issues follow
wildcard enumeration order (§3.6.1). `[D5]`

Implementations MUST NOT reorder, parallelize, or deduplicate observable effects in any
way that changes the normative result. (Internal parallelism is permitted if the result
is indistinguishable.)

### 5.3 Rule steps

A rule step evaluates its rule per Part I. `PASS` and `SKIP` have no normative
effect. `FAIL` creates an issue from `rule.issue` and runtime facts: concrete
`field`, `ruleId`, immediately enclosing `pipelineId`, `expected`/`actual`, and group
`details` per Part III. `[D19]`

The created issue level controls flow per §5.6. An operator cannot change the rule's
level, code, or message.

### 5.4 Condition steps

A `when` leaf evaluates a rule and maps `PASS` to `true`, and `FAIL`/`SKIP` to
`false`. Object expressions evaluate normatively left-to-right with short-circuit
`[D22]`:

- `all` stops at the first `false`; if none occurs, it returns `true`;
- `any` stops at the first `true`; if none occurs, it returns `false`;
- `not` evaluates its single child and negates that boolean.

`when` never creates issues and ignores `rule.issue`, including
`level: "EXCEPTION"`. Leaves skipped by short-circuit do not invoke their operators
and cannot produce `ABORT`. A thrown exception or contract violation in an
actually evaluated leaf causes site-independent `ABORT` (§3.1, §6.7). Therefore
`any(PASS, throw) → true`, `all(FAIL, throw) → false`, while `any(FAIL, throw)` and
`all(PASS, throw)` produce `OPERATOR_FAULT`. `[D7][D19][D22]`

When the guard is true, its steps execute in place; otherwise the condition is a no-op.

### 5.5 Pipeline steps

A pipeline target executes its `steps` in place. Issues produced inside it carry the
*inner* pipeline's id as `pipelineId`. Whether that inner pipeline is also listed in
`exports` has no effect when it is invoked as a step.

### 5.6 Levels

| `level` | Issue | Effect on flow | Contribution to `status` |
| --- | --- | --- | --- |
| `WARNING` | created | none | `OK_WITH_WARNINGS` if nothing stronger |
| `ERROR` | created | none — evaluation continues | `ERROR` |
| `EXCEPTION` | created | **entire evaluation stops immediately** — including all outer pipelines' remaining steps | `EXCEPTION` |

Accumulated issues are preserved when evaluation completes normally or stops on an
`EXCEPTION` issue. If evaluation instead reaches technical `ABORT`, all business issues
accumulated earlier in that evaluation are discarded and `issues` is empty (§6.1).
Final `status` and the `ABORT` status are defined in Part III. Pipeline-level strict escalation does not exist in version 1;
business stops are explicit `issue.level: "EXCEPTION"` rules. `[D29]`

---

## 6. Result contract

### 6.1 Result envelope and JSON representation

The result of an evaluation is a closed JSON object:

```json
{
  "status": "OK | OK_WITH_WARNINGS | ERROR | EXCEPTION | ABORT",
  "issues": [ … ],
  "ruleset": { … },
  "error": { … }
}
```

`error` is present exactly when `status` is `ABORT` (and `issues` is then empty).
No other members are allowed. In particular, `control`, `trace`, `engineVersion`, and
implementation-specific diagnostics are not members of this object; an implementation
MAY expose them through a separate API surface outside the normative result.

**Representation rules.** `[D8]` The result is pure JSON. "No value" is expressed by
**omitting the key**, never by `null` — with the single deliberate exception of
`"field": null` on issues that are not attributable to one field (§6.3). Normative
equality between results is **structural JSON equality**: array element order matters;
object key order does not; numbers compare as binary64 values (`1` equals `1.0`);
serialization details (whitespace, escaping style, key order on the wire) are not part
of conformance.

### 6.2 Status

| `status` | Meaning |
| --- | --- |
| `OK` | no issues |
| `OK_WITH_WARNINGS` | only `WARNING` issues |
| `ERROR` | at least one `ERROR` issue, no `EXCEPTION` |
| `EXCEPTION` | at least one `EXCEPTION` issue (§5.6) |
| `ABORT` | evaluation could not be performed (§6.7) |

`status` is fully determined by the strongest issue level present or by abortion.
Applications derive any go/no-go decision from it; a duplicate `control` field does not
exist. `[D30]`

### 6.3 Issues

Every issue is a closed object with the following fields; the "When present" column is
normative — a field that the column excludes MUST be omitted, and no other field is
allowed:

| Field | Type | When present |
| --- | --- | --- |
| `level` | `WARNING \| ERROR \| EXCEPTION` | always |
| `code` | string | always — authored in `rule.issue.code` |
| `message` | string | always — authored in `rule.issue.message`; normative as data passthrough `[D7]` |
| `field` | string or `null` | always; the concrete resolved path for field-scoped issues (for wildcard elements, such as `x[2].v`); the pattern (`x[*].v`) for aggregate summary issues; `null` for every issue without a primary `field` operand, including `any_filled` and custom operators configured only with `inputs` or `params` |
| `ruleId` | string | always; the rule's artifact id (the `artifacts` member name) |
| `pipelineId` | string | always; the immediately enclosing pipeline (§5.5) |
| `expected` | value | per §6.4 |
| `actual` | value | per §6.4; omitted when there is no single actual value |
| `details` | object | group-verdict summary issues only (§6.5); normative machine-readable facts of the issue, mirroring `error.details` on `ABORT` (§6.7) — one contract-wide pattern: `code` identifies the class, `details` carries the class-specific facts |
| `meta` | object | when `rule.issue` declares `meta` (§6.6) |

Issue order in `issues[]` is normative: document order of rule evaluations (§5.2), then
wildcard enumeration order within a rule (§3.6.1).

### 6.4 `expected` and `actual`

| Operator class | `expected` | `actual` |
| --- | --- | --- |
| value comparisons (`equals`, `not_equals`, `contains`, `matches_regex`, `not_matches_regex`, `greater_than`, `less_than`, `length_*`) | the rule's `value` verbatim | the resolved field value |
| type checks (`is_boolean`, `is_string`, `is_number`, `is_integer`) | omitted | the resolved field value |
| `not_empty` | omitted | omitted when absent; the value (`null` or `""`) when present-but-empty — represented as the JSON value, i.e. `"actual": null` is legal here as an actual *value*, distinct from key omission |
| `is_empty`, `not_true` | omitted | the resolved field value |
| dictionary operators | the rule's dictionary id string | the resolved field value |
| `field_*_field` | the resolved **value** of `value_field` `[DR-III]` | the resolved `field` value |
| `any_filled` | omitted | omitted |
| custom operator | literal `value`, or resolved `value_field`, when present; otherwise omitted | resolved primary `field` when present; otherwise omitted |

Resolved `field` and `value_field` operands are scalar or empty-container leaves because
of payload flattening (§2.7). A literal `value`, and therefore `expected`, MAY be any
I-JSON value accepted by the operator contract. No truncation or transport normalization
of `expected` or `actual` is defined or permitted.

### 6.5 Group-verdict summary issues

A summary issue is created on final `FAIL` for `ALL/ANY + SUMMARY`, `COUNT`, or
`onEmpty: "FAIL"`. `[D20]`

| Producer | `details` | `expected` / `actual` |
| --- | --- | --- |
| `ALL`/`ANY`, `issueMode: "SUMMARY"` | `{"mode":"ALL|ANY","matched":<m>,"evaluated":<e>,"skipped":<s>,"passed":<p>,"failed":<f>}` | omitted / omitted |
| `COUNT` failure | `{"mode":"COUNT","op":"…","value":<v>,"matched":<m>,"evaluated":<e>,"skipped":<s>,"passed":<p>,"failed":<f>}` | omitted / omitted |
| `onEmpty: "FAIL"` | `{"mode":"<mode>","matched":0,"evaluated":0,"skipped":0,"passed":0,"failed":0}` | omitted / omitted |

`matched` is structural wildcard match count, `evaluated` is `PASS`+`FAIL`,
`skipped` is `SKIP`, and `passed`/`failed` partition the effective population.
Always `matched = evaluated + skipped` and `evaluated = passed + failed`.

Per-element `EACH` issues are ordinary §6.3–§6.4 issues and never carry `details`.
When `COUNT` reaches `FAIL` through `onEmpty: "FAIL"`, the `onEmpty` row applies:
`details` MUST omit `op` and `value`, because no count comparison was evaluated.

### 6.6 `rule.issue.meta` passthrough

When `rule.issue` declares `meta`, every issue produced by that rule carries it
verbatim. The runtime MUST NOT rewrite it; runtime facts live in `details` or nowhere.
The entire `issue` object, including `meta`, is ignored at a `when` site. This authored
open object is inside the artifact graph and therefore inside `sourceHash`; it is not the
removed snapshot-level `meta`. `[DR-III][D19][D28]`

### 6.7 `ABORT` and the two failure channels

There are two distinct failure channels; conflating them is a conformance error:

**Channel A — snapshot rejection (§4.10).** The snapshot is refused before any
evaluation. The *verdict* is normative; the reporting form (diagnostics list, thrown
error, exit code) is implementation-defined. One rejection cause has a normative
identifier because it is environment-dependent: `OPERATOR_NOT_FOUND` — a derived custom
operator name is not registered by the implementation. `[D10][D26]`

**Channel B — evaluation `ABORT`.** The tuple was accepted for evaluation, but the
evaluation could not be performed. The result carries:

```json
"error": { "code": "…", "message": "…", "details": { … } }
```

The `error` object is closed: it contains required `code` and `details`, plus optional
informative string `message`, and no other members. `code` and `details` are normative;
`message` is informative free text. `[D7]`
The normative code enum and the exact `details` shape per code:

| `code` | When | `details` |
| --- | --- | --- |
| `INVALID_PIPELINE_ID` | §5.1 step 1 | `{"expected":"non-empty string"}` |
| `PIPELINE_NOT_FOUND` | §5.1 step 1 | `{"pipelineId": "<requested>"}` |
| `INVALID_PAYLOAD` | §5.1 step 2 | `{"expected": "object"}` `[DR-IV]` |
| `INVALID_CONTEXT` | §5.1 step 2 | `{"expected": "object"}` `[DR-IV]` |
| `DANGEROUS_PAYLOAD_KEY` / `DANGEROUS_CONTEXT_KEY` | §5.1 step 3 | `{"parentPath": "…", "key": "…"}` — the smallest visible `(parentPath, key)` per §5.1; determinism under any traversal order `[DR-III][D15]` |
| `INVALID_PAYLOAD_KEY` / `INVALID_CONTEXT_KEY` | §5.1 step 3 | `{"parentPath": "…", "key": "…"}` — same selection rule `[D15]` |
| `INVALID_PAYLOAD_NUMBER` / `INVALID_CONTEXT_NUMBER` | §5.1 step 4 | `{"path":"…"}` — lexicographically smallest overflowing path `[D23]` |
| `PAYLOAD_TOO_DEEP` / `CONTEXT_TOO_DEEP` | §5.1 step 5 | `{"maxDepth": 256}` — and nothing else: *which* path first exceeds the limit depends on traversal order, so no path appears in any normative surface (the informative `message` MAY carry one) `[DR-III]` |
| `OPERATOR_FAULT` | an operator implementation threw/panicked during evaluation | `{"ruleId": "…", "operator": "…"}` |
| `OPERATOR_CONTRACT_VIOLATION` | an operator returned a value outside its declared result shape (Part I §3.1) | `{"ruleId": "…", "operator": "…"}` |

The enum is closed for this spec version: implementations MUST NOT emit other codes in
Channel B. Built-in operators never trigger the two `OPERATOR_*` codes; they are
exercised portably through the reserved conformance operators of §7.3.

### 6.8 `ruleset` provenance

```json
"ruleset": {
  "specVersion": "1.0.0-rc.5",
  "sourceHash": "…"
}
```

`ruleset` is closed and contains exactly the two members below.

| Field | Presence | Surface |
| --- | --- | --- |
| `specVersion` | always — echoed from the snapshot | normative `[DR-III]` |
| `sourceHash` | always — echoed from the snapshot | normative |

No project metadata or implementation version is part of the core result. A runtime MAY
expose engine version and tracing through its own API, but neither is a field of the
specified result. `[D28][D30]`

---

## 7. Conformance

### 7.1 Conformance claims

A core conformance claim names: the implementation and version; the supported
`specVersion` range (§4.9); and the set of non-built-in operator names the deployment
provides.
Cross-implementation equality of the normative result is guaranteed **only for
snapshots that use built-in operators exclusively**. `[D17]` Equal operator *names* do
not imply equal *semantics*: for snapshots with custom operators, what is common
across implementations is only the extension contract (§3.1 outcome contract, §6.7
`OPERATOR_*` reactions — both portably testable via the §7.3 conformance operators)
and the parametrization of the rejection set (§4.10) through the custom names derived
from reachable rules — the same snapshot may legitimately be accepted by a deployment providing `valid_inn`
and rejected (`OPERATOR_NOT_FOUND`) by one that does not. The business behavior of a
custom operator is the promise of its package, not of this specification. For
snapshots using only built-in operators, conformance is unconditional. `[D10]`

**Cross-runtime operator-pack profile.** A deployment or package MUST NOT claim equal
business behavior for a custom operator across runtimes merely because the registered
names match. Such a claim requires a separately versioned operator-pack contract that:

1. assigns an immutable package identifier and semantic version to the operator set;
2. declares the supported core `specVersion` range and publishes equivalent closed
   compile-time contracts for every supported runtime;
3. defines operator semantics and runs one shared set of normative golden vectors against
   every implementation;
4. treats any behavior or contract change as a new package version (or a new operator
   name when coexistence is required); and
5. records the package identifier and version plus an algorithm-tagged immutable digest
   (for example `sha256:<lowercase hex>`) of each deployed runtime distribution in the
   deployment manifest and audit telemetry.

This profile does not add fields to the snapshot or to `ruleset`: deployment provenance
is a property of the application assembly, while `sourceHash` identifies only the rules
snapshot. Core conformance and operator-pack conformance are separate claims; a banking
process using custom operators needs both for end-to-end cross-runtime equivalence.

### 7.2 The normative projection

Conformance compares the *normative projection* of behavior:

1. the snapshot verdict: accepted or rejected (§4.10), plus the `OPERATOR_NOT_FOUND`
   identifier where applicable;
2. for accepted snapshots and each evaluation tuple: `status`, `issues[]` in full
   (every field of §6.3, in order), `error.code` + `error.details`, and `ruleset`.

Excluded from comparison: `error.message`, rejection diagnostic texts and granularity,
and data exposed through implementation APIs outside the result object. Extra members
inside the closed result, issue, error, or ruleset objects are a conformance failure.
Comparison is structural (§6.1).

### 7.3 Conformance fixtures

The `fixtures/` tree of the `jsonspecs/spec` repository is a **normative appendix**:
text and fixtures version together, atomically, under one tag. Three fixture kinds:

```json
// evaluation fixture
{
  "name": "d2/length-surrogate-pair-counts-as-one",
  "snapshot": { … },
  "operators": ["…"],            // registered set for this fixture, default []
  "input": { "pipelineId": "p", "payload": { … }, "context": { … } },
  "expected": {
    "status": "…",
    "issues": [ … ],
    "ruleset": { "specVersion": "…", "sourceHash": "…" }
  }
}

// rejection fixture
{
  "name": "regex/lookahead-rejected",
  "snapshot": { … },
  "operators": [],
  "expected": { "verdict": "reject", "identifier": "OPERATOR_NOT_FOUND"? }
}

// raw I-JSON rejection fixture
{
  "name": "d28/reject-duplicate-member",
  "snapshotText": "{ …raw JSON text… }",
  "operators": [],
  "expected": { "verdict": "reject" }
}
```

A runner executes every fixture against the implementation and compares the normative
projection structurally. Passing the complete suite of version X is a **necessary
condition** of a conformance claim for X — not a sufficient one: the suite samples the
behavior space, the text defines it. `[DR-IV]` If a fixture contradicts the text, the
text prevails; the fixture is corrected through an erratum and a new suite version —
fixtures never silently redefine the text. Fixtures are organized by the decision or
section they pin; every decision D1–D30 MUST be covered by at least one fixture.

**Reserved conformance operators.** `[DR-IV]` The following operator names are
reserved. They are registered **only by conformance runners** as part of the test
harness — never by production runtimes — and each implementation adapts them to its
own registration API. Their pinned behavior when invoked:

| Name | Behavior | Expected reaction |
| --- | --- | --- |
| `conformance.rule.throw` | accepts no standard operands, `inputs`, or `params`; its invocation is `{}`; throws a host exception | `ABORT OPERATOR_FAULT` at either site |
| `conformance.rule.invalid_result` | accepts no standard operands, `inputs`, or `params`; its invocation is `{}`; returns `EXCEPTION`, outside the enum | `ABORT OPERATOR_CONTRACT_VIOLATION` at either site |
| `conformance.rule.tri` | requires only `field`; for present values `"PASS"`, `"SKIP"`, and `"FAIL"`, returns the same-named outcome; for `"THROW"`, throws a host exception; every other present value returns `FAIL`; absent `field` receives core-level `SKIP` | pins mixed aggregate populations and exhaustive aggregate evaluation |
| `conformance.rule.params` | accepts no standard operands or `inputs`; requires the closed params object `{ "outcome": "PASS" | "FAIL" | "SKIP" }` and returns that outcome | pins compile-time custom-parameter schema validation, verbatim delivery, and no-field issue attribution |
| `conformance.rule.inputs` | accepts no standard operands or `params`; requires the artifact's closed `inputs` object to contain exactly configured names `missing` and `nullValue`; it is invoked even when either path is absent and returns `PASS` only when the resolved invocation omits `missing` and contains `nullValue: null`; otherwise `FAIL` | pins core path resolution and absent-vs-null representation |

### 7.4 Requirements summary

A conformant implementation:

- MUST accept and reject exactly the §4.10 set, relative to its registered operators;
- MUST produce an identical normative projection for every evaluation tuple;
- MUST pass the complete fixture suite of the claimed spec version;
- MUST NOT require any input, flag, or mode beyond the evaluation tuple to achieve the
  above (conformance is the default behavior, not an opt-in);
- MAY do anything not observable through the normative projection: compile or
  interpret, cache, parallelize, expose tracing, expose any API. `[D12]`

### 7.5 Out of scope

Restating the boundary in one place: APIs and function signatures; the moment of
validation; compilation strategy and diagnostics beyond the verdict; performance and
resource limits above the normative ones (§2.1, §3.4.2); transport-level truncation of
results; custom operator business behavior `[D10]`; tracing and implementation-version
reporting; and legacy surfaces of the
prototype (`engine.minVersion`, `paths[]`, `payload.__context`, `required_context`)
`[D11][D14]`.

---
