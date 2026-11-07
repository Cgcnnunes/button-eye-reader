import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import prettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      '.husky/**',
      'public/vision/**',
    ],
  },
  js.configs.recommended,
  {
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{mjs,ts}'],
    languageOptions: { globals: globals.node },
    plugins: { '@stylistic': stylistic, perfectionist },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', next: '*', prev: '*' },
        { blankLine: 'any', next: 'import', prev: 'import' },
        { blankLine: 'any', next: 'export', prev: 'export' },
        { blankLine: 'any', next: ['const', 'let'], prev: ['const', 'let'] },
      ],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'perfectionist/sort-exports': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-imports': [
        'error',
        { newlinesBetween: 0, order: 'asc', sortSideEffects: false, type: 'alphabetical' },
      ],
      'perfectionist/sort-interfaces': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-named-exports': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-named-imports': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-object-types': ['error', { order: 'asc', type: 'alphabetical' }],
      'perfectionist/sort-objects': ['error', { order: 'asc', type: 'alphabetical' }],
      'prefer-const': 'error',
    },
  },
  prettier,
  {
    rules: {
      '@stylistic/quotes': [
        'error',
        'single',
        { allowTemplateLiterals: 'always', avoidEscape: true },
      ],
    },
  },
);
