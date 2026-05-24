import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: [
        'src/hooks/useDriverStatus.ts',
        'src/hooks/useRideRequests.ts',
        'src/hooks/useActiveRide.ts',
        'src/store/dispatchStore.ts',
        'src/services/navigation/navService.ts',
        'src/services/navigation/routeService.ts',
        'src/services/api/edgeFunctions.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  define: {
    __SENTRY_RELEASE__: JSON.stringify('test'),
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
});
