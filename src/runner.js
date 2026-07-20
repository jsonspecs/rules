const {
  assert,
  makeTrace,
  deepGet,
  toComparable,
  isWildcardField,
  expandWildcardKeys,
  materializeWildcardPattern,
  wildcardGroupBasePattern,
  expandWildcardGroups,
} = require("./utils");
const {
  DEFAULT_MAX_JSON_DEPTH,
  flattenPayloadSafe,
  cloneContextSafe,
  exceedsMaxJsonDepth,
  normalizeTransportSafe,
  hasOwn,
} = require("./safe-json");
const { getPreparedState } = require("./prepared");
const { RuntimeError } = require("./compiler/compilation-error");

function compareCount(op, left, right) {
  switch (op) {
    case "==":
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    default:
      throw new Error(`Unsupported COUNT operator: ${op}`);
  }
}

function traceValue(value) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return "[array]";
  if (typeof value === "object") return "[object]";
  return String(value);
}

function onEmptyBehavior(rule, defaultBehavior) {
  const ae = rule && rule.aggregate && rule.aggregate.onEmpty;
  return ae || defaultBehavior;
}

function applyStrictBoundary(pipeline, issues, issuesStart, stepId, traceFn) {
  if (!pipeline || pipeline.strict !== true) return false;

  const localIssues = issues.slice(issuesStart);
  const hasErrors = localIssues.some(
    (i) => i && (i.level === "ERROR" || i.level === "EXCEPTION"),
  );

  if (!hasErrors) return false;

  const code = pipeline.strictCode || "STRICT_PIPELINE_FAILED";
  issues.push({
    kind: "ISSUE",
    level: "EXCEPTION",
    code,
    message: pipeline.message,
    field: null,
    ruleId: `pipeline:${pipeline.id}`,
    pipelineId: pipeline.id,
    stepId: stepId || undefined,
  });
  traceFn("pipeline.strict", "stop", {
    pipelineId: pipeline.id,
    code,
  }, pipeline.id);
  return true;
}

function checkRequiredContext(pipeline, ctxBase, issues, trace, stepId = null) {
  const required = Array.isArray(pipeline && pipeline.required_context)
    ? pipeline.required_context
    : [];
  if (required.length === 0) return false;

  const missing = required.filter((key) => {
    const got = deepGet(ctxBase.payload, `$context.${key}`);
    return !got.ok;
  });

  if (missing.length === 0) return false;

  const t = makeTrace(trace, pipeline.id);
  t("context.required", "missing_context", { pipelineId: pipeline.id, missing, stepId });

  for (const key of missing) {
    issues.push({
      kind: "ISSUE",
      level: "EXCEPTION",
      code: `CTX.${String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}.REQUIRED`,
      message: `Missing required runtime context field: ${key}`,
      field: `$context.${key}`,
      ruleId: `pipeline:${pipeline.id}`,
      pipelineId: pipeline.id,
      stepId,
    });
  }

  return true;
}

