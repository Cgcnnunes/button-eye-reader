import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('0.1.0-test') },
  test: {
    coverage: {
      exclude: ['src/env.d.ts'],
      include: ['src/**/*.ts', 'scripts/policy.ts'],
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { branches: 80, functions: 90, lines: 90, perFile: true, statements: 90 },
    },
    restoreMocks: true,
  },
});
