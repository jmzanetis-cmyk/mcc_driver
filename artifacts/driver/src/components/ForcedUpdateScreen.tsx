// Full-screen blocking screen shown when the running app version is
// below the server's `minSupportedVersion`. Single action: open the
// App Store. Intentionally NO close button, NO dismiss gesture — the
// user must update before they can continue using the app.

import React from "react";
import { colors, borderRadius } from "@/theme";
import { Button } from "@/components";
import { DEFAULT_APP_STORE_URL } from "@/services/appStatus";

interface ForcedUpdateScreenProps {
  appStoreUrl: string | null;
  currentVersion: string;
  minSupportedVersion: string;
}

export function ForcedUpdateScreen({
  appStoreUrl,
  currentVersion,
  minSupportedVersion,
}: ForcedUpdateScreenProps) {
  const targetUrl = appStoreUrl ?? DEFAULT_APP_STORE_URL;

  const handleOpenStore = () => {
    // window.open with _blank cleanly hands the URL off to the
    // system browser on both web and Capacitor iOS, which then routes
    // an itms-apps / apps.apple.com URL to the App Store app.
    const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = targetUrl;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-update-title"
      aria-describedby="forced-update-body"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: colors.bgPrimary,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 56, marginBottom: 16 }} aria-hidden="true">
        ⬆️
      </div>
      <h1
        id="forced-update-title"
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: colors.navy,
          margin: 0,
          marginBottom: 12,
        }}
      >
        Update required
      </h1>
      <p
        id="forced-update-body"
        style={{
          fontSize: 15,
          color: colors.textMuted,
          lineHeight: 1.45,
          maxWidth: 320,
          margin: 0,
          marginBottom: 24,
        }}
      >
        This version of My Car Concierge Driver is no longer supported.
        Please update to the latest version to continue.
      </p>
      <Button onClick={handleOpenStore} variant="primary" style={{ minWidth: 220 }}>
        Update now
      </Button>
      <div
        style={{
          marginTop: 24,
          fontSize: 11,
          color: colors.textMuted,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", monospace',
          opacity: 0.7,
          padding: "6px 10px",
          background: colors.surfaceDark,
          borderRadius: borderRadius.sm,
        }}
      >
        v{currentVersion} → required ≥ v{minSupportedVersion}
      </div>
    </div>
  );
}
