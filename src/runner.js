const {
  assert,
  makeTrace,
  deepGet,
  toComparable,
  isWildcardField,
  expandWildcardKeys,
} = require("./utils");
const { flattenPayloadSafe, normalizeTransportSafe, hasOwn } = require("./safe-json");
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

function onEmptyBehavior(rule, defaultBehavior) {
  const ae = rule && rule.aggregate && rule.aggregate.onEmpty;
  return ae || defaultBehavior;
}

function resolveRuleFields(rule, payloadKeys, traceFn) {
  if (!isWildcardField(rule.field))
    return { pattern: rule.field, keys: [rule.field] };
  const keys = expandWildcardKeys(rule.field, payloadKeys);
  traceFn("wildcard expanded", { pattern: rule.field, matched: keys.length });
  return { pattern: rule.field, keys };
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
  traceFn("STOP by strict pipeline boundary", {
    pipelineId: pipeline.id,
    code,
  });
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

  const t = makeTrace(trace, `pipeline:${pipeline.id}:context`);
  t("missing required context", { pipelineId: pipeline.id, missing });

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
  let inputContext = null;
  if (pipelineId && typeof pipelineId === "object") {
    const input = pipelineId;
    options = payload || {};
    pipelineId = input.pipelineId;
    payload = input.payload;
    inputContext = input.context || null;
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
    if (!pipelineId) {
      const entrypoints = [...registry.values()].filter((item) => item.type === "pipeline" && item.entrypoint === true);
      if (entrypoints.length !== 1) throw new RuntimeError({ code: "PIPELINE_ID_REQUIRED", message: "pipelineId is required unless exactly one entrypoint exists", details: { entrypointCount: entrypoints.length } });
      pipelineId = entrypoints[0].id;
    }
    const flat = flattenPayloadSafe(payload || {});
    const context = inputContext || (payload && hasOwn(payload, "__context") ? payload.__context : {}) || {};
    const enrichedPayload = Object.assign(Object.create(null), flat, { __context: context });
    const payloadKeys = Object.keys(flat);
    const wildcardCache = new Map();
    const ctxBase = { payload: enrichedPayload, payloadKeys, wildcardCache, getDictionary: (id) => dictionaries.get(id) || null, get: (path) => deepGet(enrichedPayload, path), has: (path) => deepGet(enrichedPayload, path).ok };
    const pipeline = registry.get(pipelineId);
    if (!pipeline || pipeline.type !== "pipeline") throw new RuntimeError({ code: "PIPELINE_NOT_FOUND", message: `Pipeline not found: ${pipelineId}`, details: { pipelineId, availablePipelines: [...pipelines.keys()] } });

    const compiledPipe = pipelines.get(pipelineId);
    assert(
      compiledPipe,
      `runPipeline: compiled pipeline not found: ${pipelineId}`,
    );

    const pipelineArtifact = registry.get(pipelineId);
  assert(pipelineArtifact && pipelineArtifact.type === "pipeline", `Missing pipeline ${pipelineId}`);
  if (checkRequiredContext(pipelineArtifact, ctxBase, issues, traceTarget)) {
    return finishResult({ status: "EXCEPTION", control: "STOP", issues }, traceMode, trace, options);
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
      return finishResult({ status: "EXCEPTION", control: "STOP", issues }, traceMode, trace, options);
    }

    if (control === "STOP")
      traceFn("pipeline stopped by EXCEPTION", { pipelineId });

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

    return finishResult({ status, control: ctrl, issues }, traceMode, trace, options);
  } catch (e) {
    traceFn("pipeline ABORT (runtime exception)", {
      pipelineId,
      error: String(e && e.message ? e.message : e),
    });
    return finishResult({
      status: "ABORT",
      control: "STOP",
      issues,
      error: { code: e && e.code ? e.code : "CUSTOM_OPERATOR_ERROR", message: e && e.message ? e.message : String(e), details: e && e.details ? e.details : null },
    }, traceMode, trace, options);
  }
}

function finishResult(result, traceMode, trace, options) {
  if (traceMode) result.trace = trace.map((entry) => ({ ...entry, details: sanitizeTraceDetails(entry.details, traceMode, options && options.traceRedactor) }));
  return normalizeTransportSafe(result);
}

