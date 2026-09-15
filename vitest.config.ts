import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          include: ['apps/api/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 60000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'site',
          include: ['apps/site/test/**/*.test.js'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
