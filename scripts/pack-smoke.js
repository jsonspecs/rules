"use strict";

/** Проверяет реальный npm tarball через CJS и ESM потребителей. */

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
    env: {
      ...process.env,
      npm_config_cache: path.join(temp, "npm-cache"),
      // Внешний `npm publish --dry-run` передаёт этот флаг дочернему npm. Для
      // smoke-проверки архив должен быть создан физически, иначе install читает
      // несуществующий путь, хотя `npm pack --json` сообщил имя файла.
      npm_config_dry_run: "false",
    },
  });
}

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], root));
  const tarball = path.join(temp, packed[0].filename);
  const consumer = fs.mkdtempSync(path.join(temp, "consumer-"));
  run("npm", ["init", "-y"], consumer);
  run("npm", ["install", "--ignore-scripts", tarball], consumer);
  fs.writeFileSync(path.join(consumer, "smoke.cjs"), `
    const api = require("@jsonspecs/rules");
    const snapshot = {format:"jsonspecs-snapshot",formatVersion:2,specVersion:"1.0.0-rc.6",exports:["p"],artifacts:{p:{type:"pipeline",steps:["r"]},r:{type:"rule",operator:"not_empty",field:"x",issue:{level:"ERROR",code:"X",message:"required"}}}};
    snapshot.sourceHash=api.computeSourceHash(snapshot);
    const prepared=api.compileSnapshot(snapshot);
    const result=api.runPipeline(prepared,{pipelineId:"p",payload:{x:""}});
    if(result.status!=="ERROR" || result.issues[0].code!=="X") process.exit(1);
  `);
  run(process.execPath, ["smoke.cjs"], consumer);
  fs.writeFileSync(path.join(consumer, "smoke.mjs"), `
    import api, { createEngine, compileSnapshotText } from "@jsonspecs/rules";
    if (api.createEngine !== createEngine || typeof compileSnapshotText !== "function") process.exit(1);
  `);
  run(process.execPath, ["smoke.mjs"], consumer);
  console.log("@jsonspecs/rules package smoke OK");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
