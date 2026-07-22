export type OperatorOutcome = "PASS" | "FAIL" | "SKIP";
export interface OperatorDefinition {
  /** Closed JSON Schema (draft-07) for field/fields/value/value_field/dictionary/inputs/params. */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly evaluate: (invocation: Readonly<Record<string, unknown>>) => OperatorOutcome;
}
export type OperatorRegistry = Record<string, OperatorDefinition>;

export interface Snapshot {
  format: "jsonspecs-snapshot";
  formatVersion: 2;
  specVersion: "1.0.0-rc.5";
  sourceHash: string;
  exports: string[];
  artifacts: Record<string, Record<string, unknown>>;
}
export interface Diagnostic { code: string; message: string; path?: string; artifactId?: string; }
export interface Issue {
  level: "WARNING" | "ERROR" | "EXCEPTION";
  code: string;
  message: string;
  field: string | null;
  ruleId: string;
  pipelineId: string;
  expected?: unknown;
  actual?: unknown;
  details?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}
export interface PipelineResult {
  status: "OK" | "OK_WITH_WARNINGS" | "ERROR" | "EXCEPTION" | "ABORT";
  issues: Issue[];
  ruleset: { specVersion: string; sourceHash: string };
  error?: { code: string; details: Record<string, unknown> };
}
export interface EvaluationInput { pipelineId: string; payload: Record<string, unknown>; context?: Record<string, unknown>; }
export interface PreparedSnapshot {
  readonly kind: "prepared-jsonspecs";
  readonly artifactType: "jsonspecs-rules";
  readonly formatVersion: 2;
  readonly specVersion: string;
  readonly sourceHash: string;
}
export interface ValidationResult { ok: boolean; diagnostics: Diagnostic[]; identifier?: "OPERATOR_NOT_FOUND"; prepared?: PreparedSnapshot; }
export interface Inspector {
  listArtifacts(filter?: { type?: string }): ReadonlyArray<{ id: string; type: string }>;
  getArtifact(id: string): Readonly<Record<string, unknown>> | null;
  listExports(): readonly string[];
  getPipelineSteps(id: string): readonly string[] | null;
  stats(): { artifacts: number; byType: Readonly<Record<string, number>>; exportCount: number };
}
export interface Engine {
  compileSnapshot(snapshot: Snapshot): PreparedSnapshot;
  compileSnapshotText(text: string): PreparedSnapshot;
  validate(snapshot: Snapshot): ValidationResult;
  runPipeline(prepared: PreparedSnapshot, input: EvaluationInput): PipelineResult;
  inspect(prepared: PreparedSnapshot): Inspector;
}

export class CompilationError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly errors: string[];
  readonly identifier?: "OPERATOR_NOT_FOUND";
}
export function createEngine(options?: { operators?: OperatorRegistry }): Engine;
export const builtInOperators: Readonly<OperatorRegistry>;
export function compileSnapshot(snapshot: Snapshot): PreparedSnapshot;
export function compileSnapshotText(text: string): PreparedSnapshot;
export function validate(snapshot: Snapshot): ValidationResult;
export function runPipeline(prepared: PreparedSnapshot, input: EvaluationInput): PipelineResult;
export function inspect(prepared: PreparedSnapshot): Inspector;
export function computeSourceHash(snapshot: Omit<Snapshot, "sourceHash"> | Snapshot): string;
export function formatDiagnostics(diagnostics: Diagnostic[]): string;
export function formatRuntimeError(error?: { code: string; details: Record<string, unknown> }): string;

declare const api: {
  createEngine: typeof createEngine;
  builtInOperators: typeof builtInOperators;
  CompilationError: typeof CompilationError;
  compileSnapshot: typeof compileSnapshot;
  compileSnapshotText: typeof compileSnapshotText;
  validate: typeof validate;
  runPipeline: typeof runPipeline;
  inspect: typeof inspect;
  computeSourceHash: typeof computeSourceHash;
  formatDiagnostics: typeof formatDiagnostics;
  formatRuntimeError: typeof formatRuntimeError;
};
export default api;
