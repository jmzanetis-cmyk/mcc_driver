// Non-dismissable banner shown app-wide whenever the server has set
// `outageMessage` on app_config. Sits just below the safe-area inset
// so it doesn't collide with the notch / OfflineBanner. Distinct
// color from the offline banner (amber vs red) so an incident is
// instantly distinguishable from a network drop.

import React from "react";
import { useAppStatusStore } from "@/store/appStatusStore";
import { colors } from "@/theme";

export function OutageBanner() {
  const outageMessage = useAppStatusStore((s) => s.status?.outageMessage);
  if (!outageMessage) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        // Push below the iOS safe area so the message isn't clipped
        // by the notch / status bar.
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
        paddingBottom: 8,
        paddingLeft: 16,
        paddingRight: 16,
        background: colors.warning ?? "#b45309",
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
        textAlign: "center",
        zIndex: 1500,
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
      }}
    >
      {outageMessage}
    </div>
  );
}