function runPipeline(compiled, pipelineId, payload, options) {
  let provenance = null;
  let inputContext = undefined;
  let hasInputContext = false;
  if (pipelineId && typeof pipelineId === "object") {
    const input = pipelineId;
    options = payload || {};
    pipelineId = input.pipelineId;
    payload = input.payload;
    if (hasOwn(input, "context")) {
      inputContext = input.context;
      hasInputContext = true;
    }
  }
  options = options || {};
  const traceMode = options.trace === true ? "basic" : (options.trace || false);
  const traceEnabled = traceMode === "basic" || traceMode === "verbose";
  const trace = [];
  const issues = [];
  const traceTarget = traceEnabled ? trace : [];
  const traceFn = makeTrace(traceTarget, `pipeline:${pipelineId}`);

  try {
    const state = getPreparedState(compiled);
    if (!state) throw new RuntimeError({ code: "INVALID_COMPILED_ARTIFACT", message: "runPipeline expects an artifact produced by compile()" });
    const { registry, dictionaries, operators, pipelines, conditions } = state;
    provenance = state.provenance || null;
    if (!pipelineId) {
      const entrypoints = [...registry.values()].filter((item) => item.type === "pipeline" && item.entrypoint === true);
      if (entrypoints.length !== 1) throw new RuntimeError({ code: "PIPELINE_ID_REQUIRED", message: "pipelineId is required unless exactly one entrypoint exists", details: { entrypointCount: entrypoints.length } });
      pipelineId = entrypoints[0].id;
    }
    const flat = flattenPayloadSafe(payload || {});
    const contextSource = hasInputContext
      ? inputContext
      : (payload && hasOwn(payload, "__context") ? payload.__context : undefined);
    const context = contextSource === undefined ? Object.create(null) : cloneContextSafe(contextSource);
    const enrichedPayload = Object.assign(Object.create(null), flat, { __context: context });
    const payloadKeys = Object.keys(flat);
    const wildcardCache = new Map();
    const ctxBase = { payload: enrichedPayload, payloadKeys, wildcardCache, getDictionary: (id) => dictionaries.get(id) || null, get: (path) => deepGet(enrichedPayload, path), has: (path) => deepGet(enrichedPayload, path).ok };
    const pipeline = registry.get(pipelineId);
    if (!pipeline || pipeline.type !== "pipeline") throw new RuntimeError({ code: "PIPELINE_NOT_FOUND", message: `Pipeline not found: ${pipelineId}`, details: { pipelineId, availablePipelines: [...pipelines.keys()] } });
    traceFn("pipeline.start", "start", { traceMode }, pipelineId);

    const compiledPipe = pipelines.get(pipelineId);
    assert(
      compiledPipe,
      `runPipeline: compiled pipeline not found: ${pipelineId}`,
    );

    const pipelineArtifact = registry.get(pipelineId);
  assert(pipelineArtifact && pipelineArtifact.type === "pipeline", `Missing pipeline ${pipelineId}`);
  if (checkRequiredContext(pipelineArtifact, ctxBase, issues, traceTarget)) {
    traceFn("pipeline.finish", "exception", { issueCount: issues.length }, pipelineId);
    return finishResult({ status: "EXCEPTION", control: "STOP", issues }, traceMode, trace, options, provenance);
  }

  const control = execSteps(
      registry,
      operators,
      pipelines,
      conditions,
      compiledPipe.steps,
      pipeline.id,
      ctxBase,
      issues,
      traceTarget,
      `pipeline:${pipelineId}`,
    );

    if (applyStrictBoundary(pipelineArtifact, issues, 0, null, traceFn)) {
      traceFn("pipeline.finish", "exception", { issueCount: issues.length }, pipelineId);
      return finishResult({ status: "EXCEPTION", control: "STOP", issues }, traceMode, trace, options, provenance);
    }

    const hasException = control === "STOP";
    const hasErrors = issues.some(
      (i) => i.level === "ERROR" || i.level === "EXCEPTION",
    );
    const hasWarnings = issues.some((i) => i.level === "WARNING");

    const status = hasException
      ? "EXCEPTION"
      : hasErrors
        ? "ERROR"
        : hasWarnings
          ? "OK_WITH_WARNINGS"
          : "OK";

    const ctrl = hasException || hasErrors ? "STOP" : "CONTINUE";

    traceFn("pipeline.finish", status.toLowerCase(), { issueCount: issues.length }, pipelineId);
    return finishResult({ status, control: ctrl, issues }, traceMode, trace, options, provenance);
  } catch (e) {
    traceFn("pipeline.abort", "abort", {
      pipelineId,
      error: String(e && e.message ? e.message : e),
    }, pipelineId);
    return finishResult({
      status: "ABORT",
      control: "STOP",
      issues,
      error: { code: e && e.code ? e.code : "RUNTIME_ABORT", message: e && e.message ? e.message : String(e), details: e && e.details ? e.details : null },
    }, traceMode, trace, options, provenance);
  }
}

function finishResult(result, traceMode, trace, options, provenance) {
  try {
    if (provenance) result.ruleset = provenance;
    if (traceMode) {
      try {
        result.trace = trace.map((entry) => sanitizeTraceEntry(entry, traceMode, options && options.traceRedactor));
      } catch (error) {
        return normalizeTransportSafe(finishAbortResult({
          code: "TRACE_REDACTOR_ERROR",
          message: error && error.message ? error.message : String(error),
          issues: Array.isArray(result.issues) ? result.issues : [],
          trace,
          traceMode,
          provenance,
        }));
      }
    }
    return normalizeTransportSafe(result);
  } catch (error) {
    return normalizeTransportSafe(finishAbortResult({
      code: "RUNTIME_ABORT",
      message: error && error.message ? error.message : String(error),
      issues: [],
      trace,
      traceMode,
      provenance,
    }));
  }
}

