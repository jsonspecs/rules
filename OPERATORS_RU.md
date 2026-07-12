# Справочник операторов

Полный справочник всех встроенных операторов в `jsonspecs`, а также руководство по написанию собственных.

## Встроенные операторы

Каждый оператор может использоваться как **check** (в артефакте `rule` с `"role": "check"`) или как **predicate** (в артефакте `rule` с `"role": "predicate"`, используемом внутри артефактов `condition`).

- **Check** создаёт issue, если проверка не пройдена.
- **Predicate** возвращает `true` или `false` и не создаёт issue он только управляет тем, будет ли выполнен условный блок.

Операторы с пометкой `check only` не имеют predicate-варианта.

### not_empty

Поле должно присутствовать и быть непустым. Проверка не проходит, если поле отсутствует, равно `null` или пустой строке.

```json
{
  "id": "library.person.first_name_required",
  "type": "rule",
  "description": "Имя должно быть заполнено",
  "role": "check",
  "operator": "not_empty",
  "level": "ERROR",
  "code": "PERSON.FIRST_NAME.REQUIRED",
  "message": "Необходимо указать имя",
  "field": "person.firstName"
}
```

### `is_empty`

Поле должно отсутствовать, быть равно `null` или пустой строке.

```json
{
  "id": "library.doc.expire_date_must_be_absent",
  "type": "rule",
  "description": "Для этого типа документа дата окончания действия не должна быть заполнена",
  "role": "check",
  "operator": "is_empty",
  "level": "ERROR",
  "code": "DOC.EXPIRE_DATE.UNEXPECTED",
  "message": "Для бессрочных документов дата окончания действия не должна быть указана",
  "field": "document.expireDate"
}
```

### `equals`

Значение поля должно быть равно указанному `value`.

```json
{
  "id": "library.order.currency_rub",
  "type": "rule",
  "description": "Валюта должна быть RUB",
  "role": "check",
  "operator": "equals",
  "level": "ERROR",
  "code": "ORDER.CURRENCY.WRONG",
  "message": "Поддерживается только валюта RUB",
  "field": "order.currency",
  "value": "RUB"
}
```

### `not_equals`

Значение поля не должно быть равно указанному `value`.

```json
{
  "id": "library.person.citizenship_not_us",
  "type": "rule",
  "description": "Гражданство не должно быть US",
  "role": "check",
  "operator": "not_equals",
  "level": "EXCEPTION",
  "code": "PERSON.CITIZENSHIP.BLOCKED",
  "message": "Гражданство US не допускается",
  "field": "person.citizenshipCode",
  "value": "US"
}
```

### `matches_regex`

Значение поля должно соответствовать заданному регулярному выражению. Необязательное поле `flags` передаётся в `RegExp` и валидируется на этапе компиляции вместе с паттерном.

```json
{
  "id": "library.person.last_name_format",
  "type": "rule",
  "description": "Фамилия должна содержать только буквы и дефисы",
  "role": "check",
  "operator": "matches_regex",
  "level": "ERROR",
  "code": "PERSON.LAST_NAME.FORMAT",
  "message": "Фамилия должна содержать только кириллические буквы",
  "field": "person.lastName",
  "value": "^[A-Za-z\\-]+$",
  "flags": "i"
}
```

Используйте `\\\\` в JSON-строках там, где в регулярном выражении нужен буквальный обратный слэш (например, `^\\d{6}$`).

### `length_equals` _(check only)_

Длина строки или массива должна быть строго равна `value`.

```json
{
  "id": "library.address.postal_code_length",
  "type": "rule",
  "description": "Почтовый индекс должен состоять ровно из 6 цифр",
  "role": "check",
  "operator": "length_equals",
  "level": "ERROR",
  "code": "ADDR.POSTAL.LENGTH",
  "message": "Почтовый индекс должен содержать 6 символов",
  "field": "address.postalCode",
  "value": 6
}
```

### `length_max` _(check only)_

Длина строки или массива должна быть ≤ `value`.

```json
{
  "id": "library.person.name_length",
  "type": "rule",
  "description": "Имя не должно превышать 50 символов",
  "role": "check",
  "operator": "length_max",
  "level": "ERROR",
  "code": "PERSON.FIRST_NAME.TOO_LONG",
  "message": "Имя не должно превышать 50 символов",
  "field": "person.firstName",
  "value": 50
}
```

### `contains`

Строка должна содержать указанную подстроку.

