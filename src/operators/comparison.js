"use strict";

/**
 * Общая семантика равенства и упорядоченного сравнения.
 *
 * Здесь намеренно нет JS-coercion. Числовые строки проходят закрытую грамматику,
 * затем переводятся в finite binary64; даты проверяются как календарные, а не
 * только как YYYY-MM-DD. Неопределимое сравнение возвращает null, и оператор
 * преобразует его в FAIL.
 */

const NUMERIC = /^[+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function scalarEquals(left, right) {
  if (left === null || right === null) return left === right;
  if (["boolean", "number", "string"].includes(typeof left) && typeof left === typeof right) return left === right;
  return false;
}

function orderedCompare(left, right) {
  const a = classify(left);
  const b = classify(right);
  if (!a || !b || a.kind !== b.kind) return null;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

function classify(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { kind: "number", value };
  if (typeof value !== "string") return null;
  if (NUMERIC.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? { kind: "number", value: number } : null;
  }
  return isCalendarDate(value) ? { kind: "date", value } : null;
}

function isCalendarDate(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isOrderedLiteral(value) {
  return orderedCompare(value, value) === 0;
}

module.exports = { scalarEquals, orderedCompare, isCalendarDate, isOrderedLiteral };
