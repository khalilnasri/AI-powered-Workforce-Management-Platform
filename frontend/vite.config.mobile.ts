import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Separate build config for the Capacitor (Android/iOS) app.
 * Builds ONLY index.mobile.html -> src/main.mobile.jsx -> App.mobile.jsx
 * (employee routes only, no AdminDashboard) into dist-mobile/.
 *
 * The existing vite.config.ts / index.html / dist/ (web app) are
 * completely untouched by this file.
 */
export default defineConfig({
  plugins: [react()],
  // Capacitor loads the app from capacitor://localhost or file://,
  // so assets must use relative paths instead of absolute "/..." paths.
  base: "./",
  build: {
    outDir: "dist-mobile",
    rollupOptions: {
      input: fileURLToPath(new URL("./index.mobile.html", import.meta.url)),
    },
  },
});
