import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthPasswordInput } from "../components/AuthPasswordInput";
import { apiClient, getToken, setToken } from "../apiClient";
import { dashboardPathForRole } from "../authPaths";
import { parseAuthApiError, validateLoginForm } from "../utils/authValidation";
import { useIsMobile } from "../utils/useIsMobile";
import "./Login.css";

function NelaLogoMark({ variant = "glass", size = 54 }) {
  return (
    <div
      className={`nela-logo-mark nela-logo-mark--${variant}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {variant === "glass" ? <span className="nela-logo-mark__dot" /> : null}
      <svg
        className="nela-logo-mark__n"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 19 L7 5 L17 19 L17 5" />
      </svg>
    </div>
  );
}

function NelaWordmark({ theme = "onDark" }) {
  return (
    <div className={`nela-wordmark nela-wordmark--${theme}`}>
      <span className="nela-wordmark__name">
        Nela<span className="nela-wordmark__dot">.</span>
      </span>
      <span className="nela-wordmark__sub">SERVICE</span>
    </div>
  );
}

function NelaPasswordLabel(id) {
  return (
    <div className="nela-label-row">
      <label className="nela-label" htmlFor={id}>
        Passwort
      </label>
      <Link className="nela-forgot-link" to="#">
        Vergessen?
      </Link>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const emailRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const justRegistered = Boolean(location.state?.registered);
  const isMobile = useIsMobile();

  useEffect(() => {
    emailRef.current?.focus();
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
      .catch(() => {
        if (!cancelled) navigate("/login", { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    document.title = "Anmelden · Nela Service";
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

    const { errors, normalizedEmail } = validateLoginForm({ email, password });
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setBusy(true);

    try {
      const { data } = await apiClient.post("/auth/login", {
        email: normalizedEmail,
        password,
      });

      if (data?.access_token) {
        setToken(data.access_token);
        navigate(dashboardPathForRole(data.role), { replace: true });
      } else {
        setFormError("Anmeldung erfolgreich, aber kein Token erhalten.");
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setFormError(parseAuthApiError(err));
      } else {
        setFormError("Unerwarteter Fehler beim Anmelden.");
      }
    } finally {
      setBusy(false);
    }
  }

  const formProps = {
    email,
    setEmail,
    password,
    setPassword,
    fieldErrors,
    formError,
    busy,
    justRegistered,
    emailRef,
    clearFieldError,
    handleSubmit,
  };

  return isMobile ? <MobileLogin {...formProps} /> : <DesktopLogin {...formProps} />;
}

function LoginFormFields({ email, setEmail, password, setPassword, fieldErrors, busy, emailRef, clearFieldError }) {
  return (
    <>
      <div className={`nela-field${fieldErrors.email ? " nela-field--error" : ""}`}>
        <label className="nela-label" htmlFor="email">
          E-Mail
        </label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          className={`nela-input${fieldErrors.email ? " nela-input--invalid" : ""}`}
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
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
        />
        {fieldErrors.email ? (
          <p id="email-error" className="nela-field-error" role="alert">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <AuthPasswordInput
        variant="nela"
        id="password"
        name="password"
        label="Passwort"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clearFieldError("password");
        }}
        error={fieldErrors.password}
        disabled={busy}
        autoComplete="current-password"
        placeholder="Dein Passwort"
        renderLabel={NelaPasswordLabel}
      />
    </>
  );
}

function LoginFormFooter({ busy, formError, justRegistered }) {
  return (
    <>
      <button className="nela-cta" type="submit" disabled={busy}>
        {busy ? (
          <span className="nela-cta__content">
            <span className="nela-spinner" aria-hidden="true" />
            Wird angemeldet…
          </span>
        ) : (
          "Anmelden"
        )}
      </button>

      {formError ? (
        <p className="nela-form-error" role="alert">
          {formError}
        </p>
      ) : null}

      {justRegistered && !formError ? (
        <p className="nela-form-success" role="status">
          Konto erstellt. Du kannst dich jetzt anmelden.
        </p>
      ) : null}

      <p className="nela-footer-row">
        <Link className="nela-link" to="/register">
          Noch kein Konto? Registrieren
        </Link>
      </p>
    </>
  );
}

function DesktopLogin(props) {
  const { busy, formError, justRegistered, handleSubmit } = props;
  return (
    <div className="nela-login nela-login--desktop">
      <div className="nela-brand-panel">
        <div className="nela-blob nela-blob--1" />
        <div className="nela-blob nela-blob--2" />
        <div className="nela-blob nela-blob--3" />
        <div className="nela-grid-overlay" />

        <div className="nela-brand-top nela-rise" style={{ "--nela-delay": "0.05s" }}>
          <NelaLogoMark variant="glass" size={54} />
          <NelaWordmark theme="onDark" />
        </div>

        <div className="nela-brand-middle">
          <h2 className="nela-hero nela-rise" style={{ "--nela-delay": "0.2s" }}>
            Deine Arbeitszeit,
            <br />
            klar im Blick.
          </h2>
          <p className="nela-hero-copy nela-rise" style={{ "--nela-delay": "0.32s" }}>
            Nela Service verbindet Zeiterfassung, Urlaub und Planung deines Teams
            — an jedem Standort, in einer App.
          </p>
          <div className="nela-stats nela-rise" style={{ "--nela-delay": "0.44s" }}>
            <div className="nela-stat">
              <span className="nela-stat__num">12+</span>
              <span className="nela-stat__label">Standorte</span>
            </div>
            <div className="nela-stat">
              <span className="nela-stat__num">98%</span>
              <span className="nela-stat__label">Zeitersparnis</span>
            </div>
            <div className="nela-stat">
              <span className="nela-stat__num">24/7</span>
              <span className="nela-stat__label">Zugriff</span>
            </div>
          </div>
        </div>

        <p className="nela-brand-footer">© 2026 Nela Service · Powered by Time Stemple</p>
      </div>

      <div className="nela-form-panel">
        <div className="nela-form-inner">
          <div className="nela-compact-logo nela-rise" style={{ "--nela-delay": "0.05s" }}>
            <NelaLogoMark variant="solid" size={44} />
            <NelaWordmark theme="onLight" />
          </div>

          <form
            className="nela-form nela-rise"
            style={{ "--nela-delay": "0.15s" }}
            onSubmit={handleSubmit}
            noValidate
          >
            <h1 className="nela-title">Willkommen zurück</h1>
            <p className="nela-subtitle">Melde dich mit deiner E-Mail und deinem Passwort an.</p>

            <LoginFormFields {...props} />
            <LoginFormFooter busy={busy} formError={formError} justRegistered={justRegistered} />
          </form>
        </div>
      </div>
    </div>
  );
}

function MobileLogin(props) {
  const { busy, formError, justRegistered, handleSubmit } = props;
  return (
    <div className="nela-login nela-login--mobile">
      <div className="nela-mobile-hero">
        <div className="nela-blob nela-blob--1" />
        <div className="nela-blob nela-blob--2" />
        <div className="nela-grid-overlay" />

        <div className="nela-brand-top nela-rise" style={{ "--nela-delay": "0.05s" }}>
          <NelaLogoMark variant="glass" size={48} />
          <NelaWordmark theme="onDark" />
        </div>

        <h2 className="nela-hero nela-rise" style={{ "--nela-delay": "0.18s" }}>
          Deine Arbeitszeit,
          <br />
          klar im Blick.
        </h2>
        <p className="nela-hero-copy nela-rise" style={{ "--nela-delay": "0.28s" }}>
          Nela Service verbindet Zeiterfassung, Urlaub und Planung deines Teams —
          an jedem Standort, in einer App.
        </p>
      </div>

      <div className="nela-mobile-form-section">
        <form
          className="nela-form nela-rise"
          style={{ "--nela-delay": "0.1s" }}
          onSubmit={handleSubmit}
          noValidate
        >
          <h1 className="nela-title">Willkommen zurück</h1>
          <p className="nela-subtitle">Melde dich mit deiner E-Mail und deinem Passwort an.</p>

          <LoginFormFields {...props} />
          <LoginFormFooter busy={busy} formError={formError} justRegistered={justRegistered} />
        </form>

        <p className="nela-mobile-footer">© 2026 Nela Service · Powered by Time Stemple</p>
      </div>
    </div>
  );
}
