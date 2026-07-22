"use strict";

/**
 * Публичная runtime-граница.
 *
 * Сначала проверяется tuple, затем строятся immutable flat-проекции и запускается
 * execution. RuntimeAbort — управляемый технический канал; любой такой сбой
 * превращается в закрытый ABORT и очищает ранее накопленные issues.
 */

const { getPreparedState } = require("../prepared");
const { RuntimeAbort } = require("../errors");
const { validateEvaluationInput } = require("./input");
const { resolver } = require("./flat-map");
const { execute } = require("./execution");
const result = require("./result");

function runPipeline(prepared, input) {
  const state = getPreparedState(prepared);
  if (!state) throw new TypeError("runPipeline expects an artifact produced by compileSnapshot()");
  let validated;
  try {
    validated = validateEvaluationInput(state, input);
  } catch (error) {
    if (error instanceof RuntimeAbort) return result.abort(state.snapshot, error);
    // Hostile JS objects находятся вне I-JSON модели, но публичная банковская
    // граница остаётся never-throws и сводит их к ближайшему закрытому коду.
    return result.abort(state.snapshot, new RuntimeAbort("INVALID_PAYLOAD", { expected: "object" }));
  }
  try {
    const resolve = resolver(validated.payload, validated.context);
    return result.success(state.snapshot, execute(state, resolve, validated.pipelineId));
  } catch (error) {
    if (error instanceof RuntimeAbort) return result.abort(state.snapshot, error);
    // На принятом prepared-снэпшоте сюда может попасть только дефект реализации;
    // не выпускаем host exception через процессную границу.
    return result.abort(state.snapshot, new RuntimeAbort("OPERATOR_FAULT", { ruleId: "<runtime>", operator: "<runtime>" }));
  }
}

module.exports = { runPipeline };
