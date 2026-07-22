import { defineConfig } from 'vitest/config';

// Pin the config root to this package so `vitest run` (from `npm test`) does not
// walk up and load the repo-root vitest.config.js — that root config resolves
// `vitest/config` against the root node_modules, which isn't installed when this
// package is built/tested in isolation (e.g. its own CI job). Keeping a local
// config makes `agent-desk` self-contained.
export default defineConfig({
  test: {
    root: __dirname,
  },
});
