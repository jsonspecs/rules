"use strict";

/**
 * Ошибки публичных границ библиотеки.
 *
 * CompilationError относится к отказу снэпшота до исполнения. RuntimeAbort
 * используется только внутри рантайма и всегда превращается в нормативный
 * результат со status=ABORT, поэтому наружу из runPipeline не выбрасывается.
 */

class CompilationError extends Error {
  constructor(diagnostics, identifier = null) {
    const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
    super(list[0]?.message || "Snapshot rejected");
    this.name = "CompilationError";
    this.diagnostics = list.map(normalizeDiagnostic);
    this.errors = this.diagnostics.map((item) => item.message);
    if (identifier) this.identifier = identifier;
  }
}

class RuntimeAbort extends Error {
  constructor(code, details, message = null) {
    super(message || code);
    this.name = "RuntimeAbort";
    this.code = code;
    this.details = details;
  }
}

function normalizeDiagnostic(value) {
  if (typeof value === "string") return { code: "SNAPSHOT_REJECTED", message: value };
  return {
    code: value?.code || "SNAPSHOT_REJECTED",
    message: value?.message || "Snapshot rejected",
    ...(value?.path == null ? {} : { path: value.path }),
    ...(value?.artifactId == null ? {} : { artifactId: value.artifactId }),
  };
}

function reject(code, message, options = {}) {
  throw new CompilationError([{ code, message, ...options }], options.identifier || null);
}

module.exports = { CompilationError, RuntimeAbort, reject };
