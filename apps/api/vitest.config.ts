import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Integration tests share one Postgres and TRUNCATE between cases, so files must
    // not run concurrently against each other.
    fileParallelism: false,
  },
});
