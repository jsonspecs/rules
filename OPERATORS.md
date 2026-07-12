# Operators Reference

[На русском языке](./OPERATORS_RU.md).

Full reference for all built-in operators in `jsonspecs`, plus a guide for writing your own.

## Built-in operators

Each operator can be used as a **check** (in a `rule` with `"role": "check"`) or as a
**predicate** (in a `rule` with `"role": "predicate"`, used inside `condition` artifacts).

- **Check** produces an issue when it fails.
- **Predicate** returns `true` or `false` and produces no issues it only controls
  whether a conditional block runs.

Operators marked `check only` have no predicate variant.

### `not_empty`

Field must be present and non-empty. Fails if the field is absent, `null`, or an empty string.

```json
{
  "id": "library.person.first_name_required",
  "type": "rule",
  "description": "First name must be filled",
  "role": "check",
  "operator": "not_empty",
  "level": "ERROR",
  "code": "PERSON.FIRST_NAME.REQUIRED",
  "message": "First name is required",
  "field": "person.firstName"
}
```

### `is_empty`

Field must be absent, `null`, or empty string.

```json
{
  "id": "library.doc.expire_date_must_be_absent",
  "type": "rule",
  "description": "Expiry date must not be set for this document type",
  "role": "check",
  "operator": "is_empty",
  "level": "ERROR",
  "code": "DOC.EXPIRE_DATE.UNEXPECTED",
  "message": "Expiry date must not be set for permanent documents",
  "field": "document.expireDate"
}
```

### `equals`

Field must equal the given `value`.

```json
{
  "id": "library.order.currency_rub",
  "type": "rule",
  "description": "Currency must be RUB",
  "role": "check",
  "operator": "equals",
  "level": "ERROR",
  "code": "ORDER.CURRENCY.WRONG",
  "message": "Only RUB currency is supported",
  "field": "order.currency",
  "value": "RUB"
}
```

### `not_equals`

Field must not equal the given `value`.

```json
{
  "id": "library.person.citizenship_not_us",
  "type": "rule",
  "description": "Citizenship must not be US",
  "role": "check",
  "operator": "not_equals",
  "level": "EXCEPTION",
  "code": "PERSON.CITIZENSHIP.BLOCKED",
  "message": "US citizenship is not accepted",
  "field": "person.citizenshipCode",
  "value": "US"
}
```

### `matches_regex`

Field must match the given regular expression. Optional `flags` are passed to `RegExp` and validated at compile time together with the pattern.

```json
{
  "id": "library.person.last_name_format",
  "type": "rule",
  "description": "Last name must contain only letters and hyphens",
  "role": "check",
  "operator": "matches_regex",
  "level": "ERROR",
  "code": "PERSON.LAST_NAME.FORMAT",
  "message": "Last name must contain only Cyrillic letters",
  "field": "person.lastName",
  "value": "^[A-Za-z\\-]+$",
  "flags": "i"
}
```

Use `\\\\` in JSON strings where you need a literal backslash in the regex (e.g. `^\\d{6}$`).

### `length_equals` _(check only)_

String or array length must equal exactly `value`.

```json
{
  "id": "library.address.postal_code_length",
  "type": "rule",
  "description": "Postal code must be exactly 6 digits",
  "role": "check",
  "operator": "length_equals",
  "level": "ERROR",
  "code": "ADDR.POSTAL.LENGTH",
  "message": "Postal code must be 6 characters",
  "field": "address.postalCode",
  "value": 6
}
```

### `length_max` _(check only)_

String or array length must be ≤ `value`.

```json
{
  "id": "library.person.name_length",
  "type": "rule",
  "description": "First name must not exceed 50 characters",
  "role": "check",
  "operator": "length_max",
  "level": "ERROR",
  "code": "PERSON.FIRST_NAME.TOO_LONG",
  "message": "First name must not exceed 50 characters",
  "field": "person.firstName",
  "value": 50
}
```

### `contains`

String must contain the given substring.

```json
{
  "id": "library.contact.email_has_at",
  "type": "rule",
  "description": "Email must contain @",
  "role": "check",
  "operator": "contains",
  "level": "WARNING",
  "code": "CONTACT.EMAIL.FORMAT",
  "message": "Email address looks invalid",
  "field": "contact.email",
  "value": "@"
}
```

### `greater_than`

Field must be greater than `value` (numeric comparison).

```json
{
  "id": "library.order.amount_positive",
  "type": "rule",
  "description": "Order amount must be positive",
  "role": "check",
  "operator": "greater_than",
  "level": "ERROR",
  "code": "ORDER.AMOUNT.NOT_POSITIVE",
  "message": "Order amount must be greater than 0",
  "field": "order.amount",
  "value": 0
}
```

