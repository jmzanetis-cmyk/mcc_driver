// ============================================================
// MCC Driver — ActiveRideWatcher
// ============================================================
// Mounts the Supabase Realtime ride-cancellation subscription
// at the app level so it remains active regardless of which
// screen the driver is currently on. When the server cancels
// an active ride, it automatically navigates the driver to
// the home screen where the cancellation notice is shown.
// ============================================================

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRideCancellation } from '@/hooks/useRideCancellation';
import { useDispatchStore } from '@/store/dispatchStore';
import { announceAlwaysUpgrade } from '@/services/location/permissionFlow';

// Stages where the driver is actively servicing a ride and we want
// background location to keep flowing (iOS will surface its own
// "Always Allow" upgrade prompt once it sees sustained background use).
const ACTIVE_STAGES = new Set([
  'accepted',
  'navigating',
  'arrived',
  'in_progress',
]);

export function ActiveRideWatcher() {
  useRideCancellation();

  const navigate = useNavigate();
  const serverCancelled = useDispatchStore((s) => s.serverCancelled);
  const stage = useDispatchStore((s) => s.stage);
  const announcedRef = useRef(false);

  useEffect(() => {
    if (serverCancelled) {
      navigate('/home', { replace: true });
    }
  }, [serverCancelled]);

  // First time the driver enters an active-ride stage, prep them for the
  // iOS "Always Allow" upgrade prompt that will surface once the screen
  // locks and the app keeps using location in the background.
  useEffect(() => {
    if (!announcedRef.current && ACTIVE_STAGES.has(stage)) {
      announcedRef.current = true;
      void announceAlwaysUpgrade();
    }
    if (stage === 'idle') {
      announcedRef.current = false;
    }
  }, [stage]);

  return null;
}
