"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compileSnapshot, computeSourceHash, CompilationError } = require("..");
const packageJson = require("../package.json");

const [, major, minor, patch] = packageJson.version.match(/^(\d+)\.(\d+)\.(\d+)/);
const currentVersion = `${major}.${minor}.${patch}`;
const nextPatchVersion = `${major}.${minor}.${Number(patch) + 1}`;
const nextMinorVersion = `${major}.${Number(minor) + 1}.0`;
const nextMajorVersion = `${Number(major) + 1}.0.0`;

function snapshot(minVersion) {
  const artifacts = [];
  return {
    format: "jsonspecs-snapshot",
    formatVersion: 1,
    sourceHash: computeSourceHash(artifacts),
    engine: { minVersion },
    artifacts,
  };
}

function incompatible(error) {
  assert.ok(error instanceof CompilationError);
  assert.equal(error.diagnostics[0].code, "SNAPSHOT_ENGINE_INCOMPATIBLE");
  assert.equal(error.diagnostics[0].path, "engine.minVersion");
  return true;
}

test("snapshot compatibility compares major, minor and patch", () => {
  assert.equal(compileSnapshot(snapshot(currentVersion)).kind, "prepared-jsonspecs");
  assert.throws(() => compileSnapshot(snapshot(nextPatchVersion)), incompatible);
  assert.throws(() => compileSnapshot(snapshot(nextMinorVersion)), incompatible);
  assert.throws(() => compileSnapshot(snapshot(nextMajorVersion)), incompatible);
});

test("snapshot compatibility follows SemVer prerelease and build precedence", () => {
  assert.equal(compileSnapshot(snapshot(`${currentVersion}-rc.1`)).kind, "prepared-jsonspecs");
  assert.equal(compileSnapshot(snapshot(`${currentVersion}+snapshot.7`)).kind, "prepared-jsonspecs");
  assert.throws(() => compileSnapshot(snapshot(`${nextPatchVersion}-alpha.1`)), incompatible);
});

test("snapshot minVersion must be a complete valid semantic version", () => {
  for (const minVersion of [undefined, "2", "2.0", "02.0.0", "2.0.0-01", "2.0.0\n", "not-semver"]) {
    assert.throws(
      () => compileSnapshot(snapshot(minVersion)),
      (error) => {
        assert.ok(error instanceof CompilationError);
        assert.equal(error.diagnostics[0].code, "INVALID_SNAPSHOT");
        assert.equal(error.diagnostics[0].path, "engine.minVersion");
        return true;
      },
    );
  }
});
