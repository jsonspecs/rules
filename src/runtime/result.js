"use strict";

/**
 * Закрытый нормативный result envelope.
 *
 * ABORT всегда отбрасывает накопленные business issues. Провенанс ruleset
 * повторяет только версию спеки и sourceHash; engineVersion, trace и control не
 * смешиваются с межъязыковым контрактом результата.
 */

function success(snapshot, issues) {
  return {
    status: status(issues),
    issues,
    ruleset: ruleset(snapshot),
  };
}

function abort(snapshot, error) {
  return {
    status: "ABORT",
    issues: [],
    error: { code: error.code, details: error.details },
    ruleset: ruleset(snapshot),
  };
}

function status(issues) {
  if (issues.some((issue) => issue.level === "EXCEPTION")) return "EXCEPTION";
  if (issues.some((issue) => issue.level === "ERROR")) return "ERROR";
  if (issues.some((issue) => issue.level === "WARNING")) return "OK_WITH_WARNINGS";
  return "OK";
}

function ruleset(snapshot) {
  return { specVersion: snapshot.specVersion, sourceHash: snapshot.sourceHash };
}

module.exports = { success, abort, status };
