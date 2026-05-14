// ============================================================
// MCC Driver — Offline Persistence (IndexedDB)
// ============================================================
// Stores ride state locally so the app can recover after
// losing network connectivity mid-ride.
// ============================================================

import { openDB, type IDBPDatabase } from 'idb';
import { logger } from '@/services/telemetry/logger';

interface MCCDriverDB {
  'active-ride': { key: string; value: unknown };
  'pending-actions': { key: string; value: { action: string; payload: unknown; timestamp: number } };
  'driver-state': { key: string; value: unknown };
}

let dbInstance: IDBPDatabase<MCCDriverDB> | null = null;

async function getDB(): Promise<IDBPDatabase<MCCDriverDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<MCCDriverDB>('mcc-driver', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('active-ride')) {
        db.createObjectStore('active-ride');
      }
      if (!db.objectStoreNames.contains('pending-actions')) {
        db.createObjectStore('pending-actions');
      }
      if (!db.objectStoreNames.contains('driver-state')) {
        db.createObjectStore('driver-state');
      }
    },
  });

  return dbInstance;
}

/**
 * Save the current ride state locally for offline recovery
 */
export async function saveRideState(rideId: string, state: unknown): Promise<void> {
  try {
    const db = await getDB();
    await db.put('active-ride', state, rideId);
  } catch (err) {
    logger.warn('offline.save_ride_failed', err);
  }
}

/**
 * Recover ride state after reconnection
 */
export async function loadRideState(rideId: string): Promise<unknown | null> {
  try {
    const db = await getDB();
    return await db.get('active-ride', rideId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear stored ride state
 */
export async function clearRideState(rideId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('active-ride', rideId);
  } catch {
    // Ignore
  }
}

/**
 * Queue an action that failed due to offline. Will be retried on reconnect.
 */
export async function queueOfflineAction(action: string, payload: unknown): Promise<void> {
  try {
    const db = await getDB();
    const key = `${action}-${Date.now()}`;
    await db.put('pending-actions', { action, payload, timestamp: Date.now() }, key);
    logger.info('offline.action_queued', { action });
  } catch (err) {
    logger.warn('offline.queue_failed', err);
  }
}

/**
 * Get all pending offline actions and clear the queue
 */
export async function drainOfflineActions(): Promise<Array<{ action: string; payload: unknown }>> {
  try {
    const db = await getDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');
    const all = await store.getAll();
    await store.clear();
    await tx.done;
    logger.info('offline.actions_drained', { count: all.length });
    return all;
  } catch {
    return [];
  }
}

/**
 * Save driver preferences locally (nav app, etc.)
 */
export async function saveDriverPref(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDB();
    await db.put('driver-state', value, key);
  } catch {
    // Fallback to localStorage
    try { localStorage.setItem(`mcc_${key}`, JSON.stringify(value)); } catch {}
  }
}

export async function loadDriverPref<T>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    const val = await db.get('driver-state', key);
    return (val as T) ?? null;
  } catch {
    try {
      const ls = localStorage.getItem(`mcc_${key}`);
      return ls ? JSON.parse(ls) : null;
    } catch { return null; }
  }
}
