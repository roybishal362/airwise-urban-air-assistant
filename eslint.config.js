import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Size and complexity limits for every shipped file (server, build script and
 * browser app). Tests are exempt: a describe() block is long by design.
 */
const qualityLimits = {
  complexity: ['error', 10],
  'max-depth': ['error', 3],
  'max-params': ['error', 4],
  'max-nested-callbacks': ['error', 3],
  'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
  'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
  // Every function, class and module-level arrow function says what it does.
  'jsdoc/require-jsdoc': [
    'error',
    {
      require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true },
      contexts: [
        'Program > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
        'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
      ],
    },
  ],
};

/** Type-aware rules (strictTypeChecked) for the TypeScript that ships. */
const typedTs = tseslint.configs.strictTypeChecked.map((config) => ({
  ...config,
  files: ['src/**/*.ts', 'scripts/**/*.ts'],
}));

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...typedTs,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Numbers in messages are fine; objects and nullish values are not.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'public/js/**/*.js'],
    plugins: { jsdoc },
    rules: qualityLimits,
  },
  {
    // SonarJS code-smell and bug-pattern rules (cognitive complexity, ReDoS-prone
    // regexes, nested conditionals, …) on all code, tests included.
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'public/js/**/*.js', 'tests/**/*.ts'],
    ...sonarjs.configs.recommended,
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'public/js/**/*.js', 'tests/**/*.ts'],
    rules: {
      // Named aliases such as `LocalTime = string` document a format at every use.
      'sonarjs/redundant-type-aliases': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests assert exact results on purpose (EPA truncation, parsed values, rounded figures).
      'sonarjs/no-floating-point-equality': 'off',
    },
  },
  {
    // The build script's command-line entry prints the bundle sizes.
    files: ['src/lib/logger.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'module' },
    rules: { eqeqeq: ['error', 'always'], 'no-console': 'error' },
  },
  {
    files: ['eslint.config.js', 'api/**/*.js'],
    languageOptions: { globals: globals.node },
  },
);
