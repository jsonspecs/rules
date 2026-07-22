"use strict";

/** Грубые защитные бюджеты для compile/runtime; это не benchmark. */

const { performance } = require("node:perf_hooks");
const { createEngine, computeSourceHash } = require("..");
const engine = createEngine();
const multiplier = Number(process.env.JSONSPECS_PERF_BUDGET_MULTIPLIER || "1");

function runCase(name, budgetMs, fn) {
  const started = performance.now();
  fn();
  const elapsed = performance.now() - started;
  const budget = budgetMs * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
  console.log(`${name}: ${elapsed.toFixed(1)}ms (budget ${budget.toFixed(0)}ms)`);
  if (elapsed > budget) throw new Error(`${name} exceeded budget`);
}

function snapshot(artifacts, exports) {
  const value = { format: "jsonspecs-snapshot", formatVersion: 2, specVersion: "1.0.0-rc.7", exports, artifacts };
  value.sourceHash = computeSourceHash(value);
  return value;
}

const simple = engine.compileSnapshot(snapshot({
  p: { type: "pipeline", steps: ["r"] },
  r: { type: "rule", operator: "not_empty", field: "x", issue: { level: "ERROR", code: "X", message: "x" } },
}, ["p"]));

const wildcard = engine.compileSnapshot(snapshot({
  p: { type: "pipeline", steps: ["r"] },
  r: { type: "rule", operator: "not_empty", field: "items[*].value", aggregate: { mode: "ALL", issueMode: "EACH" }, issue: { level: "ERROR", code: "ITEM", message: "item" } },
}, ["p"]));

runCase("nested payload 50000 keys", 3000, () => {
  const payload = Object.fromEntries(Array.from({ length: 50000 }, (_, i) => [`k${i}`, i]));
  payload.x = "ok";
  if (engine.runPipeline(simple, { pipelineId: "p", payload }).status !== "OK") throw new Error("unexpected status");
});

runCase("wildcard 10000 matches", 3000, () => {
  const payload = { items: Array.from({ length: 10000 }, () => ({ value: "ok" })) };
  if (engine.runPipeline(wildcard, { pipelineId: "p", payload }).status !== "OK") throw new Error("unexpected status");
});

runCase("wildcard 5000 issues", 3000, () => {
  const payload = { items: Array.from({ length: 5000 }, () => ({ value: "" })) };
  const result = engine.runPipeline(wildcard, { pipelineId: "p", payload });
  if (result.status !== "ERROR" || result.issues.length !== 5000) throw new Error("unexpected issue count");
});

runCase("459-rule compile and 20 runs", 3000, () => {
  const artifacts = { p: { type: "pipeline", steps: [] } };
  const payload = {};
  for (let i = 0; i < 459; i++) {
    artifacts.p.steps.push(`r${i}`);
    artifacts[`r${i}`] = { type: "rule", operator: "not_empty", field: `f${i}`, issue: { level: "ERROR", code: `F${i}`, message: "required" } };
    payload[`f${i}`] = "ok";
  }
  const prepared = engine.compileSnapshot(snapshot(artifacts, ["p"]));
  for (let i = 0; i < 20; i++) if (engine.runPipeline(prepared, { pipelineId: "p", payload }).status !== "OK") throw new Error("unexpected status");
});

const dictionaryEntries = Array.from({ length: 20000 }, (_, index) => `value-${index}`);
const dictionarySnapshot = snapshot({
  p: { type: "pipeline", steps: ["r"] },
  r: {
    type: "rule", operator: "in_dictionary", field: "x", dictionary: "d",
    issue: { level: "ERROR", code: "D", message: "not found" },
  },
  d: { type: "dictionary", entries: dictionaryEntries },
}, ["p"]);
let largeDictionary;
runCase("dictionary 20000 entries compile", 1000, () => {
  largeDictionary = engine.compileSnapshot(dictionarySnapshot);
});

runCase("dictionary 5000 indexed misses", 1000, () => {
  for (let index = 0; index < 5000; index++) {
    const result = engine.runPipeline(largeDictionary, { pipelineId: "p", payload: { x: `missing-${index}` } });
    if (result.status !== "ERROR") throw new Error("unexpected status");
  }
});

console.log("jsonspecs perf smoke OK");
