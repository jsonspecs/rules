# JSONSpecs Rules

[![CI](https://github.com/jsonspecs/rules/actions/workflows/ci.yml/badge.svg)](https://github.com/jsonspecs/rules/actions)
[![npm](https://img.shields.io/npm/v/@jsonspecs/rules)](https://www.npmjs.com/package/@jsonspecs/rules)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)

Детерминированный движок JSON-правил для Node.js. Версия 4 реализует исполняемый контракт `jsonspecs/spec` **1.0.0-rc.7**.

Движок один раз проверяет закрытый снэпшот пакета правил, сверяет его JCS-хеш, связывает встроенные и внешние операторы проверок, а затем возвращает воспроизводимый результат с упорядоченными бизнес-ошибками и идентификатором набора правил.

## Установка

```bash
npm install @jsonspecs/rules
```

Нужен Node.js 20 или новее. Регулярные выражения исполняются автоматным движком RE2 в WebAssembly (`re2-wasm`): катастрофический перебор с возвратами (catastrophic backtracking) отсутствует, а установка пакета не требует нативного компилятора и загрузки ABI-зависимых бинарников.

## Основной сценарий

```js
const {
  compileSnapshot,
  computeSourceHash,
  runPipeline,
} = require("@jsonspecs/rules");

const snapshot = {
  format: "jsonspecs-snapshot",
  formatVersion: 2,
  specVersion: "1.0.0-rc.7",
  exports: ["customer.validate"],
  artifacts: {
    "customer.validate": {
      type: "pipeline",
      steps: ["customer.name.required"],
    },
    "customer.name.required": {
      type: "rule",
      operator: "not_empty",
      field: "customer.name",
      issue: {
        level: "ERROR",
        code: "CUSTOMER.NAME.REQUIRED",
        message: "Не указано имя клиента",
      },
    },
  },
};

snapshot.sourceHash = computeSourceHash(snapshot);
const prepared = compileSnapshot(snapshot);
const result = runPipeline(prepared, {
  pipelineId: "customer.validate",
  payload: { customer: { name: "" } },
  context: {},
});
```

`pipelineId` всегда передаётся явно. `payload` и `context` вложенные JSON-объекты. Плоская карта путей и `payload.__context` в контракт не входят.

## Поля с `[*]`

В RC.7 движок раскрывает `[*]` по реальным массивам вложенного `payload`. Поэтому
правило для `items[*].sku` проверяет каждый существующий `items[i]`, даже если `sku`
у элемента отсутствует. Оператор обязательности может создать ошибку с конкретным
полем `items[1].sku`; оператор значения сохраняет результат `SKIP` для отсутствия.
`onEmpty` применяется только тогда, когда структурных кандидатов нет.

Компилятор разрешает `[*]` только в основном поле правила, заранее разбирает путь и
отклоняет wildcard в `$context`. Полный порядок обхода и правила агрегации заданы в
спецификации поведения по ссылке ниже.

## Внешние операторы

Пакет операторов экспортирует объект `имя -> { schema, evaluate }`. Закрытая JSON Schema draft-07 описывает только конфигурацию конкретного оператора: стандартные операнды, именованные `inputs` и постоянные `params`. Ядро само разрешает пути и
передаёт значения. Оператор не получает весь `payload`, `context`, средство разрешения путей или место вызова.

`evaluate` возвращает ровно `PASS`, `FAIL` или `SKIP`. Брошенное исключение даёт `ABORT OPERATOR_FAULT`, иной результат даёт `ABORT OPERATOR_CONTRACT_VIOLATION`. Имена встроенных операторов зарезервированы и не переопределяются.

## Публичный API

- `createEngine({ operators? })`;
- `builtInOperators` глубоко неизменяемые определения и схемы встроенных операторов;
- `CompilationError` для отклонённых снэпшотов;
- `compileSnapshot(snapshot)` и `compileSnapshotText(text)`;
- `validate(snapshot)`;
- `runPipeline(prepared, { pipelineId, payload, context? })`;
- `inspect(prepared)`;
- `computeSourceHash(snapshot)`;
- форматирование диагностик и ошибок выполнения.

Версия 4 принимает только `formatVersion: 2`. Разобранные авторские файлы, описания, папки, импорты и метаданные проекта не относятся к исполняемому снэпшоту.

## Область применения

Движок подходит для детерминированных проверок и решений в кредитном конвейере и платёжном шлюзе: обязательность данных, допуски, согласованность полей, маршрутизация, флаги санкционных проверок и упорядоченные бизнес-ошибки.
Ядро объединяет их логические результаты и сведения для аудита. Сервис отвечает за лимит транспортного размера, аутентификацию, авторизацию, доставку снэпшота и сведения о версиях подключённых пакетов операторов.

Подробности: [спецификация поведения](https://github.com/jsonspecs/spec/blob/f474b5924b55e20e61a8760f0ea752d630ccdf69/SPEC_RU.md),
[реализация движка](IMPLEMENTATION_RU.md), [операторы](OPERATORS_RU.md),
[переход на RC.7](MIGRATION_RC7_RU.md), [история перехода на RC.6](MIGRATION_RC6_RU.md),
[переход с 2.x на 3.x](MIGRATION_V3.md),
[проверки](TESTING.md).
