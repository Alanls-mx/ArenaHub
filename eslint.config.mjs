import js from '@eslint/js';
import next from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/.next/**', '**/generated/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next.map((configuration) => ({
    ...configuration,
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
  })),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { import: importPlugin },
    rules: {
      'import/order': ['error', { 'newlines-between': 'never', alphabetize: { order: 'asc' } }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}', 'packages/contracts/**/*.{js,ts}'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/apps/api/**', '**/api/src/**', '@prisma/*', 'prisma', 'pg'],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/apps/web/**', '**/web/src/**'] }],
    },
  },
];
