// ============================================================
// MCC Driver — OfflineNotice
// ============================================================
// Inline "You're offline" badge for forms / submit buttons. Use
// this when the global OfflineBanner alone isn't enough — e.g.
// to explicitly mark a submit button as blocked, or surface the
// reason a network-dependent action just failed.
// ============================================================

import { useNetworkStatus, getNetworkStatus } from "@/hooks/useNetworkStatus";

export interface OfflineNoticeProps {
  /** Custom message. Defaults to a generic "You're offline" copy. */
  message?: string;
  /** Render even when online (e.g. for testing). */
  alwaysShow?: boolean;
  style?: React.CSSProperties;
}

export function OfflineNotice({ message, alwaysShow, style }: OfflineNoticeProps) {
  const { online } = useNetworkStatus();
  if (online && !alwaysShow) return null;
  return (
    <div
      role="status"
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "#FEF2F2",
        border: "1px solid #FCA5A5",
        color: "#991B1B",
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
    >
      <span aria-hidden>📡</span>
      <span>
        {message ?? "You're offline. We'll let you try again as soon as your connection is back."}
      </span>
    </div>
  );
}

/**
 * Convenience predicate for submit-button handlers. Returns true
 * if the device is offline; callers should short-circuit with an
 * inline error rather than firing a fetch that will hang.
 */
export function isOffline(): boolean {
  return !getNetworkStatus().online;
}
