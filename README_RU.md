# JSONSpecs

[![CI](https://github.com/catindev/jsonspecs/actions/workflows/ci.yml/badge.svg)](https://github.com/catindev/jsonspecs/actions)
[![npm](https://img.shields.io/npm/v/jsonspecs)](https://www.npmjs.com/package/jsonspecs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)

Декларативный движок валидации для JSON-правил и детерминированных validation pipelines.

Правила описываются обычными JSON-артефактами. JSONSpecs валидирует и подготавливает их один раз, запускает именованный pipeline на JSON payload и возвращает transport-safe результат со стабильными статусами, issues, diagnostics, опциональным trace и provenance набора правил. У пакета нет runtime-зависимостей.

```bash
npm install jsonspecs
```

Поддерживаются CommonJS и ESM:

```js
const { createEngine, Operators } = require("jsonspecs");
```

```js
import { createEngine, Operators } from "jsonspecs";
```

## Базовые понятия

| Артефакт | Назначение |
| --- | --- |
| `rule` | Атомарная проверка или predicate на одном операторе. |
| `condition` | Predicate-условие и шаги, которые выполняются только при истинном условии. |
| `pipeline` | Упорядоченный сценарий из правил, условий и вложенных pipeline. |
| `dictionary` | Статический список значений для `in_dictionary`. |

Обычный production-flow:

1. описать JSON-артефакты;
2. провалидировать и исправить diagnostics;
3. подготовить artifact или собрать детерминированный snapshot;
4. выполнить prepared artifact с `{ pipelineId, payload, context }`.

`jsonspecs` не привязан к загрузчику. Чтение файлов, project manifest, Studio UI и сборка snapshot находятся в [`jsonspecs-cli`](https://www.npmjs.com/package/jsonspecs-cli), а не в ядре.

## Быстрый старт

```js
const { createEngine, Operators, formatDiagnostics } = require("jsonspecs");

const artifacts = [
  {
    id: "library.person.first_name_required",
    type: "rule",
    description: "Имя должно быть заполнено",
    role: "check",
    operator: "not_empty",
    level: "ERROR",
    code: "PERSON.FIRST_NAME.REQUIRED",
    message: "Необходимо указать имя",
    field: "person.firstName",
  },
  {
    id: "registration.pipeline",
    type: "pipeline",
    description: "Валидация регистрации",
    entrypoint: true,
    strict: false,
    required_context: ["currentDate"],
    flow: [{ rule: "library.person.first_name_required" }],
  },
];

const engine = createEngine({ operators: Operators });

const validation = engine.validate(artifacts);
if (!validation.ok) {
  throw new Error(formatDiagnostics(validation.diagnostics));
}

const prepared = engine.compile(artifacts);

const result = engine.runPipeline(prepared, {
  pipelineId: "registration.pipeline",
  payload: {
    person: { firstName: "Ivan" },
  },
  context: {
    currentDate: "2026-03-27",
  },
});

// {
//   status: "OK",
//   control: "CONTINUE",
//   issues: [],
//   ruleset: { sourceHash: "..." }
// }
```

Если ровно один pipeline помечен `entrypoint: true`, `pipelineId` можно не передавать. Старая сигнатура `runPipeline(prepared, pipelineId, payload, options)` сохранена для совместимости, но новый код должен использовать объектный input.

## Публичный API

Поддерживаемая поверхность — только exports из корня пакета. Всё внутри `src/**` считается внутренней реализацией.

| Export | Назначение |
| --- | --- |
| `createEngine({ operators })` | Создаёт engine с переданным набором операторов. |
| `Operators` | Встроенные check- и predicate-операторы. |
| `validate(artifacts, options?)` | Non-throwing валидация исходников со встроенными операторами, если не передан `options.operators`. |
| `compileSnapshot(snapshot, options?)` | Проверяет целостность snapshot и подготавливает его к runtime. |
| `inspect(prepared)` | Read-only introspection по prepared artifact. |
| `computeSourceHash(artifacts)` | Канонический SHA-256 по артефактам. |
| `formatDiagnostics(diagnostics)` | Короткий человекочитаемый формат diagnostics. |
| `formatRuntimeError(error)` | Короткий формат runtime error. |
| `deepGet(payload, path)` | Helper для обратной совместимости. Новые операторы должны использовать `ctx.get()`. |
| `CompilationError` / `RuntimeError` | Типизированные ошибки compile-time и внутреннего runtime. |

### `engine.validate(artifacts, options?)`

Возвращает `{ ok, diagnostics }` и не бросает исключения на обычных ошибках исходников. Успешная валидация может вернуть warning-level diagnostics; warnings не делают `ok` равным `false`.

Диагностики структурированы:

```js
{
  code: "ARTIFACT_REF_NOT_FOUND",
  level: "error",
  message: "Reference not found: library.person.email",
  phase: "reference_validation",
  artifactId: "registration.pipeline",
  path: "flow[1].rule",
  location: "/rules/registration.pipeline.json"
}
```

Фазы компилятора намеренно phase-fail-fast для ошибок: неуспешная фаза возвращает все свои error diagnostics, а следующие зависимые фазы не запускаются. Warning diagnostics не блокируют компиляцию.

### `engine.compile(artifacts, options?)`

Возвращает opaque prepared artifact:

```js
{
  kind: "prepared-jsonspecs",
  artifactType: "jsonspecs",
  version: "1",
  sourceHash: "...",
  diagnostics: []
}
```

Runtime internals не раскрываются через публичный объект. Для UI, debug и tooling используйте `inspect(prepared)`.

`options.sources` может быть `Map<artifactId, string | { file, line?, column? }>` и используется для заполнения `location` в diagnostics.

### `engine.compileSnapshot(snapshot, options?)`

Snapshot — детерминированный production artifact:

```js
{
  "format": "jsonspecs-snapshot",
  "formatVersion": 1,
  "sourceHash": "...",
  "engine": { "minVersion": "2.1.1" },
  "artifacts": [],
  "meta": {
    "projectId": "checkout-rules",
    "projectTitle": "Checkout rules",
    "description": "Checkout validation",
    "rulesetVersion": "1.0.0"
  }
}
```

`compileSnapshot()` проверяет форму snapshot, SemVer-совместимость движка и `sourceHash`. Runtime result из snapshot содержит `ruleset.sourceHash`, `ruleset.projectId` и `ruleset.rulesetVersion`.

### `engine.runPipeline(prepared, input, options?)`

```js
const result = engine.runPipeline(prepared, {
  pipelineId: "registration.pipeline",
  payload: { person: { firstName: "" } },
  context: { currentDate: "2026-03-27" },
}, {
  trace: "basic",
});
```

`input.payload` должен быть JSON object. Он может быть вложенным или уже flattened через dot-notation. `input.context` доступен правилам как `$context.*`.

Runtime result:

```js
{
  status: "OK" | "OK_WITH_WARNINGS" | "ERROR" | "EXCEPTION" | "ABORT",
  control: "CONTINUE" | "STOP",
  issues: [],
  ruleset: {
    sourceHash: "...",
    projectId: "checkout-rules",
    rulesetVersion: "1.0.0"
  },
  trace: [] // только если trace включён
}
```

Issue:

```js
{
  kind: "ISSUE",
  level: "ERROR",
  code: "PERSON.FIRST_NAME.REQUIRED",
  message: "Необходимо указать имя",
  field: "person.firstName",
  ruleId: "library.person.first_name_required",
  pipelineId: "registration.pipeline",
  stepId: "optional-step-id",
  expected: "...",
  actual: "",
  meta: {}
}
```

`ABORT` — не validation result. Это означает, что runtime boundary поймал проблему payload, custom operator, trace redactor или внутренний сбой движка. В таком результате всегда `control: "STOP"` и transport-safe error:

```js
{
  status: "ABORT",
  control: "STOP",
  issues: [],
  error: {
    code: "DANGEROUS_PAYLOAD_KEY",
    message: "Dangerous key at __proto__",
    details: { "path": "__proto__" }
  }
}
```

Stack trace в runtime result не раскрывается.

### `inspect(prepared)`

Introspection API для UI, документации, debug и HTTP API:

```js
const view = engine.inspect(prepared);

view.listEntrypoints();
view.listArtifacts({ type: "rule" });
view.getArtifact("library.person.first_name_required");
view.getPipelineSteps("registration.pipeline");
view.getConditionModel("library.person.has_document");
view.listDictionaries();
view.stats();
```

## Trace

Trace по умолчанию выключен и отсутствует в result.

| Опция | Поведение |
| --- | --- |
| `false` / не передано | Поля `trace` нет. |
| `true` / `"basic"` | Структурный trace без raw payload values. |
| `"verbose"` | Trace может содержать подробные значения после применения `traceRedactor`. |

Все trace events имеют одну форму:

```js
{
  kind: "TRACE",
  artifactType: "jsonspecs",
  artifactId: "registration.pipeline",
  step: "pipeline.start",
  outcome: "start",
  at: "2026-07-12T10:00:00.000Z",
  details: {}
}
```

## Safety guarantees

Движок рассматривает artifacts, payload и context как недоверенный JSON на технической границе:

- опасные ключи `__proto__`, `prototype`, `constructor` отклоняются;
- чтение через prototype chain не используется;
- циклические artifacts, payload и context отклоняются;
- неподдерживаемые JSON-значения отклоняются или нормализуются на runtime boundary;
- artifacts, payload и context имеют детерминированный лимит глубины JSON;
- `matches_regex` паттерны проверяются compile-time линтером на типовые ReDoS-риски и дают warning diagnostics;
- prepared artifacts opaque и immutable с точки зрения публичного API;
- runtime results можно безопасно `JSON.stringify()` и прогонять через JSON round-trip.

Regex linting - эвристический guardrail, а не гарантия линейного времени. Rule artifacts и custom operators являются доверенным авторским вводом; runtime payload и context являются недоверенным вводом. Лимиты размера сообщения, числа issues и размера transport-result остаются ответственностью вызывающей стороны.

## JSON Schema

Пакет экспортирует JSON Schema 2020-12:

```js
const artifactSchema = require("jsonspecs/schema");
const snapshotSchema = require("jsonspecs/schema/snapshot");
```

JSON Schema покрывает структурную валидацию. Ссылки между артефактами, наличие операторов, visibility, уникальность, aggregate semantics и циклы pipeline проверяются через `validate()` / `compile()`.

## Правила артефактов

Идентификаторы управляют visibility:

- `library.*` видны глобально;
- pipeline-local артефакты видны через dotted scope;
- pipeline могут вызывать другие pipeline по полному id;
- dictionaries глобально адресуются по id.

Уровни результата:

| Level | Значение | Поведение pipeline |
| --- | --- | --- |
| `WARNING` | Мягкое замечание. | Накапливается, выполнение не останавливает. |
| `ERROR` | Ошибка валидации. | Накапливается, итоговый `control` — `STOP`. |
| `EXCEPTION` | Жёсткая блокировка. | Немедленно останавливает выполнение. |

Встроенные операторы и пользовательские операторы описаны в [OPERATORS_RU.md](./OPERATORS_RU.md). Нормативный формат артефактов описан в [SPEC_RU.md](./SPEC_RU.md), правила совместимости публичного API — в [COMPATIBILITY.md](./COMPATIBILITY.md).

## Пользовательские операторы

Custom operators получают `(rule, ctx)`. Новые операторы должны использовать стабильные helpers из context:

```js
function amount_gt_zero(rule, ctx) {
  const got = ctx.get(rule.field);
  if (!got.ok) return { status: "FAIL", actual: undefined };

  const value = Number(got.value);
  return {
    status: Number.isFinite(value) && value > 0 ? "OK" : "FAIL",
    actual: got.value,
  };
}
```

Регистрация:

```js
const engine = createEngine({
  operators: {
    check: { ...Operators.check, amount_gt_zero },
    predicate: { ...Operators.predicate },
  },
});
```

Набор операторов — обычный JavaScript-объект. Если несколько spread-операций
задают один и тот же оператор, побеждает последнее свойство; локальные операторы
проекта могут намеренно переопределять встроенные, если указаны после
`...Operators.check` или `...Operators.predicate`.

## Тесты

```bash
npm test
npm run test:smoke
npm run test:pack
npm run test:perf
```

`test:pack` устанавливает собранный пакет в чистые CommonJS и ESM consumers и проверяет форму публикуемого артефакта.
`test:perf` - smoke gate для больших плоских payload, wildcard scans, роста issues и синтетических больших ruleset.

Текущее покрытие и рекомендуемые доработки тестов зафиксированы в [TESTING.md](./TESTING.md).