### `less_than`

Field must be less than `value` (numeric comparison).

```json
{
  "id": "library.order.quantity_cap",
  "type": "rule",
  "description": "Quantity must be less than 10000",
  "role": "check",
  "operator": "less_than",
  "level": "ERROR",
  "code": "ORDER.QTY.TOO_HIGH",
  "message": "Quantity must be less than 10000",
  "field": "order.quantity",
  "value": 10000
}
```

### `in_dictionary`

Field value must be in the named dictionary's `entries` list.

Rule:

```json
{
  "id": "library.doc.type_code_allowed",
  "type": "rule",
  "description": "Document type code must be in the allowed list",
  "role": "check",
  "operator": "in_dictionary",
  "level": "ERROR",
  "code": "DOC.TYPE_CODE.UNKNOWN",
  "message": "Document type code is not in the allowed list",
  "field": "document.typeCode",
  "dictionary": {
    "type": "static",
    "id": "document_type_codes"
  }
}
```

Dictionary artifact:

```json
{
  "id": "document_type_codes",
  "type": "dictionary",
  "description": "Allowed document type codes",
  "entries": ["21", "22", "31", "32", "36"]
}
```

### `any_filled` _(check only)_

At least one field from the `fields` list must be non-empty.

```json
{
  "id": "library.contact.at_least_one",
  "type": "rule",
  "description": "At least one contact method must be provided",
  "role": "check",
  "operator": "any_filled",
  "level": "ERROR",
  "code": "CONTACT.MIN_ONE",
  "message": "Provide at least one contact: phone, email, or postal address",
  "fields": ["contact.phone", "contact.email", "contact.postalAddress"],
  "field": "contact.phone"
}
```

`any_filled` also supports grouped wildcard fields. When all fields share the same
wildcard base, the runtime evaluates the requirement per materialized group:

```json
{
  "id": "library.items.tin_or_reason",
  "type": "rule",
  "description": "Each item must have TIN or absence reason",
  "role": "check",
  "operator": "any_filled",
  "level": "ERROR",
  "code": "ITEM.TIN_OR_REASON",
  "message": "Provide TIN or absence reason for every item",
  "fields": ["items[*].tin", "items[*].absenceReason"]
}
```

For nested arrays the grouping follows the full wildcard path, for example
`accounts[*].transactions[*].amount` is grouped per materialized transaction.

### `field_equals_field`

Two fields must have equal values. Both `field` and `value_field` support `$context.*`.

```json
{
  "id": "library.account.confirm_password",
  "type": "rule",
  "description": "Password and confirmation must match",
  "role": "check",
  "operator": "field_equals_field",
  "level": "ERROR",
  "code": "ACCOUNT.PASSWORD.MISMATCH",
  "message": "Password and confirmation do not match",
  "field": "account.password",
  "value_field": "account.passwordConfirm"
}
```

### `field_not_equals_field`

Two fields must have different values.

### `field_less_than_field`

`field` must be strictly less than `value_field`. Supports date strings (`YYYY-MM-DD`)
and numbers. Supports `$context.*` on either side.

```json
{
  "id": "library.doc.issue_date_not_future",
  "type": "rule",
  "description": "Document issue date must not be in the future",
  "role": "check",
  "operator": "field_less_or_equal_than_field",
  "level": "ERROR",
  "code": "DOC.ISSUE_DATE.FUTURE",
  "message": "Document issue date must not be in the future",
  "field": "document.issueDate",
  "value_field": "$context.currentDate"
}
```

### `field_greater_than_field`

`field` must be strictly greater than `value_field`.

### `field_less_or_equal_than_field`

`field` must be ≤ `value_field`.

### `field_greater_or_equal_than_field`

`field` must be ≥ `value_field`.

## Writing custom operators

### Operator signature

A **check operator** is a function `(rule, ctx) → result`:

```js
function myCheckOperator(rule, ctx) {
  // rule  the artifact object: { field, value, operator, level, code, ... }
  // ctx   runtime context:
  //           ctx.payload            flat map of all payload fields
  //           ctx.get(path)          reads a field from the flat payload map
  //           ctx.has(path)          checks whether a field is present
  //           ctx.getDictionary(id)  looks up a dictionary by id
  //           ctx.payloadKeys        all keys present in the payload
  //           ctx.wildcardCache      Map for wildcard expansion caching

  return { status: "OK" }; // check passed
  return { status: "FAIL", actual: v }; // check failed; actual = value that failed
  return { status: "EXCEPTION", error: e }; // hard runtime error
}
```

A **predicate operator** is the same signature, different return values:

