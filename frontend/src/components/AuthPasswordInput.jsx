import { useState } from "react";

const VARIANTS = {
  default: {
    field: "login-field",
    label: "login-label",
    wrap: "login-password-wrap",
    input: "login-input login-input--password",
    invalid: "login-input--invalid",
    toggle: "login-password-toggle",
    hint: "login-field-hint",
    error: "login-field-error",
  },
  nela: {
    field: "nela-field",
    label: "nela-label",
    wrap: "nela-input-wrap",
    input: "nela-input nela-input--password",
    invalid: "nela-input--invalid",
    toggle: "nela-eye-toggle",
    hint: "nela-field-hint",
    error: "nela-field-error",
  },
};

export function AuthPasswordInput({
  id,
  name,
  label,
  value,
  onChange,
  error,
  disabled,
  autoComplete,
  placeholder,
  hint,
  variant = "default",
  renderLabel,
}) {
  const [visible, setVisible] = useState(false);
  const errorId = error ? `${id}-error` : undefined;
  const c = VARIANTS[variant] ?? VARIANTS.default;

  return (
    <div className={`${c.field}${error ? ` ${c.field}--error` : ""}`}>
      {renderLabel ? (
        renderLabel(id)
      ) : (
        <label className={c.label} htmlFor={id}>
          {label}
        </label>
      )}
      <div className={c.wrap}>
        <input
          id={id}
          name={name}
          className={`${c.input}${error ? ` ${c.invalid}` : ""}`}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
        />
        <button
          type="button"
          className={c.toggle}
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
          tabIndex={-1}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {hint ? <p className={c.hint}>{hint}</p> : null}
      {error ? (
        <p id={errorId} className={c.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
