"use strict";

/** Минимальный исполняемый пример fv2 из README. */

const assert = require("node:assert/strict");
const { compileSnapshot, runPipeline, computeSourceHash } = require("../..");

const snapshot = {
  format: "jsonspecs-snapshot",
  formatVersion: 2,
  specVersion: "1.0.0-rc.6",
  exports: ["registration.pipeline"],
  artifacts: {
    "registration.pipeline": {
      type: "pipeline",
      steps: ["context.date.required", "person.first-name.required", "person.email.format", "person.document.valid"],
    },
    "context.date.required": {
      type: "rule", operator: "not_empty", field: "$context.currentDate",
      issue: { level: "EXCEPTION", code: "CONTEXT.DATE.REQUIRED", message: "Current date is required" },
    },
    "person.first-name.required": {
      type: "rule", operator: "not_empty", field: "person.firstName",
      issue: { level: "ERROR", code: "PERSON.FIRST_NAME.REQUIRED", message: "First name is required" },
    },
    "person.email.format": {
      type: "rule", operator: "contains", field: "person.email", value: "@",
      issue: { level: "WARNING", code: "PERSON.EMAIL.FORMAT", message: "Email address looks invalid" },
    },
    "person.document.valid": {
      type: "rule", operator: "field_greater_or_equal_than_field",
      field: "person.document.expireDate", value_field: "$context.currentDate",
      issue: { level: "EXCEPTION", code: "PERSON.DOC.EXPIRED", message: "Document has expired" },
    },
  },
};
snapshot.sourceHash = computeSourceHash(snapshot);

const prepared = compileSnapshot(snapshot);
const result = runPipeline(prepared, {
  pipelineId: "registration.pipeline",
  payload: { person: { firstName: "", email: "not-an-email", document: { expireDate: "2099-01-01" } } },
  context: { currentDate: "2024-01-01" },
});

assert.equal(result.status, "ERROR");
assert.deepEqual(result.issues.map((issue) => issue.code), ["PERSON.FIRST_NAME.REQUIRED", "PERSON.EMAIL.FORMAT"]);
console.log(JSON.stringify(result, null, 2));
console.log("Smoke test passed");
