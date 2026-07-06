import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Dev: Browser → gleicher Host wie Vite; Anfragen werden an FastAPI weitergeleitet (kein CORS-Thema). */
const API_TARGET = "http://127.0.0.1:8000";

// Browser page navigations (refresh/direct URL) send Accept: text/html.
// Return /index.html so React Router handles the route instead of proxying to FastAPI.
function htmlBypass(req: { headers: Record<string, string | string[] | undefined> }) {
  if (req.headers["accept"]?.toString().includes("text/html")) return "/index.html";
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth":        { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/employee":    { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/attendance":  { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/admin":       { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/planning":    { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/ai":          { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/health":      { target: API_TARGET, changeOrigin: true, bypass: htmlBypass },
      "/docs":        { target: API_TARGET, changeOrigin: true },
      "/openapi.json":{ target: API_TARGET, changeOrigin: true },
    },
  },
});
