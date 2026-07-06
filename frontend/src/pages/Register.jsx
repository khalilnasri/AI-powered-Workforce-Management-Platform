import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthPasswordInput } from "../components/AuthPasswordInput";
import { apiClient, getToken } from "../apiClient";
import { dashboardPathForRole } from "../authPaths";
import {
  formatPasswordError,
  getPasswordMissingRules,
  parseAuthApiError,
  validateRegisterForm,
} from "../utils/authValidation";
import "./Login.css";

const PASSWORD_HINT =
  "Mindestens 8 Zeichen, Groß- und Kleinbuchstabe, Zahl und Sonderzeichen.";

export function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const nameRef = useRef(null);
  const navigate = useNavigate();

  const passwordMissing = useMemo(
    () => (password ? getPasswordMissingRules(password) : []),
    [password]
  );

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    apiClient
      .get("/auth/me")
      .then((res) => {
        if (!cancelled) {
          navigate(dashboardPathForRole(res.data?.role), { replace: true });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    document.title = "Registrieren · Time Stemple";
    return () => {
      document.title = "Time Stemple";
    };
  }, []);

  function clearFieldError(field) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);

    const { errors, trimmedName, normalizedEmail, trimmedInviteCode } = validateRegisterForm({
      name,
      email,
      password,
      confirmPassword,
      inviteCode,
    });

    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setBusy(true);

    try {
      await apiClient.post("/auth/register", {
        name: trimmedName,
        email: normalizedEmail,
        password,
        invite_code: trimmedInviteCode || undefined,
      });
      navigate("/login", { state: { registered: true }, replace: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setFormError(parseAuthApiError(err));
      } else {
        setFormError("Unerwarteter Fehler bei der Registrierung.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card login-card--wide" onSubmit={handleSubmit} noValidate>
        <div className="login-card__header">
          <p className="login-brand">Time Stemple</p>
          <h1 className="login-title">Konto erstellen</h1>
          <p className="login-hint">
            Erstelle dein Konto für die Zeiterfassung. Dein Passwort wird sicher
            verschlüsselt gespeichert.
          </p>
          <p className="login-register-note">
            Der erste registrierte Benutzer wird automatisch Administrator. Alle
            weiteren Konten benötigen einen gültigen Einladungscode von einem
            Administrator.
          </p>
        </div>

        <div className={`login-field${fieldErrors.name ? " login-field--error" : ""}`}>
          <label className="login-label" htmlFor="reg-name">
            Name
          </label>
          <input
            ref={nameRef}
            id="reg-name"
            name="name"
            className={`login-input${fieldErrors.name ? " login-input--invalid" : ""}`}
            type="text"
            autoComplete="name"
            placeholder="Max Mustermann"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearFieldError("name");
            }}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "reg-name-error" : undefined}
          />
          {fieldErrors.name ? (
            <p id="reg-name-error" className="login-field-error" role="alert">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div className={`login-field${fieldErrors.email ? " login-field--error" : ""}`}>
          <label className="login-label" htmlFor="reg-email">
            E-Mail
          </label>
          <input
            id="reg-email"
            name="email"
            className={`login-input${fieldErrors.email ? " login-input--invalid" : ""}`}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="name@unternehmen.de"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearFieldError("email");
            }}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "reg-email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p id="reg-email-error" className="login-field-error" role="alert">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className={`login-field${fieldErrors.inviteCode ? " login-field--error" : ""}`}>
          <label className="login-label" htmlFor="reg-invite-code">
            Einladungscode
          </label>
          <input
            id="reg-invite-code"
            name="inviteCode"
            className={`login-input${fieldErrors.inviteCode ? " login-input--invalid" : ""}`}
            type="text"
            autoComplete="off"
            placeholder="TS-A3X9KL"
            value={inviteCode}
            onChange={(e) => {
              setInviteCode(e.target.value);
              clearFieldError("inviteCode");
            }}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.inviteCode)}
            aria-describedby="reg-invite-code-hint"
          />
          <p id="reg-invite-code-hint" className="login-hint">
            Von deinem Administrator erhalten. Nur beim allerersten Konto in
            einem neuen System nicht erforderlich.
          </p>
          {fieldErrors.inviteCode ? (
            <p className="login-field-error" role="alert">
              {fieldErrors.inviteCode}
            </p>
          ) : null}
        </div>

        <AuthPasswordInput
          id="reg-password"
          name="password"
          label="Passwort"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearFieldError("password");
          }}
          error={fieldErrors.password}
          disabled={busy}
          autoComplete="new-password"
          placeholder="Sicheres Passwort wählen"
          hint={PASSWORD_HINT}
        />

        {password && passwordMissing.length > 0 && !fieldErrors.password ? (
          <p className="login-password-strength" role="status">
            {formatPasswordError(passwordMissing)}
          </p>
        ) : null}

        <AuthPasswordInput
          id="reg-confirm-password"
          name="confirmPassword"
          label="Passwort bestätigen"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            clearFieldError("confirmPassword");
          }}
          error={fieldErrors.confirmPassword}
          disabled={busy}
          autoComplete="new-password"
          placeholder="Passwort wiederholen"
        />

        <button className="login-button" type="submit" disabled={busy}>
          {busy ? (
            <span className="login-button__content">
              <span className="login-spinner" aria-hidden="true" />
              Konto wird erstellt…
            </span>
          ) : (
            "Registrieren"
          )}
        </button>

        {formError ? (
          <p className="login-form-error" role="alert">
            {formError}
          </p>
        ) : null}

        <p className="login-footer">
          <Link className="login-link" to="/login">
            Bereits ein Konto? Anmelden
          </Link>
        </p>
      </form>
    </div>
  );
}
