export type DiagnosticLevel = "error" | "warning";
export interface Diagnostic { code: string; level: DiagnosticLevel; message: string; phase: string; artifactId: string | null; pipelineId?: string | null; ruleId?: string | null; path: string | null; location: string | null; details?: Record<string, unknown> | null; }
export interface Issue { kind: "ISSUE"; level: "WARNING" | "ERROR" | "EXCEPTION"; code: string; message?: string; field?: string | null; ruleId: string; pipelineId?: string; stepId?: string; expected?: unknown; actual?: unknown; meta?: Record<string, unknown>; }
export type TraceMode = false | "basic" | "verbose";
export type TraceStep = "pipeline.start" | "pipeline.finish" | "pipeline.abort" | "pipeline.strict" | "rule.start" | "rule.finish" | "condition.evaluate" | "predicate.aggregate" | "check.aggregate" | "context.required" | "operator.trace";
export interface TraceEntry { kind: "TRACE"; artifactType: "jsonspecs"; step: TraceStep; artifactId: string | null; outcome: string | null; at: string; details?: unknown; }
export interface RuntimeErrorShape { code: string; message: string; details: Record<string, unknown> | null; }
export interface PipelineResult { status: "OK" | "OK_WITH_WARNINGS" | "ERROR" | "EXCEPTION" | "ABORT"; control: "CONTINUE" | "STOP"; issues: Issue[]; trace?: TraceEntry[]; error?: RuntimeErrorShape; }
export interface OperatorContext { payload: Record<string, unknown>; payloadKeys: string[]; get(path: string): { ok: true; value: unknown } | { ok: false; value: undefined }; has(path: string): boolean; getDictionary(id: string): Record<string, unknown> | null; trace?(message: string, details?: Record<string, unknown>): void; }
export interface CheckResult { status: "OK" | "FAIL" | "EXCEPTION"; error?: Error; field?: string; actual?: unknown; meta?: Record<string, unknown>; failures?: Array<{ field: string; actual?: unknown; meta?: Record<string, unknown> }>; }
export interface PredicateResult { status: "TRUE" | "FALSE" | "UNDEFINED" | "EXCEPTION"; error?: Error; }
export type CheckOperator = (rule: Record<string, any>, ctx: OperatorContext) => CheckResult;
export type PredicateOperator = (rule: Record<string, any>, ctx: OperatorContext) => PredicateResult;
export interface OperatorPack { check: Record<string, CheckOperator>; predicate: Record<string, PredicateOperator>; meta?: Record<string, unknown>; }
export interface PreparedArtifact { readonly kind: "prepared-jsonspecs"; readonly artifactType: "jsonspecs"; readonly version: string; readonly sourceHash: string; readonly diagnostics: readonly Diagnostic[]; }
export interface CompileOptions { sources?: ReadonlyMap<string, string | { file: string; line?: number; column?: number }>; }
export interface RunOptions { trace?: boolean | "basic" | "verbose"; traceRedactor?: (value: unknown, mode: Exclude<TraceMode, false>) => unknown; debug?: boolean; }
export interface EvaluationInput { pipelineId?: string; payload: Record<string, unknown>; context?: Record<string, unknown>; }
export interface Inspector { listArtifacts(filter?: { type?: string }): ReadonlyArray<Record<string, unknown>>; getArtifact(id: string): Readonly<Record<string, any>> | null; listEntrypoints(): ReadonlyArray<Record<string, unknown>>; getPipelineSteps(id: string): unknown[] | null; getConditionModel(id: string): Record<string, any> | null; listDictionaries(): ReadonlyArray<Record<string, unknown>>; getDictionary(id: string): Readonly<Record<string, unknown>> | null; stats(): { artifacts: number; byType: Readonly<Record<string, number>>; entrypointCount: number }; }
export interface Engine { compile(artifacts: Record<string, any>[], options?: CompileOptions): PreparedArtifact; validate(artifacts: Record<string, any>[], options?: CompileOptions): { ok: boolean; diagnostics: Diagnostic[] }; compileSnapshot(snapshot: Snapshot, options?: CompileOptions): PreparedArtifact; inspect(artifact: PreparedArtifact): Inspector; runPipeline(artifact: PreparedArtifact, input: EvaluationInput, options?: RunOptions): PipelineResult; /** @deprecated */ runPipeline(artifact: PreparedArtifact, pipelineId: string, payload: Record<string, unknown>, options?: RunOptions): PipelineResult; }
export interface Snapshot { format: "jsonspecs-snapshot"; formatVersion: 1; sourceHash: string; engine: { minVersion: string }; artifacts: Record<string, any>[]; meta?: { projectId?: string; projectTitle?: string; description?: string }; }
export function createEngine(options: { operators: OperatorPack }): Engine;
export const Operators: OperatorPack;
export function validate(artifacts: Record<string, any>[], options?: CompileOptions & { operators?: OperatorPack }): { ok: boolean; diagnostics: Diagnostic[] };
export function compileSnapshot(snapshot: Snapshot, options?: CompileOptions & { operators?: OperatorPack }): PreparedArtifact;
export function inspect(artifact: PreparedArtifact): Inspector;
export function computeSourceHash(artifacts: Record<string, any>[]): string;
export function formatDiagnostics(diagnostics: Diagnostic[]): string;
export function formatRuntimeError(error: RuntimeErrorShape): string;
export function deepGet(obj: Record<string, unknown>, path: string): { ok: true; value: unknown } | { ok: false; value: undefined };
export class CompilationError extends Error { readonly errors: string[]; readonly diagnostics: Diagnostic[]; constructor(diagnostics: Array<string | Diagnostic>); }
export class RuntimeError extends Error { readonly code: string; readonly details: Record<string, unknown> | null; constructor(input: RuntimeErrorShape); }

declare const jsonspecs: {
  createEngine: typeof createEngine;
  Operators: typeof Operators;
  validate: typeof validate;
  compileSnapshot: typeof compileSnapshot;
  inspect: typeof inspect;
  computeSourceHash: typeof computeSourceHash;
  formatDiagnostics: typeof formatDiagnostics;
  formatRuntimeError: typeof formatRuntimeError;
  deepGet: typeof deepGet;
  CompilationError: typeof CompilationError;
  RuntimeError: typeof RuntimeError;
};
export default jsonspecs;
