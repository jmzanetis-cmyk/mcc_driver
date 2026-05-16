import { initSentry } from '@/services/telemetry/sentry';

initSentry();

await import('./renderApp');
