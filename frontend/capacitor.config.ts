import type { CapacitorConfig } from "@capacitor/cli";

// appId is a proposal (reverse-DNS of the production domain work-track.de)
// and easy to change later; changing it after a Play Store listing exists
// would require a new app listing, so confirm before shipping.
const config: CapacitorConfig = {
  appId: "de.worktrack.employee",
  appName: "Time Stemple",
  webDir: "dist-mobile",
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#F0EADD",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      // Dark icons — the app bar underneath is warm cream (--mb-paper).
      style: "LIGHT",
      backgroundColor: "#F0EADD",
    },
  },
};

export default config;