function sanitizeTraceDetails(details, mode, redactor) {
  const sensitive = new Set(["actual", "value", "pickedValue", "matchedSample", "failedSample", "meta"]);
  const output = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (mode === "basic" && sensitive.has(key)) continue;
    output[key] = mode === "verbose" && sensitive.has(key) && typeof redactor === "function" ? redactor(value, mode) : value;
  }
  return output;
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
  const t = makeTrace(trace, scope);

  for (const step of steps) {
    const kind = step.kind;
    const stepId = step.stepId;

    if (kind === "rule") {
      const rule = registry.get(step.ruleId);
      assert(rule, `Missing rule ${step.ruleId} (from ${step.ref})`);
      const actualValue = rule.field && deepGet(ctxBase.payload, rule.field).ok
        ? deepGet(ctxBase.payload, rule.field).value
        : undefined;
      t("exec rule step", {
        stepId,
        ruleId: rule.id,
        ref: step.ref,
        role: rule.role,
        description: rule.description || '',
        field: rule.field || '',
        operator: rule.operator || '',
        value: rule.value !== undefined ? String(rule.value) : '',
        actual: actualValue !== undefined ? String(actualValue) : '',
        meta: rule.meta !== undefined ? rule.meta : null,
      });

      if (rule.role === "predicate") {
        const res = evalPredicate(operators, rule, ctxBase, trace, scope);
        if (res.status === "EXCEPTION") throw res.error;
        continue;
      }

      const res = evalCheck(operators, rule, ctxBase, trace, scope);
      if (res.status === "EXCEPTION") throw res.error;

      // Логируем результат проверки в трейс
      t("rule result", {
        ruleId: rule.id,
        status: res.status,   // "OK" | "FAIL"
        level: rule.level,
        code: rule.code || '',
      });

      if (res.status === "FAIL") {
        // evalCheck may return a single failure (non-wildcard or aggregated)
        // or multiple failures (wildcard per-element). Normalize to array.
        const fails = Array.isArray(res.failures) ? res.failures : [res];

        for (const f of fails) {
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
            field: f.field || rule.field,
            ruleId: rule.id,
            expected,
            actual: Object.prototype.hasOwnProperty.call(f, "actual")
              ? f.actual
              : deepGet(ctxBase.payload, f.field || rule.field).ok
                ? deepGet(ctxBase.payload, f.field || rule.field).value
                : undefined,
            stepId,
            meta: f.meta || undefined,
          });
        }

        if (rule.level === "EXCEPTION") {
          t("STOP by EXCEPTION-level rule", {
            ruleId: rule.id,
            code: rule.code,
          });
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

      t("exec pipeline step", { stepId, pipelineId: p.id, description: p.description || '' });
      const issuesStart = issues.length;
      const nestedPipelineArtifact = registry.get(p.id);
      assert(nestedPipelineArtifact && nestedPipelineArtifact.type === "pipeline", `Missing pipeline ${p.id}`);
      if (checkRequiredContext(nestedPipelineArtifact, ctxBase, issues, trace, stepId)) {
        t("STOP by missing required context", { pipelineId: p.id, stepId });
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
        return "STOP";
      }

      if (control === "STOP") return "STOP";
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

      t("exec condition step", {
        stepId,
        conditionId: c.id,
        ref: step.ref,
        description: c.description || '',
      });

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
      );
      if (control === "STOP") return "STOP";
      continue;
    }
  }

  return "CONTINUE";
}