function finishAbortResult({ code, message, issues, trace, traceMode, provenance }) {
  const aborted = {
    status: "ABORT",
    control: "STOP",
    issues,
    error: { code, message, details: null },
  };
  if (provenance) aborted.ruleset = provenance;
  if (traceMode) {
    try {
      aborted.trace = trace.map((entry) => sanitizeTraceEntry(entry, "basic", null));
    } catch (_) {
      aborted.trace = [];
    }
  }
  return aborted;
}

function sanitizeTraceEntry(entry, mode, redactor) {
  if (entry.details === undefined) return { ...entry };
  if (mode === "verbose") return { ...entry, details: typeof redactor === "function" ? redactor(entry.details, mode) : entry.details };
  if (mode === "basic" && entry.step === "operator.trace") return { ...entry, details: { redacted: true } };
  return { ...entry, details: sanitizeBasicTraceDetails(entry.details) };
}

function sanitizeBasicTraceDetails(details) {
  const sensitive = new Set(["actual", "value", "pickedValue", "matchedSample", "failedSample", "meta", "error"]);
  const output = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (sensitive.has(key)) continue;
    output[key] = value;
  }
  return output;
}

function operatorTraceDetails(message, details) {
  const normalized = normalizeTransportSafe(details);
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return { message, ...normalized };
  }
  return normalized === undefined ? { message } : { message, details: normalized };
}

function execSteps(
  registry,
  operators,
  pipelines,
  conditions,
  steps,
  scopePipelineId,
  ctxBase,
  issues,
  trace,
  scope,
) {
  const t = makeTrace(trace, scopePipelineId);

  for (const step of steps) {
    const kind = step.kind;
    const stepId = step.stepId;

    if (kind === "rule") {
      const rule = registry.get(step.ruleId);
      assert(rule, `Missing rule ${step.ruleId} (from ${step.ref})`);
      const actualValue = rule.field && deepGet(ctxBase.payload, rule.field).ok
        ? deepGet(ctxBase.payload, rule.field).value
        : undefined;
      t("rule.start", "start", {
        stepId,
        ruleId: rule.id,
        ref: step.ref,
        role: rule.role,
        description: rule.description || '',
        field: rule.field || '',
        operator: rule.operator || '',
        value: traceValue(rule.value),
        actual: traceValue(actualValue),
        meta: rule.meta !== undefined ? rule.meta : null,
      }, rule.id);

      if (rule.role === "predicate") {
        const res = evalPredicate(operators, rule, ctxBase, trace, scope);
        t("rule.finish", res.status.toLowerCase(), { ruleId: rule.id, status: res.status }, rule.id);
        if (res.status === "EXCEPTION") throwEvaluationException(res);
        continue;
      }

      const res = evalCheck(operators, rule, ctxBase, trace, scope);
      if (res.status === "EXCEPTION") throwEvaluationException(res);

      // Логируем результат проверки в трейс
      t("rule.finish", res.status.toLowerCase(), {
        ruleId: rule.id,
        status: res.status,   // "OK" | "FAIL"
        level: rule.level,
        code: rule.code || '',
      }, rule.id);

      if (res.status === "FAIL") {
        // evalCheck may return a single failure (non-wildcard or aggregated)
        // or multiple failures (wildcard per-element). Normalize to array.
        const fails = Array.isArray(res.failures) ? res.failures : [res];

        for (const f of fails) {
          const issueField = f.field ?? rule.field ?? null;
          const expected = Object.prototype.hasOwnProperty.call(rule, "value")
            ? rule.value
            : Object.prototype.hasOwnProperty.call(rule, "dictionary")
              ? rule.dictionary
              : undefined;
          issues.push({
            kind: "ISSUE",
            level: rule.level,
            code: rule.code,
            message: rule.message,
            field: issueField,
            ruleId: rule.id,
            pipelineId: scopePipelineId,
            expected,
            actual: Object.prototype.hasOwnProperty.call(f, "actual")
              ? f.actual
              : deepGet(ctxBase.payload, issueField).ok
                ? deepGet(ctxBase.payload, issueField).value
                : undefined,
            stepId,
            meta: f.meta || undefined,
          });
        }

        if (rule.level === "EXCEPTION") {
          t("rule.finish", "stop", {
            ruleId: rule.id,
            code: rule.code,
          }, rule.id);
          return "STOP";
        }
      }
      continue;
    }

    if (kind === "pipeline") {
      const p = registry.get(step.pipelineId);
      assert(p && p.type === "pipeline", `Missing pipeline ${step.pipelineId}`);
      const compiledPipe = pipelines.get(p.id);
      assert(compiledPipe, `Missing compiled pipeline ${p.id}`);

      t("pipeline.start", "start", { stepId, pipelineId: p.id, description: p.description || '' }, p.id);
      const issuesStart = issues.length;
      const nestedPipelineArtifact = registry.get(p.id);
      assert(nestedPipelineArtifact && nestedPipelineArtifact.type === "pipeline", `Missing pipeline ${p.id}`);
      if (checkRequiredContext(nestedPipelineArtifact, ctxBase, issues, trace, stepId)) {
        t("pipeline.finish", "missing_context", { pipelineId: p.id, stepId }, p.id);
        return "STOP";
      }

      const control = execSteps(
        registry,
        operators,
        pipelines,
        conditions,
        compiledPipe.steps,
        p.id,
        ctxBase,
        issues,
        trace,
        `pipeline:${p.id}`,
      );

      // strict pipelines: if they produced at least one ERROR/EXCEPTION issue, raise a boundary EXCEPTION
      if (applyStrictBoundary(p, issues, issuesStart, stepId, t)) {
        t("pipeline.finish", "exception", { pipelineId: p.id, stepId, issueCount: issues.length - issuesStart }, p.id);
        return "STOP";
      }

      if (control === "STOP") {
        t("pipeline.finish", "exception", { pipelineId: p.id, stepId, issueCount: issues.length - issuesStart }, p.id);
        return "STOP";
      }
      t("pipeline.finish", "complete", { pipelineId: p.id, stepId, issueCount: issues.length - issuesStart }, p.id);
      continue;
    }

    if (kind === "condition") {
      const c = registry.get(step.conditionId);
      assert(
        c && c.type === "condition",
        `Missing condition ${step.conditionId}`,
      );
      const compiledCond = conditions.get(c.id);
      assert(compiledCond, `Missing compiled condition ${c.id}`);

      t("condition.evaluate", "start", {
        stepId,
        conditionId: c.id,
        ref: step.ref,
        description: c.description || '',
      }, c.id);

      const control = evalCondition(
        registry,
        operators,
        pipelines,
        conditions,
        c,
        compiledCond,
        ctxBase,
        issues,
        trace,
        scopePipelineId,
      );
      if (control === "STOP") return "STOP";
      continue;
    }
  }

  return "CONTINUE";
}

