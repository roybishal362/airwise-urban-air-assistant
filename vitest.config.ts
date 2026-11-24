import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'public/js/**/*.js'],
      exclude: ['src/server.ts', 'public/js/main.js'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
});
