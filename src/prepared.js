"use strict";

const states = new WeakMap();

function createPrepared(state, publicFields) {
  const artifact = Object.freeze(Object.assign(Object.create(null), publicFields));
  states.set(artifact, state);
  return artifact;
}

function getPreparedState(artifact) { return states.get(artifact) || null; }

module.exports = { createPrepared, getPreparedState };
