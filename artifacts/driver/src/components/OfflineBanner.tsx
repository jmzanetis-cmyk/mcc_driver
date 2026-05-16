// ============================================================
// MCC Driver — OfflineBanner
// ============================================================
// Slim, fixed-position banner that appears whenever the device
// reports no network. Mounted once at the App root. Stays out
// of the way (top inset, small height, non-blocking) so a driver
// can still see the screen underneath.
//
// App Store Review explicitly probes airplane-mode behavior;
// this banner is the user-visible proof that the app noticed
// the network loss instead of silently hanging.
// ============================================================

import { useEffect, useState } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export function OfflineBanner() {
  const { online } = useNetworkStatus();
  // Once we've gone offline, briefly keep the banner visible after
  // reconnect so the driver can see "Back online" — then fade out.
  const [reconnectFlash, setReconnectFlash] = useState(false);
  const [hadOffline, setHadOffline] = useState(false);

  useEffect(() => {
    if (!online) {
      setHadOffline(true);
      setReconnectFlash(false);
      return;
    }
    if (online && hadOffline) {
      setReconnectFlash(true);
      const t = setTimeout(() => setReconnectFlash(false), 2500);
      return () => clearTimeout(t);
    }
    return;
  }, [online, hadOffline]);

  if (online && !reconnectFlash) return null;

  const isOffline = !online;
  const label = isOffline ? "You're offline" : "Back online";
  const sub = isOffline
    ? "Some actions are paused. We'll catch up when you reconnect."
    : "";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top, 0px)",
        left: 0,
        right: 0,
        zIndex: 9998,
        padding: "6px 12px",
        background: isOffline ? "#B91C1C" : "#15803D",
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: 600,
        textAlign: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        transition: "background 200ms ease",
      }}
    >
      <span>{label}</span>
      {sub && (
        <span style={{ display: "block", fontSize: 11, fontWeight: 400, opacity: 0.9 }}>
          {sub}
        </span>
      )}
    </div>
  );
}
