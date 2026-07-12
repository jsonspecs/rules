"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "jsonspecs-pack-"));

function run(command, args, cwd = temp) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, npm_config_dry_run: "false" },
  });
}

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], root));
  const tarball = path.join(temp, packed[0].filename);
  run("npm", ["init", "-y"]);
  run("npm", ["install", "--ignore-scripts", tarball]);
  fs.writeFileSync(path.join(temp, "smoke.cjs"), `
    const api = require("jsonspecs");
    const artifacts = [
      { id: "library.required", type: "rule", description: "required", role: "check", operator: "not_empty", level: "ERROR", code: "X", message: "required", field: "x" },
      { id: "entry.main", type: "pipeline", description: "main", strict: false, entrypoint: true, flow: [{ rule: "library.required" }] }
    ];
    const engine = api.createEngine({ operators: api.Operators });
    const prepared = engine.compile(artifacts);
    const result = engine.runPipeline(prepared, { payload: { x: "" } });
    if (result.status !== "ERROR" || result.control !== "STOP") process.exit(1);
    if (!api.inspect(prepared).getArtifact("entry.main")) process.exit(1);
  `);
  run(process.execPath, ["smoke.cjs"]);
  fs.writeFileSync(path.join(temp, "smoke.mjs"), `
    import api, { createEngine, Operators, compileSnapshot, inspect } from "jsonspecs";
    if (typeof createEngine !== "function" || !Operators || typeof compileSnapshot !== "function" || typeof inspect !== "function") process.exit(1);
    if (api.createEngine !== createEngine) process.exit(1);
  `);
  run(process.execPath, ["smoke.mjs"]);
  console.log("jsonspecs pack smoke OK");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
