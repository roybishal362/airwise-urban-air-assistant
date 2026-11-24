import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts', 'public/js/**/*.js'],
      exclude: [],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 97, functions: 97, statements: 97, branches: 90 },
    },
  },
});
