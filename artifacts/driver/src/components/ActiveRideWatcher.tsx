// ============================================================
// MCC Driver — ActiveRideWatcher
// ============================================================
// Mounts the Supabase Realtime ride-cancellation subscription
// at the app level so it remains active regardless of which
// screen the driver is currently on. When the server cancels
// an active ride, it automatically navigates the driver to
// the home screen where the cancellation notice is shown.
// ============================================================

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRideCancellation } from '@/hooks/useRideCancellation';
import { useDispatchStore } from '@/store/dispatchStore';

export function ActiveRideWatcher() {
  useRideCancellation();

  const navigate = useNavigate();
  const serverCancelled = useDispatchStore((s) => s.serverCancelled);

  useEffect(() => {
    if (serverCancelled) {
      navigate('/home', { replace: true });
    }
  }, [serverCancelled]);

  return null;
}
