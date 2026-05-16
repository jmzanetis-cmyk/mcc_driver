import { EventEmitter } from "node:events";

export interface TandemBroadcastOpenedEvent {
  tandemJobId: string;
  eligibleDriverIds: string[];
  matchDeadline: Date;
}

export interface TandemMatchedEvent {
  tandemJobId: string;
  rideAlongDriverId: string;
}

export interface TandemDeclinedEvent {
  tandemJobId: string;
  rideAlongDriverId: string;
  reason: string | null;
}

export interface TandemExpiredEvent {
  tandemJobIds: string[];
}

export interface TandemEventMap {
  "tandem.broadcast.opened": [TandemBroadcastOpenedEvent];
  "tandem.matching.accepted": [TandemMatchedEvent];
  "tandem.matching.declined": [TandemDeclinedEvent];
  "tandem.expired": [TandemExpiredEvent];
}

class TypedTandemEmitter extends EventEmitter {
  override emit<K extends keyof TandemEventMap>(
    event: K,
    ...args: TandemEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof TandemEventMap>(
    event: K,
    listener: (...args: TandemEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

export const tandemEvents: TypedTandemEmitter = new TypedTandemEmitter();
