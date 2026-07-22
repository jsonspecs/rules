"use strict";

/**
 * Непрозрачный контейнер скомпилированного снэпшота.
 *
 * Публичный объект содержит только стабильный бренд и провенанс. Все карты,
 * функции операторов и нормализованные артефакты спрятаны в WeakMap: потребитель
 * не может случайно изменить программу правил после успешной компиляции.
 */

const states = new WeakMap();

function createPrepared(state, publicFields) {
  const artifact = Object.freeze(Object.assign(Object.create(null), publicFields));
  states.set(artifact, state);
  return artifact;
}

function getPreparedState(artifact) { return states.get(artifact) || null; }

module.exports = { createPrepared, getPreparedState };
