export function initSentry(): void {}
export function captureException(_err: unknown): void {}
export function captureMessage(_msg: string): void {}
export const Sentry = { captureException, captureMessage };
