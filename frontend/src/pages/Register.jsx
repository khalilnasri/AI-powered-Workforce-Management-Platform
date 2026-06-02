import axios from "axios";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE, apiClient, getToken } from "../apiClient";
import { dashboardPathForRole } from "../authPaths";
import "./Login.css";

const REGISTER_URL = `${API_BASE}/auth/register`;

export function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await axios.post(REGISTER_URL, {
        name: name.trim(),
        email: email.trim(),
        password,
      });
      navigate("/login", { state: { registered: true } });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.detail) {
        const d = err.response.data.detail;
        if (typeof d === "string") {
          setError(d);
        } else if (Array.isArray(d)) {
          setError(d.map((x) => x.msg || JSON.stringify(x)).join(" "));
        } else {
          setError("Registration failed.");
        }
      } else {
        setError("Cannot reach server. Is the backend running?");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <h1 className="login-title">Register</h1>
        <p className="login-hint">Create your Time Stemple account. Your password is stored securely (hashed) on the server.</p>
        <p className="login-register-note">Der erste registrierte Benutzer wird automatisch Administrator.</p>

        <label className="login-label" htmlFor="reg-name">
          Name
        </label>
        <input
          id="reg-name"
          name="name"
          className="login-input"
          type="text"
          autoComplete="name"
          placeholder="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          required
        />

        <label className="login-label" htmlFor="reg-email">
          Email
        </label>
        <input
          id="reg-email"
          name="email"
          className="login-input"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />

        <label className="login-label" htmlFor="reg-password">
          Password
        </label>
        <input
          id="reg-password"
          name="password"
          className="login-input"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          minLength={8}
          required
        />

        <button className="login-button" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Register"}
        </button>

        {error ? (
          <p className="login-error" role="alert">
            {error}
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
