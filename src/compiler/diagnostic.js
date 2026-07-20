"use strict";

const { locationOf } = require("./context");

/**
 * Compiler phases create diagnostics as data. Human-readable messages are never
 * parsed to recover contract fields such as code, artifactId, path or location.
 */
function diagnostic({
  code,
  message,
  phase,
  artifactId = null,
  path = null,
  details = null,
  level = "error",
}) {
  const normalizedArtifactId = typeof artifactId === "string" && artifactId.length > 0
    ? artifactId
    : null;
  return {
    code,
    level: level === "warning" ? "warning" : "error",
    message: String(message),
    phase,
    artifactId: normalizedArtifactId,
    path: typeof path === "string" && path.length > 0 ? path : null,
    location: locationOf(normalizedArtifactId),
    details,
  };
}

function artifactDiagnostic(artifact, values) {
  return diagnostic({
    ...values,
    artifactId: artifact && typeof artifact.id === "string" ? artifact.id : null,
  });
}

module.exports = { diagnostic, artifactDiagnostic };
