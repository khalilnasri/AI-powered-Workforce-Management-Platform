"""Wiederverwendbare Auth-Validierung mit deutschen Fehlermeldungen."""

from __future__ import annotations

import re

from fastapi import HTTPException, status

from app.auth.password_policy import format_password_error, password_missing_rules

INVALID_EMAIL_MSG = "Bitte gib eine gültige E-Mail-Adresse ein."

# Pragmatisches E-Mail-Format (kein Over-Engineering)
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?"
    r"@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?"
    r"\.[a-zA-Z]{2,}$"
)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_valid_email(email: str) -> bool:
    normalized = normalize_email(email)
    if not normalized or len(normalized) > 254:
        return False
    return _EMAIL_RE.match(normalized) is not None


def validate_email_or_raise(email: str) -> str:
    normalized = normalize_email(email)
    if not is_valid_email(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=INVALID_EMAIL_MSG,
        )
    return normalized


def validate_name_or_raise(name: str) -> str:
    stripped = name.strip()
    if not stripped:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name darf nicht leer sein.",
        )
    if len(stripped) > 255:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name darf maximal 255 Zeichen lang sein.",
        )
    return stripped


def validate_password_or_raise(password: str) -> None:
    if not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwort darf nicht leer sein.",
        )
    if len(password) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwort darf maximal 128 Zeichen lang sein.",
        )
    missing = password_missing_rules(password)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=format_password_error(missing),
        )
