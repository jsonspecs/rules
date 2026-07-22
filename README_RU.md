# @jsonspecs/rules

Детерминированный движок JSON-правил для Node.js. Версия 3 реализует исполняемый
контракт `jsonspecs/spec` **1.0.0-rc.5** и проходит все 267 нормативных фикстур.

Движок один раз проверяет закрытый снэпшот, сверяет его JCS-хеш, связывает
встроенные и внешние операторы, а затем возвращает воспроизводимый результат с
упорядоченными бизнес-ошибками и идентификатором набора правил.

## Установка

```bash
npm install @jsonspecs/rules
```

Нужен Node.js 20 или новее. Регулярные выражения исполняются автоматным движком
RE2 в WebAssembly (`re2-wasm`): катастрофический перебор с возвратами
(catastrophic backtracking) отсутствует, а установка пакета не требует нативного
компилятора и загрузки ABI-зависимых бинарников.

## Основной сценарий

```js
const { compileSnapshot, computeSourceHash, runPipeline } = require("@jsonspecs/rules");

const snapshot = {
  format: "jsonspecs-snapshot",
  formatVersion: 2,
  specVersion: "1.0.0-rc.5",
  exports: ["customer.validate"],
  artifacts: {
    "customer.validate": { type: "pipeline", steps: ["customer.name.required"] },
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

`pipelineId` всегда передаётся явно. `payload` и `context` — вложенные JSON-объекты.
Плоская карта путей и `payload.__context` в контракт не входят.

## Внешние операторы

Пакет операторов экспортирует объект `имя -> { schema, evaluate }`. Закрытая JSON
Schema draft-07 описывает только конфигурацию конкретного оператора: стандартные
операнды, именованные `inputs` и постоянные `params`. Ядро само разрешает пути и
передаёт значения. Оператор не получает весь payload, context, resolver или место
вызова.

`evaluate` возвращает ровно `PASS`, `FAIL` или `SKIP`. Брошенное исключение даёт
`ABORT OPERATOR_FAULT`, иной результат — `ABORT OPERATOR_CONTRACT_VIOLATION`.
Имена встроенных операторов зарезервированы и не переопределяются.

## Публичный API

- `createEngine({ operators? })`;
- `builtInOperators` — глубоко неизменяемые определения и схемы встроенных операторов;
- `CompilationError` для отклонённых снэпшотов;
- `compileSnapshot(snapshot)` и `compileSnapshotText(text)`;
- `validate(snapshot)`;
- `runPipeline(prepared, { pipelineId, payload, context? })`;
- `inspect(prepared)`;
- `computeSourceHash(snapshot)`;
- форматирование диагностик и ошибок выполнения.

Версия 3 принимает только `formatVersion: 2`. Разобранные авторские файлы,
описания, папки, импорты и метаданные проекта относятся к CLI/Studio, а не к
исполняемому снэпшоту.

## Банковское применение

Движок подходит для детерминированных проверок и решений в кредитном конвейере и
платёжном шлюзе: обязательность данных, допуски, согласованность полей, маршрутизация,
флаги санкционных проверок и упорядоченные бизнес-ошибки. Денежная арифметика и
предметные расчёты выполняются специализированными decimal/operator-пакетами;
ядро оркестрирует их логические результаты и аудитные факты. Сервис отвечает за
лимит транспортного размера, аутентификацию, авторизацию, доставку снэпшота и
провенанс подключённых пакетов операторов.

Подробности: [SPEC_RU.md](SPEC_RU.md), [OPERATORS_RU.md](OPERATORS_RU.md),
[MIGRATION_V3.md](MIGRATION_V3.md), [TESTING.md](TESTING.md).