function evalPredicate(operators, rule, ctxBase, trace, scope) {
  const t = makeTrace(trace, `${scope}:pred:${rule.id}`);
  const rawOp = operators.predicate[rule.operator];
  const op = (...args) => validateOperatorResult("predicate", rule, rawOp(...args));
  try {
    const ctx = Object.assign({}, ctxBase, { trace: (m, d) => t(m, d) });

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
        t("wildcard predicate matched 0 fields", {
          pattern: rule.field,
          aggregateMode,
          onEmpty: beh,
        });

        if (beh === "TRUE") {
          t("wildcard aggregate", {
            patternField: rule.field,
            aggregateMode,
            matchedCount: 0,
            onEmpty: beh,
            result: "TRUE",
          });
          return { status: "TRUE" };
        }
        if (beh === "FALSE") {
          t("wildcard aggregate", {
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
        t("predicate UNDEFINED treated as FALSE", { ruleId: rule.id });
        t("wildcard aggregate", {
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

      t("wildcard aggregate", {
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
      t("predicate UNDEFINED treated as FALSE", { ruleId: rule.id });
      return { status: "FALSE" };
    }
    return res;
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
}

function evalCheck(operators, rule, ctxBase, trace, scope) {
  const t = makeTrace(trace, `${scope}:check:${rule.id}`);
  const rawOp = operators.check[rule.operator];
  const op = (...args) => validateOperatorResult("check", rule, rawOp(...args));
  try {
    const ctx = Object.assign({}, ctxBase, { trace: (m, d) => t(m, d) });

    if (rule.operator === "any_filled" && Array.isArray(rule.fields) && rule.fields.every(isWildcardField)) {
      const concrete = expandWildcardKeys(rule.fields[0], ctx.payloadKeys || []);
      if (concrete.length === 0) {
        const behavior = onEmptyBehavior(rule, "PASS");
        if (behavior === "ERROR") throw new RuntimeError({ code: "WILDCARD_EMPTY", message: `Wildcard fields matched no groups: ${rule.fields[0]}` });
        return behavior === "FAIL" ? { status: "FAIL", field: rule.fields[0], meta: { reason: "WILDCARD_EMPTY" } } : { status: "OK" };
      }
      const failures = [];
      for (const matched of concrete) {
        const indexes = [...matched.matchAll(/\[(\d+)\]/g)].map((item) => item[1]);
        let index = 0;
        const fields = rule.fields.map((field) => field.replace(/\[\*\]/g, () => `[${indexes[index++ % indexes.length]}]`));
        index = 0;
        const result = op(Object.assign({}, rule, { fields }), ctx);
        if (result.status === "EXCEPTION") return result;
        if (result.status === "FAIL") failures.push({ status: "FAIL", field: fields[0], actual: result.actual, meta: { fields, pattern: rule.fields } });
      }
      return failures.length ? { status: "FAIL", failures } : { status: "OK" };
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
        t("wildcard check matched 0 fields", {
          pattern: rule.field,
          aggregateMode,
          onEmpty: beh,
        });

        if (beh === "FAIL") {
          t("wildcard aggregate", {
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
        t("wildcard aggregate", {
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

        t("wildcard aggregate", {
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

        t("wildcard aggregate", {
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
          t("wildcard MIN/MAX produced 0 comparable values", {
            pattern: rule.field,
            aggregateMode,
            onEmpty: beh,
          });

          if (beh === "FAIL") {
            t("wildcard aggregate", {
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

          t("wildcard aggregate", {
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
          t("wildcard aggregate", {
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

        t("wildcard aggregate", {
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
  return result;
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
) {
  const t = makeTrace(trace, `condition:${condition.id}`);
  const w = compiledCond.when;

  function predBool(predId) {
    const pr = registry.get(predId);
    assert(
      pr && pr.type === "rule" && pr.role === "predicate",
      `when predicate must be predicate-rule: ${predId}`,
    );

    // For observability: explicitly log predicate evaluation as a trace step.
    trace.push({
      kind: "TRACE",
      message: "exec predicate step",
      data: {
        scope: `condition:${condition.id}`,
        ruleId: pr.id,
        role: pr.role,
        description: pr.description || '',
        field: pr.field || '',
        operator: pr.operator || '',
        meta: pr.meta !== undefined ? pr.meta : null,
      },
      ts: new Date().toISOString(),
    });

    const r = evalPredicate(
      operators,
      pr,
      ctxBase,
      trace,
      `condition:${condition.id}`,
    );
    if (r.status === "EXCEPTION") throw r.error;
    return r.status === "TRUE";
  }

  function evalWhen(expr) {
    if (expr.mode === "single") return predBool(expr.predId);
    if (expr.mode === "all") return expr.items.every((item) => evalWhen(item));
    if (expr.mode === "any") return expr.items.some((item) => evalWhen(item));
    throw new Error(`Unsupported compiled when mode: ${expr.mode}`);
  }

  let ok = evalWhen(w);

  t("condition evaluated", { whenMode: w.mode, result: ok });

  if (ok) {
    const control = execSteps(
      registry,
      operators,
      pipelines,
      conditions,
      compiledCond.steps,
      compiledCond.scopePipelineId,
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
