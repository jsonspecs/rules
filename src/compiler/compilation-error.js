/**
 * compiler/compilation-error.js
 *
 * Ошибка компиляции с полным списком проблем.
 * Бросается один раз в конце каждой фазы если фаза нашла хотя бы одну ошибку.
 *
 * Используется в:
 *   - build-snapshot.js (вывод всех ошибок пользователю)
 *   - тестах (проверка конкретных ошибок через errors[])
 */

'use strict';

class CompilationError extends Error {
  /**
   * @param {string[]} errors — список сообщений об ошибках
   */
  constructor(diagnostics) {
    const normalized = diagnostics.map((item) => typeof item === 'string' ? { code: 'COMPILATION_ERROR', level: 'error', message: item, phase: 'unknown', artifactId: null, path: null, location: null } : item);
    const errors = normalized.map((item) => item.message);
    const lines = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    super(`Compilation failed with ${errors.length} error(s):\n${lines}`);
    this.name = 'CompilationError';
    this.errors = errors; // массив строк — для программного доступа
    this.diagnostics = normalized;
  }
}

class RuntimeError extends Error {
  constructor({ code, message, details = null }) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}

module.exports = { CompilationError, RuntimeError };
