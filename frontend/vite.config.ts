import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Dev: Browser → gleicher Host wie Vite; Anfragen werden an FastAPI weitergeleitet (kein CORS-Thema). */
const API_TARGET = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": { target: API_TARGET, changeOrigin: true },
      "/employee": { target: API_TARGET, changeOrigin: true },
      "/attendance": { target: API_TARGET, changeOrigin: true },
      "/admin": { target: API_TARGET, changeOrigin: true },
      "/planning": { target: API_TARGET, changeOrigin: true },
      "/ai": { target: API_TARGET, changeOrigin: true },
      "/health": { target: API_TARGET, changeOrigin: true },
      "/docs": { target: API_TARGET, changeOrigin: true },
      "/openapi.json": { target: API_TARGET, changeOrigin: true },
    },
  },
});
