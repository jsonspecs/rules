import api from "./index.js";

/** ESM-обёртка над единственным CommonJS-источником публичного API. */

export const {
  createEngine,
  builtInOperators,
  CompilationError,
  compileSnapshot,
  compileSnapshotText,
  validate,
  runPipeline,
  inspect,
  computeSourceHash,
  formatDiagnostics,
  formatRuntimeError,
} = api;

export default api;
