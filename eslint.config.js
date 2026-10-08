import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/**',
      'apps/reader/public/models/**',
      'apps/reader/public/ort/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.playwright-browsers/**',
      'test-results/**',
      'playwright-report/**',
      'supabase/.temp/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // Edge Functions rodam no Deno (global Deno).
    files: ['supabase/functions/**/*.js'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
