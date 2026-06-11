// ============================================================
// MCC Driver — useTrackingPublisher
//
// Thin React hook over the TrackingPublisher singleton.
// Screens call start()/stop() explicitly around handoff RPCs.
// CustodyHandoffScreen and NavigateScreen integrations are
// added in a separate commit after approval (per standing
// constraint on active-ride surfaces).
// ============================================================

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { trackingPublisher } from '@/services/tracking/publisher';
import type { PublisherParams } from '@/services/tracking/publisher';

function getSnapshot(): boolean {
  return trackingPublisher.isPublishing;
}
function subscribe(cb: () => void): () => void {
  return trackingPublisher.subscribe(cb);
}

export function useTrackingPublisher() {
  const isPublishing = useSyncExternalStore(subscribe, getSnapshot);

  // Re-read speed on every publisher tick (publisher calls _notify on fix).
  const [currentSpeedMph, setCurrentSpeedMph] = useState<number | null>(
    trackingPublisher.currentSpeedMph,
  );
  useEffect(() => {
    return trackingPublisher.subscribe(() => {
      setCurrentSpeedMph(trackingPublisher.currentSpeedMph);
    });
  }, []);

  const start = useCallback(
    (params: PublisherParams) => trackingPublisher.start(params),
    [],
  );

  const stop = useCallback(
    () => trackingPublisher.stop(),
    [],
  );

  const notifyAttested = useCallback(
    () => trackingPublisher.notifyAttested(),
    [],
  );

  const secureHold = useCallback(
    (handoffId: string, photoPath: string | null = null) =>
      trackingPublisher.secureHold(handoffId, photoPath),
    [],
  );

  const resumeFromHold = useCallback(
    (handoffId: string) => trackingPublisher.resumeFromHold(handoffId),
    [],
  );

  return { isPublishing, currentSpeedMph, start, stop, notifyAttested, secureHold, resumeFromHold };
}
