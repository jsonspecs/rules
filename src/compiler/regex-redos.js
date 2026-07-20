"use strict";

function lintRegexReDoS(pattern) {
  const source = String(pattern);
  const findings = [];
  for (const group of quantifiedGroups(source)) {
    if (containsQuantifier(group.body)) {
      findings.push({
        type: "NESTED_QUANTIFIER",
        message: "quantified group contains another quantified expression",
        sample: preview(source.slice(group.start, group.end + 2)),
      });
    }
    const overlap = overlappingAlternation(group.body);
    if (overlap) {
      findings.push({
        type: "OVERLAPPING_ALTERNATION",
        message: "quantified alternation has overlapping branches",
        sample: preview(overlap),
      });
    }
  }
  return dedupe(findings);
}

function quantifiedGroups(source) {
  const groups = [];
  const stack = [];
  let escaped = false;
  let inClass = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;

    if (char === "(") {
      stack.push(index);
      continue;
    }
    if (char !== ")" || stack.length === 0) continue;

    const start = stack.pop();
    const quantifier = readQuantifier(source, index + 1);
    if (quantifier) {
      groups.push({
        start,
        end: index,
        body: stripGroupPrefix(source.slice(start + 1, index)),
        quantifier,
      });
    }
  }
  return groups;
}

function readQuantifier(source, index) {
  const char = source[index];
  if (char === "*" || char === "+" || char === "?") return char;
  if (char !== "{") return null;
  const end = source.indexOf("}", index + 1);
  if (end === -1) return null;
  const body = source.slice(index + 1, end);
  return /^\d+(,\d*)?$/.test(body) ? source.slice(index, end + 1) : null;
}

function containsQuantifier(source) {
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;

    if ((char === "*" || char === "+" || char === "?") && !isGroupPrefixQuestion(source, index)) return true;
    if (readQuantifier(source, index)) return true;
  }
  return false;
}

function overlappingAlternation(source) {
  const parts = splitTopLevelAlternatives(source);
  if (parts.length < 2) return null;
  for (let left = 0; left < parts.length; left++) {
    for (let right = left + 1; right < parts.length; right++) {
      if (alternativesOverlap(parts[left], parts[right])) {
        return `${parts[left]}|${parts[right]}`;
      }
    }
  }
  return null;
}

function splitTopLevelAlternatives(source) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let escaped = false;
  let inClass = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if (char === "(") depth++;
    else if (char === ")" && depth > 0) depth--;
    else if (char === "|" && depth === 0) {
      parts.push(stripGroupPrefix(source.slice(start, index)));
      start = index + 1;
    }
  }
  parts.push(stripGroupPrefix(source.slice(start)));
  return parts.filter((part) => part.length > 0);
}

function alternativesOverlap(left, right) {
  const leftNorm = literalish(left);
  const rightNorm = literalish(right);
  if (leftNorm && rightNorm && (leftNorm.startsWith(rightNorm) || rightNorm.startsWith(leftNorm))) return true;

  const leftAtom = firstAtom(left);
  const rightAtom = firstAtom(right);
  return Boolean(
    leftAtom &&
    rightAtom &&
    leftAtom.atom === rightAtom.atom &&
    (leftAtom.quantified || rightAtom.quantified)
  );
}

function literalish(source) {
  let output = "";
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[") {
      inClass = true;
      output += "[]";
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if ("^$*+?{}()".includes(char)) continue;
    output += char;
  }
  return output;
}

function firstAtom(source) {
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "^" || char === "$") continue;
    if (escaped) {
      return { atom: `\\${char}`, quantified: Boolean(readQuantifier(source, index + 1)) };
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ".") return { atom: ".", quantified: Boolean(readQuantifier(source, index + 1)) };
    if (char === "[") {
      const end = source.indexOf("]", index + 1);
      return { atom: end === -1 ? "[" : source.slice(index, end + 1), quantified: Boolean(readQuantifier(source, (end === -1 ? index : end) + 1)) };
    }
    if ("()|*+?{}".includes(char)) continue;
    return { atom: char, quantified: Boolean(readQuantifier(source, index + 1)) };
  }
  return null;
}

function stripGroupPrefix(source) {
  if (source.startsWith("?:") || source.startsWith("?=") || source.startsWith("?!")) return source.slice(2);
  if (source.startsWith("?<=") || source.startsWith("?<!")) return source.slice(3);
  const named = /^\?<[^>]+>/.exec(source);
  return named ? source.slice(named[0].length) : source;
}

function isGroupPrefixQuestion(source, index) {
  return index === 0 && [":", "=", "!", "<"].includes(source[index + 1]);
}

function preview(source) {
  return source.length <= 80 ? source : `${source.slice(0, 77)}...`;
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.sample}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { lintRegexReDoS };
