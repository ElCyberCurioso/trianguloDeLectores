import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'node_modules/**', '.wrangler/**', 'public/assets/*.js', 'public/assets/*.js.map',
      'coverage/**', 'test-results/**', 'playwright-report/**', 'dist/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: {
        console: 'readonly', crypto: 'readonly', fetch: 'readonly', Request: 'readonly',
        Response: 'readonly', Headers: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        FormData: 'readonly', File: 'readonly', Blob: 'readonly', TextEncoder: 'readonly',
        TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly', caches: 'readonly',
        addEventListener: 'readonly', document: 'readonly', window: 'readonly',
        localStorage: 'readonly', location: 'readonly', history: 'readonly', navigator: 'readonly',
        CSS: 'readonly', HTMLElement: 'readonly', HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly', HTMLButtonElement: 'readonly', HTMLAnchorElement: 'readonly',
        HTMLDialogElement: 'readonly', HTMLImageElement: 'readonly', HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly', HTMLTemplateElement: 'readonly', ParentNode: 'readonly',
        Element: 'readonly', URL_: 'readonly', process: 'readonly', DataView: 'readonly',
        Uint8Array: 'readonly', ArrayBuffer: 'readonly', WeakMap: 'readonly', Intl: 'readonly',
        D1Database: 'readonly', R2Bucket: 'readonly', KVNamespace: 'readonly',
        DurableObjectNamespace: 'readonly', Fetcher: 'readonly', ExecutionContext: 'readonly',
        ScheduledController: 'readonly', ExportedHandler: 'readonly', BufferSource: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-undef': 'off', // lo cubre TypeScript
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      // Barreras de seguridad: nada de eval ni de HTML sin pasar por el sanitizador.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  },
];
