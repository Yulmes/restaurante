import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/*/src/**/*.test.ts',
      'apps/*/app/**/*.test.ts',
      'apps/*/scripts/**/*.test.ts',
      'apps/*/prisma/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    // Las pruebas contra PostgreSQL (*.db.test.ts) corren aparte: vitest.db.config.ts.
    exclude: ['**/node_modules/**', '**/*.db.test.ts'],
    environment: 'node',
  },
});
