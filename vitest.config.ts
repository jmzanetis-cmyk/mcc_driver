import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./artifacts/driver/src/__tests__/setup.ts'],
    include: ['artifacts/driver/src/**/*.test.ts', 'artifacts/driver/src/**/*.test.tsx'],
    exclude: [
      'node_modules',
      'dist',
      '**/visual.spec.ts',   // Playwright spec — run via `npx playwright test`, not vitest
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'artifacts/driver/src'),
    },
  },
  define: {
    __SENTRY_RELEASE__: JSON.stringify('test'),
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
});
