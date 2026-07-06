/** Gemeinsame Client-Validierung für Login & Registrierung (spiegelt Backend-Regeln). */

const EMAIL_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;

const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export const INVALID_EMAIL_MSG = "Bitte gib eine gültige E-Mail-Adresse ein.";
export const LOGIN_FAILED_MSG = "E-Mail oder Passwort ist nicht korrekt.";
export const DUPLICATE_EMAIL_MSG =
  "Mit dieser E-Mail-Adresse existiert bereits ein Konto.";

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

export function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254) return false;
  return EMAIL_RE.test(normalized);
}

export function getPasswordMissingRules(password) {
  const missing = [];
  if (password.length < 8) missing.push("mindestens 8 Zeichen");
  if (!/[A-Z]/.test(password)) missing.push("ein Großbuchstabe");
  if (!/[a-z]/.test(password)) missing.push("ein Kleinbuchstabe");
  if (!/\d/.test(password)) missing.push("eine Zahl");
  if (!SPECIAL_RE.test(password)) missing.push("ein Sonderzeichen");
  return missing;
}

export function formatPasswordError(missing) {
  if (!missing.length) return "";
  if (missing.length === 1) {
    return `Das Passwort muss ${missing[0]} enthalten.`;
  }
  return `Das Passwort muss ${missing.slice(0, -1).join(", ")} und ${missing[missing.length - 1]} enthalten.`;
}

export function validateLoginForm({ email, password }) {
  const errors = {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    errors.email = INVALID_EMAIL_MSG;
  } else if (!isValidEmail(normalizedEmail)) {
    errors.email = INVALID_EMAIL_MSG;
  }

  if (!password) {
    errors.password = "Bitte gib dein Passwort ein.";
  }

  return { errors, normalizedEmail };
}

export function validateRegisterForm({ name, email, password, confirmPassword, inviteCode }) {
  const errors = {};
  const trimmedName = String(name ?? "").trim();
  const normalizedEmail = normalizeEmail(email);
  const trimmedInviteCode = String(inviteCode ?? "").trim().toUpperCase();

  if (!trimmedName) {
    errors.name = "Bitte gib deinen Namen ein.";
  }

  if (!normalizedEmail) {
    errors.email = INVALID_EMAIL_MSG;
  } else if (!isValidEmail(normalizedEmail)) {
    errors.email = INVALID_EMAIL_MSG;
  }

  if (!password) {
    errors.password = "Bitte wähle ein Passwort.";
  } else {
    const missing = getPasswordMissingRules(password);
    if (missing.length) {
      errors.password = formatPasswordError(missing);
    }
  }

  if (!confirmPassword) {
    errors.confirmPassword = "Bitte bestätige dein Passwort.";
  } else if (password !== confirmPassword) {
    errors.confirmPassword = "Die Passwörter stimmen nicht überein.";
  }

  return { errors, trimmedName, normalizedEmail, trimmedInviteCode };
}

export function parseAuthApiError(err) {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;

  if (status === 401) return LOGIN_FAILED_MSG;
  if (status === 403 && typeof detail === "string") return detail;
  if (status === 409) return DUPLICATE_EMAIL_MSG;
  if (status === 503) {
    return "Backend läuft, aber die Datenbank antwortet nicht. Bitte Datenbank-Konfiguration prüfen.";
  }

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || JSON.stringify(d)).join(" ");
  }

  if (status) return `Anfrage fehlgeschlagen (HTTP ${status}).`;
  return "Keine Verbindung zum Server. Bitte prüfen, ob das Backend erreichbar ist.";
}
