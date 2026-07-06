"""Passwort-Stärke-Regeln (Backend + konsistente Fehlermeldungen)."""

from __future__ import annotations

import re

MIN_PASSWORD_LENGTH = 8

_SPECIAL_RE = re.compile(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?`~]")


def password_missing_rules(password: str) -> list[str]:
    """Gibt fehlende Regeln als deutsche Kurzbeschreibungen zurück."""
    missing: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        missing.append(f"mindestens {MIN_PASSWORD_LENGTH} Zeichen")
    if not re.search(r"[A-Z]", password):
        missing.append("ein Großbuchstabe")
    if not re.search(r"[a-z]", password):
        missing.append("ein Kleinbuchstabe")
    if not re.search(r"\d", password):
        missing.append("eine Zahl")
    if not _SPECIAL_RE.search(password):
        missing.append("ein Sonderzeichen")
    return missing


def format_password_error(missing: list[str]) -> str:
    if not missing:
        return ""
    if len(missing) == 1:
        return f"Das Passwort muss {missing[0]} enthalten."
    return f"Das Passwort muss {', '.join(missing[:-1])} und {missing[-1]} enthalten."


def is_password_strong(password: str) -> bool:
    return len(password_missing_rules(password)) == 0
