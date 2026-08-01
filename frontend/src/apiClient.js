import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

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
const isNative = Capacitor.isNativePlatform();

/**
 * Token is read synchronously from localStorage everywhere (browser AND
 * native) so existing sync call sites (e.g. route guards) keep working
 * unchanged. On native platforms only, every write is additionally
 * mirrored to @capacitor/preferences as a durable, app-sandboxed copy —
 * preparation for fully moving off localStorage later. Preferences is
 * NOT encrypted storage; treat this as a first step, not a secure-storage
 * migration.
 */
export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token) {
  if (!token) return;
  localStorage.setItem(STORAGE_KEY, token);
  if (isNative) {
    Preferences.set({ key: STORAGE_KEY, value: token }).catch(() => {});
  }
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
  if (isNative) {
    Preferences.remove({ key: STORAGE_KEY }).catch(() => {});
  }
}

/** Native-only: restore the token into localStorage from Preferences on app start
 *  (e.g. after the WebView's storage was cleared but Preferences persisted). No-op
 *  in the browser. Call once during native app bootstrap; existing sync getToken()
 *  callers are unaffected either way. */
export async function hydrateTokenFromPreferences() {
  if (!isNative || getToken()) return;
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  if (value) localStorage.setItem(STORAGE_KEY, value);
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

    if ((status === 401 || status === 403) && !isAuthRequest) {
      clearToken();

      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  }
);