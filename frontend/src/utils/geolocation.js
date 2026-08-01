import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

// Mirrors the standard PositionError codes so existing callers that read
// err.code / err.message keep working unchanged in the browser.
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

const RETRY_DELAY_MS = 1_000;

const OFFLINE_MESSAGE = "Keine Internetverbindung. Bitte Netzwerk prüfen und erneut versuchen.";
const SETTINGS_HINT = "Einstellungen > Apps > Time Stemple > Berechtigungen > Standort";

// Android/iOS report a disabled system location toggle only through the error
// text, so this is the one case we can tell apart from a plain app denial.
const SERVICES_DISABLED = /location (services?|provider)|not enabled|disabled|ausgeschaltet|deaktiviert/i;

function describeError(code, rawMessage = "") {
  switch (code) {
    case PERMISSION_DENIED:
      return `Standortzugriff wurde verweigert. Berechtigung manuell erteilen unter: ${SETTINGS_HINT}.`;
    case TIMEOUT:
      return "Standortabfrage hat zu lange gedauert. Bitte GPS-Signal prüfen (im Freien erneut versuchen).";
    case POSITION_UNAVAILABLE:
      return SERVICES_DISABLED.test(rawMessage)
        ? "Die Standortdienste sind deaktiviert. Bitte GPS/Standort in den Systemeinstellungen einschalten."
        : "Standort ist aktuell nicht verfügbar. Bitte GPS/Standortdienste aktivieren und erneut versuchen.";
    default:
      return "Standortberechtigung verweigert oder nicht verfügbar.";
  }
}

// navigator.onLine only reliably reports the *offline* state; "online" can be a
// false positive (captive portal, no upstream route). Good enough as an early hint.
function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Cross-platform getCurrentPosition: navigator.geolocation in the browser
 * (unchanged behavior), @capacitor/geolocation in the native Android/iOS
 * app. Same callback shape as navigator.geolocation.getCurrentPosition so
 * existing call sites only need to swap their import.
 */
export function getCurrentPosition(onSuccess, onError, options = GEOLOCATION_OPTIONS) {
  if (isOffline()) {
    onError({ code: POSITION_UNAVAILABLE, message: OFFLINE_MESSAGE, offline: true });
    return;
  }

  if (Capacitor.isNativePlatform()) {
    Geolocation.checkPermissions()
      .then((status) =>
        status.location === "granted" || status.coarseLocation === "granted"
          ? status
          : Geolocation.requestPermissions({ permissions: ["location"] }),
      )
      .then(() => Geolocation.getCurrentPosition(options))
      .then((position) => onSuccess(position))
      .catch((err) => {
        const rawMessage = err?.message ?? "";
        const code =
          typeof err?.code === "number"
            ? err.code
            : /denied|permission/i.test(rawMessage)
              ? PERMISSION_DENIED
              : /timeout|timed out/i.test(rawMessage)
                ? TIMEOUT
                : POSITION_UNAVAILABLE;
        onError({ code, message: describeError(code, rawMessage), rawMessage });
      });
    return;
  }

  if (!navigator.geolocation) {
    onError({ code: POSITION_UNAVAILABLE, message: "Dieser Browser unterstützt keine Geolocation." });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    onSuccess,
    (err) =>
      onError({
        code: err.code,
        message: describeError(err.code, err.message ?? ""),
        rawMessage: err.message ?? "",
      }),
    options,
  );
}

/**
 * Like getCurrentPosition, but retries transient failures (timeout / position
 * unavailable). A denied permission and a missing network connection are never
 * retried — repeating them only delays the error the user has to act on.
 */
export function getCurrentPositionWithRetry(onSuccess, onError, options = GEOLOCATION_OPTIONS, maxRetries = 1) {
  const attempt = (remaining) => {
    getCurrentPosition(onSuccess, (err) => {
      const retryable = err.code === TIMEOUT || err.code === POSITION_UNAVAILABLE;
      if (remaining > 0 && retryable && !err.offline) {
        setTimeout(() => attempt(remaining - 1), RETRY_DELAY_MS);
        return;
      }
      onError(err);
    }, options);
  };

  attempt(Math.max(0, maxRetries));
}

/**
 * Re-asks for the location permission, for a "Erneut versuchen" button in the UI.
 * Browsers have no programmatic re-request API — the prompt only reappears on the
 * next getCurrentPosition call (or after the user resets it in the site settings),
 * so the web path always resolves to "prompt".
 */
export async function requestLocationPermission() {
  if (!Capacitor.isNativePlatform()) return "prompt";

  try {
    const status = await Geolocation.requestPermissions({ permissions: ["location"] });
    if (status.location === "granted" || status.coarseLocation === "granted") return "granted";
    if (status.location === "denied" && status.coarseLocation === "denied") return "denied";
    return status.location ?? "prompt";
  } catch {
    return "denied";
  }
}
