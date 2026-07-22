"use strict";

/**
 * Exhaustive ALL/ANY/COUNT поверх wildcard-популяции.
 *
 * В отличие от `when`, агрегаты никогда не short-circuit: поздний fault обязан
 * превратить весь запуск в ABORT. SKIP исключается из эффективной популяции;
 * структурная пустота обрабатывается onEmpty, а непустая all-SKIP популяция
 * всегда даёт SKIP.
 */

function evaluateAggregate(rule, matches, evaluateOne) {
  const settings = rule.aggregate;
  const mode = settings.mode;
  if (!matches.length) {
    const outcome = settings.onEmpty || "SKIP";
    return {
      outcome,
      failures: [],
      summary: outcome === "FAIL",
      details: outcome === "FAIL" ? counters(mode, 0, 0, 0, 0, 0) : null,
    };
  }

  const results = matches.map(evaluateOne); // намеренно exhaustive
  const failures = results.filter((item) => item.outcome === "FAIL");
  const passed = results.filter((item) => item.outcome === "PASS").length;
  const skipped = results.filter((item) => item.outcome === "SKIP").length;
  const evaluated = results.length - skipped;
  if (!evaluated) return { outcome: "SKIP", failures: [], summary: false, details: null };

  let pass;
  if (mode === "ALL") pass = failures.length === 0;
  else if (mode === "ANY") pass = passed > 0;
  else pass = compareCount(passed, settings.op || ">=", settings.value);
  if (pass) return { outcome: "PASS", failures: [], summary: false, details: null };

  const base = counters(mode, results.length, evaluated, skipped, passed, failures.length);
  const details = mode === "COUNT" ? { mode, op: settings.op || ">=", value: settings.value, ...withoutMode(base) } : base;
  const summary = mode === "COUNT" || settings.issueMode === "SUMMARY";
  return { outcome: "FAIL", failures: summary ? [] : failures, summary, details };
}

function counters(mode, matched, evaluated, skipped, passed, failed) {
  return { mode, matched, evaluated, skipped, passed, failed };
}

function withoutMode(details) {
  const { mode: _ignored, ...rest } = details;
  return rest;
}

function compareCount(actual, op, expected) {
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  if (op === ">") return actual > expected;
  if (op === ">=") return actual >= expected;
  if (op === "<") return actual < expected;
  return actual <= expected;
}

module.exports = { evaluateAggregate, compareCount };
