# Operators

## Built-ins

Presence: `not_empty`, `is_empty`, `not_true`, `any_filled`.

Types and values: `is_boolean`, `is_string`, `is_number`, `is_integer`, `equals`,
`not_equals`, `contains`, `length_equals`, `length_max`.

Ordered comparison: `greater_than`, `less_than`, `field_equals_field`,
`field_not_equals_field`, `field_greater_than_field`, `field_less_than_field`,
`field_greater_or_equal_than_field`, `field_less_or_equal_than_field`.

Patterns and dictionaries: `matches_regex`, `not_matches_regex`, `in_dictionary`,
`not_in_dictionary`.

Exact operand schemas and semantics are normative in `SPEC.md` §3.

## External definition

```ts
interface OperatorDefinition {
  readonly schema: JSONSchemaDraft07;
  readonly evaluate: (invocation: Readonly<Record<string, JSONValue>>) => "PASS" | "FAIL" | "SKIP";
}
```

`schema` validates a closed object containing only the configured operator operands:
`field`, `value`, `value_field`, `dictionary`, `inputs`, or `params`. `fields` is
reserved for built-in `any_filled`. The engine separately validates every path and
resolves it before invocation.

Invocation keys hold values, not authored paths. A missing configured `field` or
`value_field` produces core-level `SKIP` without calling a value operator. A missing
named input omits that member from `invocation.inputs`; JSON `null` remains a present
member with value `null`.

Operator functions must be synchronous and deterministic. They must not read time,
locale, network, process globals, or mutate inputs. Cross-runtime operator packs
publish equivalent schemas and shared golden vectors as required by `SPEC.md` §7.1.

`builtInOperators` exposes deeply frozen definitions for inspection. Neither their
schemas nor nested schema members can be changed by consumers.
