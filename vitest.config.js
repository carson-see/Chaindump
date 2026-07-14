import { defineConfig, configDefaults } from 'vitest/config';

// The root suite covers the Worker (src/lib/*, routes). The agent-desk/ package
// is a separate TypeScript project with its own vitest + deps — run it via
// `cd agent-desk && npm test`, not from here.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'agent-desk/**', '.claude/**'],
  },
});