```json
{
  "id": "library.contact.email_has_at",
  "type": "rule",
  "description": "Email должен содержать символ @",
  "role": "check",
  "operator": "contains",
  "level": "WARNING",
  "code": "CONTACT.EMAIL.FORMAT",
  "message": "Адрес электронной почты выглядит некорректным",
  "field": "contact.email",
  "value": "@"
}
```

### `greater_than`

Значение поля должно быть больше `value` (числовое сравнение).

```json
{
  "id": "library.order.amount_positive",
  "type": "rule",
  "description": "Сумма заказа должна быть положительной",
  "role": "check",
  "operator": "greater_than",
  "level": "ERROR",
  "code": "ORDER.AMOUNT.NOT_POSITIVE",
  "message": "Сумма заказа должна быть больше 0",
  "field": "order.amount",
  "value": 0
}
```

### `less_than`

Значение поля должно быть меньше `value` (числовое сравнение).

```json
{
  "id": "library.order.quantity_cap",
  "type": "rule",
  "description": "Количество должно быть меньше 10000",
  "role": "check",
  "operator": "less_than",
  "level": "ERROR",
  "code": "ORDER.QTY.TOO_HIGH",
  "message": "Количество должно быть меньше 10000",
  "field": "order.quantity",
  "value": 10000
}
```

### `in_dictionary`

Значение поля должно входить в список `entries` указанного словаря.

Правило:

```json
{
  "id": "library.doc.type_code_allowed",
  "type": "rule",
  "description": "Код типа документа должен входить в разрешённый список",
  "role": "check",
  "operator": "in_dictionary",
  "level": "ERROR",
  "code": "DOC.TYPE_CODE.UNKNOWN",
  "message": "Код типа документа отсутствует в разрешённом списке",
  "field": "document.typeCode",
  "dictionary": {
    "type": "static",
    "id": "document_type_codes"
  }
}
```

Артефакт словаря:

```json
{
  "id": "document_type_codes",
  "type": "dictionary",
  "description": "Разрешённые коды типов документов",
  "entries": ["21", "22", "31", "32", "36"]
}
```

### `any_filled` _(check only)_

Хотя бы одно поле из списка `fields` должно быть непустым.

```json
{
  "id": "library.contact.at_least_one",
  "type": "rule",
  "description": "Должен быть указан хотя бы один способ связи",
  "role": "check",
  "operator": "any_filled",
  "level": "ERROR",
  "code": "CONTACT.MIN_ONE",
  "message": "Укажите хотя бы один контакт: телефон, email или почтовый адрес",
  "fields": ["contact.phone", "contact.email", "contact.postalAddress"],
  "field": "contact.phone"
}
```

`any_filled` поддерживает grouped wildcard fields. Если все поля имеют общий wildcard base, runtime проверяет требование отдельно для каждой материализованной группы:

```json
{
  "id": "library.items.tin_or_reason",
  "type": "rule",
  "description": "Для каждой позиции нужен ИНН или причина отсутствия",
  "role": "check",
  "operator": "any_filled",
  "level": "ERROR",
  "code": "ITEM.TIN_OR_REASON",
  "message": "Укажите ИНН или причину отсутствия для каждой позиции",
  "fields": ["items[*].tin", "items[*].absenceReason"]
}
```

Для вложенных массивов группировка идёт по полному wildcard path, например `accounts[*].transactions[*].amount` группируется по каждой материализованной транзакции.

### `field_equals_field`

Значения двух полей должны совпадать. И `field`, и `value_field` поддерживают `$context.*`.

```json
{
  "id": "library.account.confirm_password",
  "type": "rule",
  "description": "Пароль и подтверждение должны совпадать",
  "role": "check",
  "operator": "field_equals_field",
  "level": "ERROR",
  "code": "ACCOUNT.PASSWORD.MISMATCH",
  "message": "Пароль и подтверждение не совпадают",
  "field": "account.password",
  "value_field": "account.passwordConfirm"
}
```

### `field_not_equals_field`

Значения двух полей должны различаться.

### `field_less_than_field`

Значение `field` должно быть строго меньше `value_field`. Поддерживаются строки с датой в формате `YYYY-MM-DD` и числа. Поддерживается `$context.*` с любой стороны.

```json
{
  "id": "library.doc.issue_date_not_future",
  "type": "rule",
  "description": "Дата выдачи документа не должна быть в будущем",
  "role": "check",
  "operator": "field_less_or_equal_than_field",
  "level": "ERROR",
  "code": "DOC.ISSUE_DATE.FUTURE",
  "message": "Дата выдачи документа не должна быть в будущем",
  "field": "document.issueDate",
  "value_field": "$context.currentDate"
}
```

