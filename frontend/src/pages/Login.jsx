import axios from "axios";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiClient, getToken, setToken } from "../apiClient";
import { dashboardPathForRole } from "../authPaths";
import "./Login.css";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const justRegistered = Boolean(location.state?.registered);

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
    document.title = "Anmelden · Time Stemple";

    return () => {
      document.title = "Time Stemple";
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    setLoginError(null);
    setBusy(true);

    try {
      const { data } = await apiClient.post("/auth/login", {
        email: email.trim(),
        password,
      });

      if (data?.access_token) {
        setToken(data.access_token);
        navigate(dashboardPathForRole(data.role));
      } else {
        setLoginError("Login erfolgreich, aber kein Token erhalten.");
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;

        if (typeof detail === "string") {
          setLoginError(detail);
        } else if (Array.isArray(detail)) {
          setLoginError(detail.map((d) => d.msg || JSON.stringify(d)).join(" "));
        } else if (err.response?.status === 503) {
          setLoginError(
            "Backend läuft, aber die Datenbank antwortet nicht. Bitte Datenbank-Konfiguration prüfen."
          );
        } else if (err.response) {
          setLoginError(`Anmeldung fehlgeschlagen (HTTP ${err.response.status}).`);
        } else {
          setLoginError(
            "Keine Verbindung zum API-Server. Bitte prüfen, ob https://api.work-track.de/health erreichbar ist."
          );
        }
      } else {
        setLoginError("Unerwarteter Fehler beim Anmelden.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <p className="login-brand">Time Stemple</p>

        <h1 className="login-title">Anmelden</h1>

        <p className="login-hint">
          Melden Sie sich mit Ihrer E-Mail und Ihrem Passwort an.
        </p>

        <label className="login-label" htmlFor="email">
          E-Mail
        </label>

        <input
          id="email"
          name="email"
          className="login-input"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />

        <label className="login-label" htmlFor="password">
          Passwort
        </label>

        <input
          id="password"
          name="password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        <button className="login-button" type="submit" disabled={busy}>
          {busy ? "Wird angemeldet…" : "Anmelden"}
        </button>

        {loginError ? (
          <p className="login-error" role="alert">
            {loginError}
          </p>
        ) : null}

        {justRegistered && !loginError ? (
          <p className="login-success" role="status">
            Konto erstellt. Sie können sich jetzt anmelden.
          </p>
        ) : null}

        <p className="login-footer">
          <Link className="login-link" to="/register">
            Noch kein Konto? Registrieren
          </Link>
        </p>
      </form>
    </div>
  );
}