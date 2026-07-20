"use strict";

const { performance } = require("node:perf_hooks");
const { createEngine, Operators } = require("..");

const multiplier = Number(process.env.JSONSPECS_PERF_BUDGET_MULTIPLIER || "1");

function runCase(name, budgetMs, fn) {
  const started = performance.now();
  const result = fn();
  const elapsed = performance.now() - started;
  const budget = budgetMs * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
  console.log(`${name}: ${elapsed.toFixed(1)}ms (budget ${budget.toFixed(0)}ms)`);
  if (elapsed > budget) {
    throw new Error(`${name} exceeded budget: ${elapsed.toFixed(1)}ms > ${budget.toFixed(0)}ms`);
  }
  return result;
}

function compile(artifacts) {
  return createEngine({ operators: Operators }).compile(artifacts);
}

function flatPayload(size) {
  const payload = {};
  for (let index = 0; index < size; index++) payload[`k${index}`] = index;
  payload.x = "ok";
  return payload;
}

function wildcardPayload(size, value) {
  return {
    items: Array.from({ length: size }, () => ({ value })),
  };
}

function simpleArtifacts() {
  return [
    { id: "library.required", type: "rule", description: "required", role: "check", operator: "not_empty", field: "x", level: "ERROR", code: "X", message: "x" },
    { id: "entry.main", type: "pipeline", description: "main", strict: false, entrypoint: true, flow: [{ rule: "library.required" }] },
  ];
}

function wildcardArtifacts() {
  return [
    { id: "library.item.value", type: "rule", description: "item", role: "check", operator: "not_empty", field: "items[*].value", level: "ERROR", code: "ITEM.VALUE", message: "item" },
    { id: "entry.items", type: "pipeline", description: "items", strict: false, entrypoint: true, flow: [{ rule: "library.item.value" }] },
  ];
}

function largeRulesetArtifacts(size) {
  const artifacts = [];
  const flow = [];
  for (let index = 0; index < size; index++) {
    const id = `library.rule_${index}`;
    artifacts.push({
      id,
      type: "rule",
      description: `rule ${index}`,
      role: "check",
      operator: "not_empty",
      field: `f${index}`,
      level: "ERROR",
      code: `F${index}.REQUIRED`,
      message: `f${index}`,
    });
    flow.push({ rule: id });
  }
  artifacts.push({ id: "entry.large", type: "pipeline", description: "large", strict: false, entrypoint: true, flow });
  return artifacts;
}

function payloadForLargeRuleset(size) {
  const payload = {};
  for (let index = 0; index < size; index++) payload[`f${index}`] = "ok";
  return payload;
}

const simple = compile(simpleArtifacts());
const wildcard = compile(wildcardArtifacts());
const largeArtifacts = largeRulesetArtifacts(459);
const largePayload = payloadForLargeRuleset(459);

runCase("flat payload 50000 keys", 3000, () => {
  const result = createEngine({ operators: Operators }).runPipeline(simple, { payload: flatPayload(50000) });
  if (result.status !== "OK") throw new Error(`unexpected status ${result.status}`);
});

runCase("wildcard 10000 matches", 3000, () => {
  const result = createEngine({ operators: Operators }).runPipeline(wildcard, { payload: wildcardPayload(10000, "ok") });
  if (result.status !== "OK") throw new Error(`unexpected status ${result.status}`);
});

runCase("wildcard 5000 issues", 3000, () => {
  const result = createEngine({ operators: Operators }).runPipeline(wildcard, { payload: wildcardPayload(5000, "") });
  if (result.status !== "ERROR" || result.issues.length !== 5000) {
    throw new Error(`unexpected wildcard issue result ${result.status}/${result.issues.length}`);
  }
});

runCase("synthetic 459-rule compile and 20 runs", 3000, () => {
  const engine = createEngine({ operators: Operators });
  const prepared = engine.compile(largeArtifacts);
  for (let index = 0; index < 20; index++) {
    const result = engine.runPipeline(prepared, { payload: largePayload });
    if (result.status !== "OK") throw new Error(`unexpected status ${result.status}`);
  }
});

console.log("jsonspecs perf smoke OK");
