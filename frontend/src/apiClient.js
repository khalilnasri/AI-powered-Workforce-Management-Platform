import axios from "axios";

/**
 * Zentrale API-Konfiguration für Time Stemple
 *
 * Lokal:
 * - Wenn VITE_API_BASE leer ist, nutzt Vite den Proxy aus vite.config.ts
 *
 * Produktion:
 * - Standardmäßig wird die echte Hetzner-API verwendet:
 *   https://api.work-track.de
 */
export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "" : "https://api.work-track.de");

const STORAGE_KEY = "timestemple_access_token";

export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  }
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const token = getToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url ?? "");

    const isAuthRequest =
      url.includes("/auth/login") || url.includes("/auth/register");

    if (status === 401 && !isAuthRequest) {
      clearToken();

      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  }
);