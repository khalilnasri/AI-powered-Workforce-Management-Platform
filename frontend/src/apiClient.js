import axios from "axios";

/**
 * Development: leerer String → Anfragen gehen an den Vite-Server (z. B. :5173),
 * der per vite.config.ts an FastAPI (:8000) proxyt.
 * Production: setzen Sie VITE_API_BASE in .env (z. B. https://api.example.com).
 */
export const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? "" : "http://127.0.0.1:8000");
const STORAGE_KEY = "timestemple_access_token";

export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export const apiClient = axios.create({
  baseURL: API_BASE,
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = String(error.config?.url ?? "");
      if (!url.includes("/auth/login") && !url.includes("/auth/register")) {
        clearToken();
        if (!window.location.pathname.startsWith("/login")) {
          window.location.assign("/login");
        }
      }
    }
    return Promise.reject(error);
  },
);
