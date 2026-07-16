// ESLint flat config. Scoped to the pure library modules and their tests — the
// code under active TDD. The legacy single-file worker.js and the vanilla-JS SPA
// (public/index.html) are intentionally excluded for now: SonarCloud is the
// repo-wide quality gate, and linting those in one pass would flood with legacy
// findings. New pure modules ship lint-clean here; the scope can widen later.
import js from '@eslint/js';

// Cloudflare Worker / Web runtime globals available to src/lib without imports.
const workerGlobals = {
  fetch: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', AbortSignal: 'readonly', AbortController: 'readonly',
  atob: 'readonly', btoa: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  crypto: 'readonly', structuredClone: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'src/worker.js', 'public/**', 'server.js'] },
  {
    files: ['src/lib/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: workerGlobals },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-implicit-coercion': 'off',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...workerGlobals,
        describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
];
