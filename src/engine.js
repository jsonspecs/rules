const { assert, isObject } = require("./utils");
const { compile } = require("./compiler/index.js");
const { runPipeline } = require("./runner");
const { validate, inspect, compileSnapshot } = require("./public-api");

/**
 * createEngine({ operators })
 *
 * The engine is a thin composition layer that binds operator packs to the core
 * compiler + runtime.
 */
function createEngine({ operators }) {
  assert(isObject(operators), "createEngine: operators must be provided");
  assert(
    isObject(operators.check),
    "createEngine: operators.check must be an object",
  );
  assert(
    isObject(operators.predicate),
    "createEngine: operators.predicate must be an object",
  );

  return {
    compile(artifacts, options = {}) {
      // compiler will validate operator existence; it also returns operators
      return compile(artifacts, { operators, sources: options.sources });
    },

    validate(artifacts, options = {}) {
      return validate(artifacts, { operators, sources: options.sources });
    },

    compileSnapshot(snapshot, options = {}) {
      return compileSnapshot(snapshot, { operators, sources: options.sources });
    },

    inspect,

    runPipeline(compiled, pipelineId, payload, options) {
      return runPipeline(compiled, pipelineId, payload, options);
    },
  };
}

module.exports = { createEngine };
