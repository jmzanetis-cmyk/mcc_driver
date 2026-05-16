import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mycarconcierge.driver",
  appName: "My Car Concierge Driver",
  webDir: "dist/public",
  ios: {
    contentInset: "always",
    backgroundColor: "#0B1220",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0B1220",
      iosSpinnerStyle: "small",
      spinnerColor: "#D4AF37",
      showSpinner: true,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // "LIGHT" = light-colored content (white text/icons) for use on our
      // dark brand background. (#0B1220).
      style: "LIGHT",
      backgroundColor: "#0B1220",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      style: "DARK",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