### `field_greater_than_field`

Значение `field` должно быть строго больше `value_field`.

### `field_less_or_equal_than_field`

Значение `field` должно быть ≤ `value_field`.

### `field_greater_or_equal_than_field`

Значение `field` должно быть ≥ `value_field`.

## Написание собственных операторов

### Сигнатура оператора

**Check-оператор** это функция `(rule, ctx) → result`:

```js
function myCheckOperator(rule, ctx) {
  // rule  объект артефакта: { field, value, operator, level, code, ... }
  // ctx   runtime-контекст:
  //           ctx.payload            flat-map всех полей payload
  //           ctx.get(path)          читает поле из flat payload map
  //           ctx.has(path)          проверяет наличие поля
  //           ctx.getDictionary(id)  получает словарь по id
  //           ctx.payloadKeys        все ключи, присутствующие в payload
  //           ctx.wildcardCache      Map для кеширования раскрытия wildcard

  return { status: "OK" }; // проверка пройдена
  return { status: "FAIL", actual: v }; // проверка не пройдена; actual = значение, на котором произошёл провал
  return { status: "EXCEPTION", error: e }; // жёсткая runtime-ошибка
}
```

**Predicate-оператор** имеет ту же сигнатуру, но другие возвращаемые статусы:

```js
function myPredicateOperator(rule, ctx) {
  return { status: "TRUE" }; // условие выполнено
  return { status: "FALSE" }; // условие не выполнено
  return { status: "UNDEFINED" }; // поле отсутствует, движок трактует это как FALSE
  return { status: "EXCEPTION", error: e };
}
```

### Предпочтительный доступ к полям: `ctx.get()` / `ctx.has()`

`ctx.get(path)` — предпочтительный контракт для новых пользовательских операторов. Он возвращает тот же shape, что и `deepGet`: `{ ok, value }`, включая поддержку `$context.*` полей.

```js
module.exports = function myOperator(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL" };
  return { status: got.value ? "OK" : "FAIL", actual: got.value };
};
```

`ctx.has(path)` используйте, когда нужна только проверка наличия поля.

### Использование `deepGet`

`ctx.get(path)` — предпочтительный способ прочитать поле из flat payload. `deepGet` сохраняется для обратной совместимости.
Импортируйте его из `jsonspecs`, если вам явно нужен этот helper:

```js
const { deepGet } = require("jsonspecs");

function myOperator(rule, ctx) {
  const got = deepGet(ctx.payload, rule.field);
  //   got.ok    true, если поле существует
  //   got.value значение поля (может быть null/undefined, если ok = false)

  if (!got.ok) return { status: "FAIL" };
  // ... проверка got.value
}
```

`deepGet` также автоматически обрабатывает поля вида `$context.*`:

```js
deepGet(ctx.payload, "$context.currentDate");
// { ok: true, value: "2026-03-27" }
```

### Полный пример: дата не должна быть в прошлом

```js
const { createEngine, Operators } = require("jsonspecs");

const myOperators = {
  check: {
    ...Operators.check,

    // Проверяет, что дата в поле сегодня или в будущем (>= context date)
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

Соответствующий артефакт правила:

```json
{
  "id": "library.contract.start_date_not_past",
  "type": "rule",
  "description": "Дата начала договора не должна быть в прошлом",
  "role": "check",
  "operator": "date_not_in_past",
  "level": "ERROR",
  "code": "CONTRACT.START_DATE.IN_PAST",
  "message": "Дата начала договора должна быть сегодня или в будущем",
  "field": "contract.startDate"
}
```

### Добавление predicate-варианта

Если вы хотите использовать оператор также как guard-условие в `when`, добавьте его и в `check`, и в `predicate`:

```js
function dateNotInPastImpl(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok || !got.value) return null; // null = поле отсутствует
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

### Работа с `rule.value` и `rule.value_field`

Для операторов, которые принимают параметр, читайте его из `rule.value` (скаляр) или `rule.value_field` (другое поле payload):

```js
// Оператор: поле должно быть равно одному из разрешённых значений
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

### Регистрация

Просто расширьте встроенный набор своими операторами и передайте его в `createEngine`:

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

Компилятор проверяет, что каждый оператор, на который есть ссылка в артефактах правил, присутствует в наборе. Поэтому если вы укажете `date_not_in_past` в правиле, но забудете зарегистрировать оператор, вы получите понятную `CompilationError`, а не runtime-сбой.
