# Операторы

## Встроенные

Присутствие: `not_empty`, `is_empty`, `not_true`, `any_filled`.

Типы и значения: `is_boolean`, `is_string`, `is_number`, `is_integer`, `equals`,
`not_equals`, `contains`, `length_equals`, `length_max`.

Сравнения: `greater_than`, `less_than`, `field_equals_field`,
`field_not_equals_field`, `field_greater_than_field`, `field_less_than_field`,
`field_greater_or_equal_than_field`, `field_less_or_equal_than_field`.

Паттерны и справочники: `matches_regex`, `not_matches_regex`, `in_dictionary`,
`not_in_dictionary`. Точные схемы и семантика заданы в `SPEC_RU.md` §3.

## Внешний оператор

Внешний пакет экспортирует `{ schema, evaluate }`. Закрытая JSON Schema draft-07
проверяет только настроенные операнды конкретного правила: `field`, `value`,
`value_field`, `dictionary`, `inputs`, `params`. Поле `fields` зарезервировано для
встроенного `any_filled`.

Ядро разрешает пути до вызова. Отсутствующий настроенный `field` или `value_field`
даёт `SKIP` без вызова value-оператора. Для именованных `inputs` отсутствие пути
означает отсутствие ключа в `invocation.inputs`, а JSON `null` остаётся
присутствующим значением.

`evaluate` — синхронная детерминированная функция с результатом `PASS`, `FAIL` или
`SKIP`. Она не читает время, региональные настройки (locale), сеть или глобальное
состояние и не меняет входные значения. Межъязыковой пакет публикует эквивалентные
схемы и общий набор эталонных примеров по `SPEC_RU.md` §7.1.

`builtInOperators` экспортирует глубоко замороженные определения для просмотра.
Потребитель не может изменить ни схему, ни её вложенные элементы.
