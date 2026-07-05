/**
 * ESLint flat config — Radar de Licitações
 *
 * Aplica as duas regras customizadas de P-74/P-78 sobre o código de aplicação.
 * O check de boundaries de dependências fica no dependency-cruiser (pnpm boundaries).
 *
 * Refs: arquitetura/10 §§8,6 — P-74 (naming ports), P-78 (AbortSignal em use cases)
 */

import tsParser from '@typescript-eslint/parser';
import noTechInPortName from './tools/eslint-rules/no-tech-in-port-name.js';
import requireAbortSignal from './tools/eslint-rules/require-abort-signal.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'infra/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  {
    files: [
      'modules/**/*.ts',
      'apps/**/*.ts',
      'apps/**/*.tsx',
      'shared/**/*.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      radar: {
        rules: {
          'no-tech-in-port-name': noTechInPortName,
          'require-abort-signal': requireAbortSignal,
        },
      },
    },
    rules: {
      'radar/no-tech-in-port-name': 'error',
      'radar/require-abort-signal': 'error',
    },
  },
];
