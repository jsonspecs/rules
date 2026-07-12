# JSONSpecs

[![CI](https://github.com/catindev/jsonspecs/actions/workflows/ci.yml/badge.svg)](https://github.com/catindev/jsonspecs/actions)
[![npm](https://img.shields.io/npm/v/jsonspecs)](https://www.npmjs.com/package/jsonspecs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)

Декларативный движок валидационных правил. Правила описываются в JSON-файлах. Движок компилирует их, запускает на payload любой глубины вложенности и возвращает структурированный результат с уровнями `ERROR`, `WARNING` и `EXCEPTION`, полным списком issue и execution trace. Без внешних зависимостей.

```
npm install jsonspecs
```

## Как это работает

Правила (rules) хранятся как отдельные JSON-файлы. Сценарий проверки (pipeline) собирает их в детерменированный поток выполнения. Движок компилирует их один раз, после чего может запускать на любом payload.

**Шаг 1: написать атомарные правила** (один файл на одно правило, одно правило на проверку одного поля):

`rules/library/person/first_name_required.json`

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

`rules/library/person/email_format.json`

```json
{
  "id": "library.person.email_format",
  "type": "rule",
  "description": "Email должен содержать @",
  "role": "check",
  "operator": "contains",
  "level": "WARNING",
  "code": "PERSON.EMAIL.FORMAT",
  "message": "Адрес электронной почты выглядит некорректным",
  "field": "person.email",
  "value": "@"
}
```

`rules/library/person/doc_not_expired.json`

```json
{
  "id": "library.person.doc_not_expired",
  "type": "rule",
  "description": "Документ не должен быть просрочен",
  "role": "check",
  "operator": "field_greater_or_equal_than_field",
  "level": "EXCEPTION",
  "code": "PERSON.DOC.EXPIRED",
  "message": "Срок действия документа истёк",
  "field": "person.document.expireDate",
  "value_field": "$context.currentDate"
}
```

**Шаг 2: собрать правила в сценарий:**

`rules/pipelines/registration/pipeline.json`

```json
{
  "id": "registration.pipeline",
  "type": "pipeline",
  "description": "Валидация регистрации физлица",
  "entrypoint": true,
  "strict": false,
  "required_context": ["currentDate"],
  "flow": [
    { "rule": "library.person.first_name_required" },
    { "rule": "library.person.email_format" },
    { "rule": "library.person.doc_not_expired" }
  ]
}
```

**Шаг 3: скомпилировать и запустить:**

```js
const { createEngine, Operators } = require("jsonspecs");

const artifacts = [
  require("./rules/library/person/first_name_required.json"),
  require("./rules/library/person/email_format.json"),
  require("./rules/library/person/doc_not_expired.json"),
  require("./rules/pipelines/registration/pipeline.json"),
];

const engine = createEngine({ operators: Operators });
const compiled = engine.compile(artifacts);

const result = engine.runPipeline(compiled, "registration.pipeline", {
  person: {
    firstName: "Ivan",
    email: "ivan@example.com",
    document: { expireDate: "2028-01-01" },
  },
  __context: { currentDate: "2026-03-27" },
});

// { status: "OK", control: "CONTINUE", issues: [] }
```

Движок не привязан к конкретному загрузчику артефактов и потому они могут поступать откуда угодно: из файловой системы, snapshot-файла, базы данных или быть встроенными объектами прямо в тестах. См. [Загрузка артефактов](#загрузка-артефактов).

## API

### `createEngine({ operators })`

Создаёт экземпляр движка, привязанный к набору операторов.

```js
const { createEngine, Operators } = require("jsonspecs");
const engine = createEngine({ operators: Operators });
```

`Operators` встроенный набор, покрывающий все стандартные checks и predicates. Вы можете расширить его собственными операторами, см. [Пользовательские операторы](#пользовательские-операторы).

### `engine.compile(artifacts, options?)`

Компилирует массив артефактов в оптимизированную runtime-структуру. Если какой-либо артефакт некорректен, выбрасывает `CompilationError` с полным списком ошибок.

```js
const compiled = engine.compile(artifacts);
```

Проверки на этапе компиляции: валидация схемы, целостность ссылок, обнаружение циклов в DAG, наличие операторов и уникальность `code` среди всех правил. `sources` необязательный `Map<artifactId, sourceFile | {file,line?,column?}>`, используемый для заполнения структурного поля `location` в диагностике; автоматически заполняется `loadArtifactsFromDir`.

### `engine.runPipeline(compiled, pipelineId, payload)`

Запускает именованный pipeline на указанном payload.

```js
const result = engine.runPipeline(compiled, "registration.pipeline", {
  person: { firstName: "Иван" },
  __context: { currentDate: "2026-03-27" },
});
```

Payload может быть как вложенным JSON-объектом, так и заранее преобразованным flat-map в dot-notation поддерживаются оба варианта. Runtime-контекст передаётся под зарезервированным ключом `__context`. Правила получают доступ к нему через `$context.fieldName`.

**Структура результата:**

```js
{
  status: "OK" | "OK_WITH_WARNINGS" | "ERROR" | "EXCEPTION",
  control: "CONTINUE" | "STOP",
  issues: [
    {
      kind: "ISSUE",
      level: "ERROR" | "WARNING" | "EXCEPTION",
      code: "PERSON.FIRST_NAME.REQUIRED",
      message: "Необходимо указать имя",
      field: "person.firstName",
      ruleId: "library.person.name_required",
      actual: "",       // значение, на котором произошёл провал
      expected: ...     // ожидаемое значение правила или ссылка на словарь, если применимо
    }
  ]
}
```

### `ctx.get(path)` / `ctx.has(path)`

Для новых пользовательских операторов предпочтительно использовать helper’ы runtime-контекста:

```js
module.exports = function myOperator(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL" };
  return { status: got.value ? "OK" : "FAIL", actual: got.value };
};
```

`ctx.has(path)` возвращает boolean, когда нужна только проверка наличия поля.

### `deepGet(payload, field)`

Вспомогательная функция, экспортируемая для использования в сложных пользовательских операторах и для обратной совместимости. В новых операторах рекомендуется использовать ctx.get(). Ищет поле по dot-notation path в flat payload map, с поддержкой полей вида `$context.*`.

```js
const { deepGet } = require("jsonspecs");

// Возвращает { ok: true, value: "Иван" }
deepGet(ctx.payload, "person.firstName");

// Возвращает { ok: true, value: "2026-03-27" }
deepGet(ctx.payload, "$context.currentDate");

// Возвращает { ok: false, value: undefined } поле отсутствует
deepGet(ctx.payload, "person.unknownField");
```

### `CompilationError`

Выбрасывается из `engine.compile()`, если артефакты некорректны. Содержит полный список всех найденных ошибок, а не только первую.

```js
const { CompilationError } = require("jsonspecs");

try {
  engine.compile(artifacts);
} catch (err) {
  if (err instanceof CompilationError) {
    console.error("Compilation failed:");
    err.errors.forEach((msg, i) => console.error(`  ${i + 1}. ${msg}`));
  }
}
```

## Загрузка артефактов

Движок не привязан к конкретному загрузчику. Вы сами решаете, как загрузить артефакты в память.

**Из файловой системы** (разработка: сканирование директории с `.json`-файлами):

```js
// loader-fs является частью вашего серверного проекта, а не этого пакета
const { loadArtifactsFromDir } = require("./lib/loader-fs");
const { artifacts, sources } = loadArtifactsFromDir("./rules");
const compiled = engine.compile(artifacts, { sources });
```

**Из snapshot** (production: один заранее собранный JSON-файл):

```js
const snapshot = JSON.parse(fs.readFileSync("snapshot.json", "utf8"));
const compiled = engine.compileSnapshot(snapshot);
```

**Inline** (тесты: артефакты задаются как обычные JS-объекты):

```js
const artifacts = [
  {
    id: "library.t.name",
    type: "rule",
    description: "Имя должно быть заполнено",
    role: "check",
    operator: "not_empty",
    level: "ERROR",
    code: "NAME.REQUIRED",
    message: "Необходимо указать имя",
    field: "person.name",
  },
  {
    id: "test.pipeline",
    type: "pipeline",
    description: "Тест",
    entrypoint: true,
    strict: false,
    flow: [{ rule: "library.t.name" }],
  },
];

const compiled = engine.compile(artifacts);
const result = engine.runPipeline(compiled, "test.pipeline", {
  person: { name: "" },
});
// result.status === "ERROR"
// result.issues[0].code === "NAME.REQUIRED"
```

## Типы артефактов

| Type         | Назначение                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------- |
| `rule`       | Атомарная проверка или предикат: один оператор, одно поле, один результат                   |
| `condition`  | Условный блок: predicate-guard в `when` + `steps`, которые выполняются при истинном условии |
| `pipeline`   | Упорядоченная последовательность шагов: правила, conditions, подпайплайны                   |
| `dictionary` | Именованный список допустимых значений, используемый оператором `in_dictionary`             |

## Правила области видимости

Идентификаторы артефактов управляют видимостью между pipeline.

**Префикс `library.*`** глобальная видимость из любого pipeline или condition:

```
library.person.email_format    ← можно использовать в любом сценарии
library.payment.card_required  ← можно использовать в любом сценарии
```

**Pipeline-local** видимость внутри pipeline, если идентификаторы разделяют общий dotted prefix:

```
Pipeline:   internal.checkout.blocks.payment
Visible:    internal.checkout.blocks.payment.card_expiry_check
```

Компилятор валидирует все ссылки и на этапе компиляции сообщает о каждой неразрешимой.

## Уровни результата

| Level       | Значение                                      | Поведение pipeline                           |
| ----------- | --------------------------------------------- | -------------------------------------------- |
| `ERROR`     | Ошибка валидации                              | Накапливается, **не** останавливает pipeline |
| `WARNING`   | Мягкая проверка, подсказка по качеству данных | Накапливается, **не** останавливает pipeline |
| `EXCEPTION` | Жёсткая блокировка, продолжать нельзя         | Немедленно **останавливает** pipeline        |

| `status`             | Значение                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| `"OK"`               | Вообще нет issue                                                                 |
| `"OK_WITH_WARNINGS"` | Проверка пройдена, но есть мягкие issue уровня `WARNING`, которые стоит показать |
| `"ERROR"`            | Есть одна или более issue уровня `ERROR`                                         |
| `"EXCEPTION"`        | Pipeline был остановлен правилом уровня `EXCEPTION`                              |

## Пользовательские операторы

См. полный справочник в [OPERATORS.md](./OPERATORS_RU.md).

Короткий пример добавления собственного check-оператора:

```js
const { createEngine, Operators } = require("jsonspecs");

// кастомный оператор
const is_apple = (rule, ctx) => {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL" };
  return {
    status: got.value === "apple" ? "OK" : "FAIL",
    actual: got.value,
  };
};

const operators = {
  check: { ...Operators.check, is_apple },
  predicate: { ...Operators.predicate },
};

const engine = createEngine({ operators });
```

Затем оператор используется в артефакте правила:

```json
{
  "id": "library.fruit.must_be_apple",
  "type": "rule",
  "description": "Field must equal apple",
  "role": "check",
  "operator": "is_apple",
  "level": "ERROR",
  "code": "FRUIT.NOT_APPLE",
  "message": "Only apples are accepted here",
  "field": "order.fruit"
}
```

## Встроенные операторы

Полный справочник с примерами: [OPERATORS.md](./OPERATORS_RU.md).

| Operator                            | Type              | Description                                    |
| ----------------------------------- | ----------------- | ---------------------------------------------- |
| `not_empty`                         | check + predicate | Поле присутствует и не пустое                  |
| `is_empty`                          | check + predicate | Поле отсутствует или пустое                    |
| `equals`                            | check + predicate | Значение поля равно `value`                    |
| `not_equals`                        | check + predicate | Значение поля не равно `value`                 |
| `matches_regex`                     | check + predicate | Значение поля соответствует regex из `value`   |
| `length_equals`                     | check             | Длина строки или массива равна `value`         |
| `length_max`                        | check             | Длина строки или массива ≤ `value`             |
| `contains`                          | check + predicate | Строка содержит подстроку `value`              |
| `greater_than`                      | check + predicate | Значение поля > `value`                        |
| `less_than`                         | check + predicate | Значение поля < `value`                        |
| `in_dictionary`                     | check + predicate | Значение присутствует в именованном словаре    |
| `any_filled`                        | check             | Хотя бы одно поле из списка `fields` не пустое |
| `field_equals_field`                | check + predicate | `field` == `value_field`                       |
| `field_not_equals_field`            | check + predicate | `field` != `value_field`                       |
| `field_less_than_field`             | check + predicate | `field` < `value_field`                        |
| `field_greater_than_field`          | check + predicate | `field` > `value_field`                        |
| `field_less_or_equal_than_field`    | check + predicate | `field` ≤ `value_field`                        |
| `field_greater_or_equal_than_field` | check + predicate | `field` ≥ `value_field`                        |
