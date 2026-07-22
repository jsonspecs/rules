"use strict";

/**
 * Структурное раскрытие wildcard по D31.
 *
 * До очередного `[*]` непроходимая ветвь прекращается: реальный следующий индекс
 * определить нельзя. После последнего wildcard точный хвост достраивается до
 * конкретного пути даже при отсутствии значения — это absent-кандидат RC.6.
 * Индексы перечисляются обычным числовым циклом, поэтому порядок ветвей сразу
 * совпадает с нормативным числовым одометром без строковой сортировки.
 */

function expandWildcard(root, plan) {
  if (!plan || plan.context) return Object.freeze([]);
  let branches = [{ node: root, path: "", reachable: true }];

  for (const token of plan.tokens) {
    if (token.type === "wildcard") {
      const expanded = [];
      for (const branch of branches) {
        if (!branch.reachable || !Array.isArray(branch.node)) continue;
        for (let index = 0; index < branch.node.length; index++) {
          expanded.push({
            node: branch.node[index],
            path: `${branch.path}[${index}]`,
            reachable: true,
          });
        }
      }
      branches = expanded;
      continue;
    }

    branches = branches.map((branch) => advanceExact(branch, token));
  }

  return Object.freeze(branches.map((branch) => {
    if (branch.reachable && isLeaf(branch.node)) {
      return Object.freeze({ path: branch.path, present: true, value: branch.node });
    }
    return Object.freeze({ path: branch.path, present: false });
  }));
}

function advanceExact(branch, token) {
  const path = token.type === "key"
    ? (branch.path ? `${branch.path}.${token.value}` : token.value)
    : `${branch.path}[${token.value}]`;
  if (!branch.reachable) return { node: undefined, path, reachable: false };

  if (token.type === "key") {
    const object = branch.node !== null && typeof branch.node === "object" && !Array.isArray(branch.node);
    if (!object || !Object.prototype.hasOwnProperty.call(branch.node, token.value)) {
      return { node: undefined, path, reachable: false };
    }
    return { node: branch.node[token.value], path, reachable: true };
  }

  if (!Array.isArray(branch.node) || token.value >= branch.node.length) {
    return { node: undefined, path, reachable: false };
  }
  return { node: branch.node[token.value], path, reachable: true };
}

function isLeaf(value) {
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.length === 0;
  return Object.keys(value).length === 0;
}

module.exports = { expandWildcard, isLeaf };