```js
function myPredicateOperator(rule, ctx) {
  return { status: "TRUE" }; // condition is met
  return { status: "FALSE" }; // condition is not met
  return { status: "UNDEFINED" }; // field absent engine treats as FALSE
  return { status: "EXCEPTION", error: e };
}
```

### Preferred field access: `ctx.get()` / `ctx.has()`

`ctx.get(path)` is the preferred contract for new custom operators. It returns the same shape as `deepGet`: `{ ok, value }`, including support for `$context.*` fields.

```js
module.exports = function myOperator(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL" };
  return { status: got.value ? "OK" : "FAIL", actual: got.value };
};
```

Use `ctx.has(path)` when you only need presence/absence.

### Using `deepGet`

`deepGet` remains available for backward compatibility and advanced use cases. Import it from `jsonspecs` when you explicitly need the helper:

```js
const { deepGet } = require("jsonspecs");

function myOperator(rule, ctx) {
  const got = deepGet(ctx.payload, rule.field);
  //   got.ok    true if the field exists
  //   got.value the field's value (may be null/undefined if ok is false)

  if (!got.ok) return { status: "FAIL" };
  // ... check got.value
}
```

`deepGet` also handles `$context.*` fields automatically:

```js
deepGet(ctx.payload, "$context.currentDate");
// { ok: true, value: "2026-03-27" }
```

### Full example date not in the past

```js
const { createEngine, Operators } = require("jsonspecs");

const myOperators = {
  check: {
    ...Operators.check,

    // Checks that a date field is today or in the future (>= context date)
    date_not_in_past(rule, ctx) {
      const got = ctx.get(rule.field);
      if (!got.ok || !got.value) return { status: "FAIL", actual: null };

      const fieldDate = new Date(got.value);
      const contextDate = ctx.get("$context.currentDate");
      const today = new Date(contextDate.ok ? contextDate.value : new Date().toISOString().slice(0, 10));

      if (isNaN(fieldDate.getTime()))
        return { status: "FAIL", actual: got.value };
      return {
        status: fieldDate >= today ? "OK" : "FAIL",
        actual: got.value,
      };
    },
  },
  predicate: {
    ...Operators.predicate,
  },
};

const engine = createEngine({ operators: myOperators });
```

Corresponding rule artifact:

```json
{
  "id": "library.contract.start_date_not_past",
  "type": "rule",
  "description": "Contract start date must not be in the past",
  "role": "check",
  "operator": "date_not_in_past",
  "level": "ERROR",
  "code": "CONTRACT.START_DATE.IN_PAST",
  "message": "Contract start date must be today or in the future",
  "field": "contract.startDate"
}
```

### Adding a predicate variant

If you want to use your operator as a `when` condition guard as well, add it to both `check` and `predicate`:

```js
function dateNotInPastImpl(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok || !got.value) return null; // null = absent
  const fieldDate = new Date(got.value);
  const contextDate = ctx.get("$context.currentDate");
  const today = new Date(contextDate.ok ? contextDate.value : new Date().toISOString().slice(0, 10));
  if (isNaN(fieldDate.getTime())) return false;
  return fieldDate >= today;
}

const myOperators = {
  check: {
    ...Operators.check,
    date_not_in_past(rule, ctx) {
      const ok = dateNotInPastImpl(rule, ctx);
      if (ok === null) return { status: "FAIL", actual: null };
      return { status: ok ? "OK" : "FAIL" };
    },
  },
  predicate: {
    ...Operators.predicate,
    date_not_in_past(rule, ctx) {
      const ok = dateNotInPastImpl(rule, ctx);
      if (ok === null) return { status: "UNDEFINED" };
      return { status: ok ? "TRUE" : "FALSE" };
    },
  },
};
```

### Handling `rule.value` and `rule.value_field`

For operators that take a parameter, read it from `rule.value` (scalar) or `rule.value_field` (another payload field):

```js
// Operator: field must equal one of several allowed values
function in_list(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL" };
  const allowed = Array.isArray(rule.value) ? rule.value : [rule.value];
  return {
    status: allowed.includes(got.value) ? "OK" : "FAIL",
    actual: got.value,
  };
}
```

### Registration

Simply spread your custom operators over the built-in pack and pass to `createEngine`:

```js
const engine = createEngine({
  operators: {
    check: { ...Operators.check, date_not_in_past, in_list },
    predicate: {
      ...Operators.predicate,
      date_not_in_past: dateNotInPastPredicate,
    },
  },
});
```

The compiler validates that every operator referenced in rule artifacts is present in the
pack so if you reference `date_not_in_past` in a rule and forget to register it, you
get a clear `CompilationError`, not a runtime failure.
