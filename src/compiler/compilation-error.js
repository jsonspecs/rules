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
   * @param {Array<string | object>} diagnostics — структурные диагностики
   */
  constructor(diagnostics) {
    const normalized = diagnostics.map((item) => {
      const value = typeof item === 'string' ? { message: item } : (item || {});
      return {
        ...value,
        code: value.code || 'COMPILATION_ERROR',
        level: value.level || 'error',
        message: value.message || String(item),
        phase: value.phase || 'unknown',
        artifactId: value.artifactId || null,
        path: value.path || null,
        location: value.location || null,
      };
    });
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