function evalPredicate(operators, rule, ctxBase, trace, scope) {
  const t = makeTrace(trace, rule.id);
  const rawOp = operators.predicate[rule.operator];
  const op = (...args) => invokeOperator("predicate", rule, rawOp, args);
  try {
    const ctx = Object.assign({}, ctxBase, { trace: (message, details) => t("operator.trace", "info", operatorTraceDetails(message, details)) });

    // Wildcard aggregation for predicates
    if (isWildcardField(rule.field)) {
      const cacheKey = `pred:${rule.field}`;
      let keys = ctx.wildcardCache.get(cacheKey);
      if (!keys) {
        keys = expandWildcardKeys(rule.field, ctx.payloadKeys || []);
        ctx.wildcardCache.set(cacheKey, keys);
      }

      const aggregateMode = (rule.aggregate && rule.aggregate.mode) || "ANY";

      if (keys.length === 0) {
        const beh = onEmptyBehavior(rule, "UNDEFINED");
        t("predicate.aggregate", "empty", {
          pattern: rule.field,
          aggregateMode,
          onEmpty: beh,
        });

        if (beh === "TRUE") {
          t("predicate.aggregate", "true", {
            patternField: rule.field,
            aggregateMode,
            matchedCount: 0,
            onEmpty: beh,
            result: "TRUE",
          });
          return { status: "TRUE" };
        }
        if (beh === "FALSE") {
          t("predicate.aggregate", "false", {
            patternField: rule.field,
            aggregateMode,
            matchedCount: 0,
            onEmpty: beh,
            result: "FALSE",
          });
          return { status: "FALSE" };
        }
        if (beh === "ERROR") {
          return {
            status: "EXCEPTION",
            error: new Error(
              `Wildcard pattern matched 0 fields: ${rule.field}`,
            ),
          };
        }

        // UNDEFINED -> treat as FALSE (consistent with non-wildcard)
        t("predicate.aggregate", "undefined_as_false", { ruleId: rule.id });
        t("predicate.aggregate", "false", {
          patternField: rule.field,
          aggregateMode,
          matchedCount: 0,
          onEmpty: beh,
          result: "FALSE",
        });
        return { status: "FALSE" };
      }

      const results = [];
      for (const k of keys) {
        const rr = op(
          Object.assign({}, rule, { field: k, _patternField: rule.field }),
          ctx,
        );
        if (rr.status === "EXCEPTION") return rr;
        // Treat UNDEFINED as FALSE (consistent with non-wildcard)
        results.push(rr.status === "TRUE");
      }

      let finalStatus = "FALSE";
      let passCount = undefined;
      let countOp = undefined;
      let target = undefined;

      if (aggregateMode === "ANY") {
        finalStatus = results.some(Boolean) ? "TRUE" : "FALSE";
      } else if (aggregateMode === "ALL") {
        finalStatus = results.every(Boolean) ? "TRUE" : "FALSE";
      } else if (aggregateMode === "COUNT") {
        passCount = results.filter(Boolean).length;
        countOp = (rule.aggregate && rule.aggregate.op) || ">=";
        target = Number(rule.aggregate && rule.aggregate.value);
        if (!Number.isFinite(target))
          throw new Error(`COUNT aggregate requires numeric aggregate.value`);
        finalStatus = compareCount(countOp, passCount, target)
          ? "TRUE"
          : "FALSE";
      } else {
        throw new Error(
          `Unsupported predicate aggregate.mode: ${aggregateMode}`,
        );
      }

      t("predicate.aggregate", finalStatus.toLowerCase(), {
        patternField: rule.field,
        aggregateMode,
        matchedCount: keys.length,
        matchedSample: keys.slice(0, 5),
        passCount,
        op: countOp,
        target,
        result: finalStatus,
      });

      return { status: finalStatus };
    }

    const res = op(rule, ctx);
    if (res.status === "UNDEFINED") {
      t("rule.finish", "undefined_as_false", { ruleId: rule.id });
      return { status: "FALSE" };
    }
    return res;
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
}

function evalCheck(operators, rule, ctxBase, trace, scope) {
  const t = makeTrace(trace, rule.id);
  const rawOp = operators.check[rule.operator];
  const op = (...args) => invokeOperator("check", rule, rawOp, args);
  try {
    const ctx = Object.assign({}, ctxBase, { trace: (message, details) => t("operator.trace", "info", operatorTraceDetails(message, details)) });

    const groupedFields = Array.isArray(rule.fields) ? rule.fields : Array.isArray(rule.paths) ? rule.paths : [];
    if (rule.operator === "any_filled" && groupedFields.length > 0 && groupedFields.every(isWildcardField)) {
      const basePattern = wildcardGroupBasePattern(groupedFields);
      if (!basePattern) throw new RuntimeError({ code: "WILDCARD_GROUP_INVALID", message: "any_filled wildcard fields must share one base pattern", details: { ruleId: rule.id, fields: groupedFields } });
      const aggregateMode = rule.aggregate && rule.aggregate.mode || "EACH";
      const cacheKey = `any_filled:${basePattern}`;
      let groups = ctx.wildcardCache.get(cacheKey);
      if (!groups) { groups = expandWildcardGroups(basePattern, ctx.payloadKeys || []); ctx.wildcardCache.set(cacheKey, groups); }
      if (groups.length === 0) {
        const behavior = onEmptyBehavior(rule, "PASS");
        t("check.aggregate", "empty", { pattern: basePattern, aggregateMode, onEmpty: behavior });
        if (behavior === "ERROR") throw new RuntimeError({ code: "WILDCARD_EMPTY", message: `Wildcard fields matched no groups: ${basePattern}` });
        return behavior === "FAIL" ? { status: "FAIL", field: groupedFields[0], meta: { reason: "WILDCARD_EMPTY", patterns: groupedFields } } : { status: "OK" };
      }
      const failures = [];
      for (const group of groups) {
        const fields = groupedFields.map((field) => materializeWildcardPattern(field, group.indexes));
        const result = op(Object.assign({}, rule, { fields, paths: undefined, _patternFields: groupedFields, _patternBase: basePattern }), ctx);
        if (result.status === "EXCEPTION") return result;
        if (result.status === "FAIL") failures.push({ status: "FAIL", field: materializeWildcardPattern(basePattern, group.indexes), actual: undefined, meta: { reason: "ANY_FILLED_GROUP_EMPTY", patterns: groupedFields, indexes: group.indexes } });
      }
      t("check.aggregate", failures.length ? "fail" : "ok", { pattern: basePattern, aggregateMode, matchedCount: groups.length, failedCount: failures.length });
      if (failures.length === 0) return { status: "OK" };
      if (aggregateMode === "ALL" && rule.aggregate && rule.aggregate.summaryIssue === true) return { status: "FAIL", field: basePattern, actual: failures.length, meta: { reason: "ANY_FILLED_GROUPS_FAILED", patterns: groupedFields, failedCount: failures.length, mode: "ALL" } };
      return { status: "FAIL", failures };
    }

    // Wildcard / aggregation for check-rules
    if (isWildcardField(rule.field)) {
      const cacheKey = `check:${rule.field}`;
      let keys = ctx.wildcardCache.get(cacheKey);
      if (!keys) {
        keys = expandWildcardKeys(rule.field, ctx.payloadKeys || []);
        ctx.wildcardCache.set(cacheKey, keys);
      }

      const aggregateMode = (rule.aggregate && rule.aggregate.mode) || "EACH";

      if (keys.length === 0) {
        const beh = onEmptyBehavior(rule, "PASS");
        t("check.aggregate", "empty", {
          pattern: rule.field,
          aggregateMode,
          onEmpty: beh,
        });

        if (beh === "FAIL") {
          t("check.aggregate", "fail", {
            patternField: rule.field,
            aggregateMode,
            matchedCount: 0,
            onEmpty: beh,
            result: "FAIL",
          });
          return {
            status: "FAIL",
            field: rule.field,
            actual: undefined,
            meta: { reason: "WILDCARD_EMPTY" },
          };
        }
        if (beh === "ERROR")
          throw new Error(`Wildcard pattern matched 0 fields: ${rule.field}`);

        // PASS or UNDEFINED -> treat as OK (do not create issues)
        t("check.aggregate", "ok", {
          patternField: rule.field,
          aggregateMode,
          matchedCount: 0,
          onEmpty: beh,
          result: "OK",
        });
        return { status: "OK" };
      }

      // EACH / ALL (per-element issues) as default
      if (aggregateMode === "EACH" || aggregateMode === "ALL") {
        const failures = [];
        for (const k of keys) {
          const rr = op(
            Object.assign({}, rule, { field: k, _patternField: rule.field }),
            ctx,
          );
          if (rr.status === "EXCEPTION") return rr;
          if (rr.status === "FAIL") {
            const got = deepGet(ctx.payload, k);
            failures.push({
              status: "FAIL",
              field: k,
              actual: got.ok ? got.value : undefined,
              meta: { pattern: rule.field },
            });
          }
        }

        t("check.aggregate", failures.length === 0 ? "ok" : "fail", {
          patternField: rule.field,
          aggregateMode,
          matchedCount: keys.length,
          matchedSample: keys.slice(0, 5),
          failedCount: failures.length,
          failedSample: failures.slice(0, 5).map((f) => f.field),
          result: failures.length === 0 ? "OK" : "FAIL",
        });

        if (failures.length === 0) return { status: "OK" };

        // Optional summaryIssue: collapse to one issue if configured.
        if (
          aggregateMode === "ALL" &&
          rule.aggregate &&
          rule.aggregate.summaryIssue === true
        ) {
          return {
            status: "FAIL",
            field: rule.field,
            actual: failures.length,
            meta: {
              pattern: rule.field,
              failedCount: failures.length,
              mode: "ALL",
            },
          };
        }

        return { status: "FAIL", failures };
      }

      if (aggregateMode === "COUNT") {
        // Count PASS results of applying operator to each element.
        let passCount = 0;
        for (const k of keys) {
          const rr = op(
            Object.assign({}, rule, { field: k, _patternField: rule.field }),
            ctx,
          );
          if (rr.status === "EXCEPTION") return rr;
          if (rr.status === "OK") passCount++;
        }
        const opStr = (rule.aggregate && rule.aggregate.op) || ">=";
        const target = Number(rule.aggregate && rule.aggregate.value);
        if (!Number.isFinite(target))
          throw new Error(`COUNT aggregate requires numeric aggregate.value`);
        const ok = compareCount(opStr, passCount, target);

        t("check.aggregate", ok ? "ok" : "fail", {
          patternField: rule.field,
          aggregateMode,
          matchedCount: keys.length,
          matchedSample: keys.slice(0, 5),
          passCount,
          op: opStr,
          target,
          result: ok ? "OK" : "FAIL",
        });

        return ok
          ? { status: "OK" }
          : {
              status: "FAIL",
              field: rule.field,
              actual: passCount,
              meta: {
                mode: "COUNT",
                op: opStr,
                value: target,
                matched: keys.length,
              },
            };
      }

      if (aggregateMode === "MIN" || aggregateMode === "MAX") {
        // Aggregate the actual values (numbers or strict YMD dates) and apply the operator once to the aggregated value.
        const vals = [];
        for (const k of keys) {
          const got = deepGet(ctx.payload, k);
          if (!got.ok) continue;
          const c = toComparable(got.value);
          if (c) vals.push({ key: k, comp: c });
        }
        if (vals.length === 0) {
          const beh = onEmptyBehavior(rule, "PASS");
          t("check.aggregate", "empty", {
            pattern: rule.field,
            aggregateMode,
            onEmpty: beh,
          });

          if (beh === "FAIL") {
            t("check.aggregate", "fail", {
              patternField: rule.field,
              aggregateMode,
              matchedCount: keys.length,
              onEmpty: beh,
              result: "FAIL",
            });
            return {
              status: "FAIL",
              field: rule.field,
              actual: undefined,
              meta: { reason: "NO_COMPARABLE_VALUES" },
            };
          }
          if (beh === "ERROR")
            throw new Error(
              `Wildcard pattern produced 0 comparable values: ${rule.field}`,
            );

          t("check.aggregate", "ok", {
            patternField: rule.field,
            aggregateMode,
            matchedCount: keys.length,
            onEmpty: beh,
            result: "OK",
          });
          return { status: "OK" };
        }

        // Ensure all comparable kinds are the same.
        const kind = vals[0].comp.kind;
        if (!vals.every((v) => v.comp.kind === kind)) {
          t("check.aggregate", "fail", {
            patternField: rule.field,
            aggregateMode,
            matchedCount: keys.length,
            matchedSample: keys.slice(0, 5),
            result: "FAIL",
            reason: "MIXED_TYPES_IN_MINMAX",
          });
          return {
            status: "FAIL",
            field: rule.field,
            actual: null,
            meta: { reason: "MIXED_TYPES_IN_MINMAX" },
          };
        }

        const picked = vals.reduce((best, cur) => {
          if (!best) return cur;
          if (aggregateMode === "MIN")
            return cur.comp.value < best.comp.value ? cur : best;
          return cur.comp.value > best.comp.value ? cur : best;
        }, null);

        // Run operator against a synthetic payload key.
        const aggKey = "__agg__";
        const pickedValue = deepGet(ctx.payload, picked.key).value;
        const syntheticPayload = Object.assign(Object.create(null), { [aggKey]: pickedValue });
        const syntheticCtx = Object.assign({}, ctx, {
          payload: syntheticPayload,
          get: (path) => deepGet(syntheticPayload, path),
          has: (path) => deepGet(syntheticPayload, path).ok,
        });
        const rr = op(
          Object.assign({}, rule, { field: aggKey, _patternField: rule.field }),
          syntheticCtx,
        );
        if (rr.status === "EXCEPTION") return rr;

        const ok = rr.status === "OK";

        t("check.aggregate", ok ? "ok" : "fail", {
          patternField: rule.field,
          aggregateMode,
          matchedCount: keys.length,
          matchedSample: keys.slice(0, 5),
          pickedField: picked.key,
          pickedValue,
          kind,
          result: ok ? "OK" : "FAIL",
        });

        if (ok) return { status: "OK" };

        return {
          status: "FAIL",
          field: rule.field,
          actual: pickedValue,
          meta: {
            mode: aggregateMode,
            pickedField: picked.key,
            kind,
            matched: keys.length,
          },
        };
      }

      throw new Error(`Unsupported check aggregate.mode: ${aggregateMode}`);
    }

    return op(rule, ctx);
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
}

function validateOperatorResult(role, rule, result) {
  const allowed = role === "check" ? new Set(["OK", "FAIL", "EXCEPTION"]) : new Set(["TRUE", "FALSE", "UNDEFINED", "EXCEPTION"]);
  if (!result || typeof result !== "object" || !allowed.has(result.status)) {
    throw new RuntimeError({
      code: "OPERATOR_CONTRACT_VIOLATION",
      message: `Operator ${rule.operator} returned an invalid ${role} result`,
      details: { operator: rule.operator, ruleId: rule.id, returned: normalizeTransportSafe(result) },
    });
  }
  validateOperatorResultDepth(rule, result);
  if (result.status === "EXCEPTION") return operatorFaultResult(rule);
  return result;
}

function validateOperatorResultDepth(rule, result) {
  const surfaces = [
    ["actual", result.actual],
    ["meta", result.meta],
  ];
  if (Array.isArray(result.failures)) {
    for (let index = 0; index < result.failures.length; index++) {
      const failure = result.failures[index];
      if (!failure || typeof failure !== "object") continue;
      surfaces.push([`failures[${index}].actual`, failure.actual]);
      surfaces.push([`failures[${index}].meta`, failure.meta]);
    }
  }

  for (const [path, value] of surfaces) {
    if (value === undefined) continue;
    if (!exceedsMaxJsonDepth(value)) continue;
    throw new RuntimeError({
      code: "OPERATOR_CONTRACT_VIOLATION",
      message: `Operator ${rule.operator} returned an over-deep result at ${path}`,
      details: {
        operator: rule.operator,
        ruleId: rule.id,
        path,
        maxDepth: DEFAULT_MAX_JSON_DEPTH,
      },
    });
  }
}

function invokeOperator(role, rule, rawOp, args) {
  let result;
  try {
    result = rawOp(...args);
  } catch (_) {
    return operatorFaultResult(rule);
  }
  return validateOperatorResult(role, rule, result);
}

function operatorFaultResult(rule) {
  return { status: "EXCEPTION", error: operatorFaultError(rule) };
}

function operatorFaultError(rule) {
  return new RuntimeError({
    code: "OPERATOR_FAULT",
    message: `Operator ${rule.operator} failed for rule ${rule.id}`,
    details: { operator: rule.operator, ruleId: rule.id },
  });
}

function throwEvaluationException(result) {
  if (result && result.error) throw result.error;
  throw new RuntimeError({
    code: "RUNTIME_ABORT",
    message: "Runtime evaluation failed",
    details: null,
  });
}

function evalCondition(
  registry,
  operators,
  pipelines,
  conditions,
  condition,
  compiledCond,
  ctxBase,
  issues,
  trace,
  scopePipelineId,
) {
  const t = makeTrace(trace, condition.id);
  const w = compiledCond.when;

  function predBool(predId) {
    const pr = registry.get(predId);
    assert(
      pr && pr.type === "rule" && pr.role === "predicate",
      `when predicate must be predicate-rule: ${predId}`,
    );

    t("rule.start", "start", {
        conditionId: condition.id,
        ruleId: pr.id,
        role: pr.role,
        description: pr.description || '',
        field: pr.field || '',
        operator: pr.operator || '',
        meta: pr.meta !== undefined ? pr.meta : null,
      }, pr.id);

    const r = evalPredicate(
      operators,
      pr,
      ctxBase,
      trace,
      `condition:${condition.id}`,
    );
    if (r.status === "EXCEPTION") throwEvaluationException(r);
    t("rule.finish", r.status.toLowerCase(), { conditionId: condition.id, ruleId: pr.id }, pr.id);
    return r.status === "TRUE";
  }

  function evalWhen(expr) {
    if (expr.mode === "single") return predBool(expr.predId);
    if (expr.mode === "all") return expr.items.every((item) => evalWhen(item));
    if (expr.mode === "any") return expr.items.some((item) => evalWhen(item));
    if (expr.mode === "not") return !evalWhen(expr.item);
    throw new Error(`Unsupported compiled when mode: ${expr.mode}`);
  }

  let ok = evalWhen(w);

  t("condition.evaluate", ok ? "true" : "false", { whenMode: w.mode, result: ok });

  if (ok) {
    const control = execSteps(
      registry,
      operators,
      pipelines,
      conditions,
      compiledCond.steps,
      scopePipelineId,
      ctxBase,
      issues,
      trace,
      `condition:${condition.id}:steps`,
    );
    if (control === "STOP") return "STOP";
  }
  return "CONTINUE";
}

module.exports = { runPipeline };
