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
          name: 'site',
          include: ['apps/site/test/**/*.test.js'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
