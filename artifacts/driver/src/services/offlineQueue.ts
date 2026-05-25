// ============================================================
// MCC Driver — Offline Request Queue
// ============================================================
// In-memory queue of failed API calls. On network restore
// (window 'online') the queue is replayed in order.
//
// Design constraints:
//   - No localStorage — not available in all Capacitor contexts
//   - Queue survives page focus changes but not app restarts
//   - Each op runs to completion or halts the flush (network still down)
// ============================================================

export type QueuedOp = {
  id: string;
  label: string;
  fn: () => Promise<void>;
  enqueuedAt: number;
};

let queue: QueuedOp[] = [];
let flushing = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

// ── Public API ────────────────────────────────────────────────────────────────

export function enqueue(fn: () => Promise<void>, label: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  queue.push({ id, label, fn, enqueuedAt: Date.now() });
  notify();
  return id;
}

export async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  notify();

  for (const op of [...queue]) {
    try {
      await op.fn();
      queue = queue.filter((q) => q.id !== op.id);
      notify();
    } catch {
      // Network still down or server error — stop replaying, leave remaining ops.
      break;
    }
  }

  flushing = false;
  notify();
}

export function getPendingCount(): number {
  return queue.length;
}

export function getIsFlushing(): boolean {
  return flushing;
}

export function getIsOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Auto-flush on network restore ────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flush();
  });
}
