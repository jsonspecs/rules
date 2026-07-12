import api from "./index.js";

export const {
  createEngine,
  Operators,
  deepGet,
  CompilationError,
  RuntimeError,
  validate,
  compileSnapshot,
  inspect,
  computeSourceHash,
  formatDiagnostics,
  formatRuntimeError,
} = api;

export default api;
