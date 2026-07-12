"use strict";

// SemVer 2.0.0 grammar. Numeric prerelease identifiers with leading zeroes are
// intentionally rejected; build metadata is parsed but ignored for precedence.
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(value) {
  if (typeof value !== "string") return null;
  const match = SEMVER_PATTERN.exec(value);
  if (!match || match[0] !== value) return null;
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftId = left.prerelease[index];
    const rightId = right.prerelease[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    if (leftId === rightId) continue;

    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      const leftNumber = BigInt(leftId);
      const rightNumber = BigInt(rightId);
      if (leftNumber < rightNumber) return -1;
      if (leftNumber > rightNumber) return 1;
      continue;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftId < rightId ? -1 : 1;
  }
  return 0;
}

module.exports = { parseSemver, compareSemver };
