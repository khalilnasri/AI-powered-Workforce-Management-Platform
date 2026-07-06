"""
Systematischer Auth-Test: Register + Login Kombinationen gegen lokal laufendes Backend.
Ausführen: python scripts/test_auth_combinations.py
"""
from __future__ import annotations

import json
import sys
import time
import uuid

import requests

BASE = "http://127.0.0.1:8000"
SESSION = requests.Session()
RESULTS: list[dict] = []


def api(method: str, path: str, **kwargs) -> requests.Response:
    url = f"{BASE}{path}"
    return SESSION.request(method, url, timeout=10, **kwargs)


def record(category: str, case: str, expected: str, resp: requests.Response | None, note: str = ""):
    detail = None
    status = None
    if resp is not None:
        status = resp.status_code
        try:
            detail = resp.json().get("detail")
        except Exception:
            detail = resp.text[:200]
    ok = note.startswith("OK") if note else False
    RESULTS.append({
        "category": category,
        "case": case,
        "expected": expected,
        "status": status,
        "detail": detail,
        "note": note,
        "ok": ok or (expected in str(status) and detail is not None),
    })


def main() -> int:
    # Health
    try:
        h = api("GET", "/health")
        if h.status_code != 200:
            print("Backend nicht erreichbar auf", BASE)
            return 1
    except requests.RequestException as e:
        print(f"Backend nicht erreichbar: {e}")
        return 1

    uid = uuid.uuid4().hex[:8]
    valid_email = f"authtest_{uid}@example.com"
    valid_password = "TestPass1!"
    valid_name = "Auth Test User"

    print("=== REGISTER TESTS ===\n")

    # Empty name
    r = api("POST", "/auth/register", json={"name": "   ", "email": valid_email, "password": valid_password})
    record("Register", "Leerer Name (nur Spaces)", "400", r, "OK" if r.status_code == 400 else "FAIL")

    # Invalid emails
    for bad_email in ["", "   ", "not-an-email", "a@b", "test@", "@test.com", "test..x@y.com"]:
        r = api("POST", "/auth/register", json={"name": valid_name, "email": bad_email, "password": valid_password})
        record("Register", f"Ungültige E-Mail: {bad_email!r}", "400", r, "OK" if r.status_code == 400 else "FAIL")

    # Weak passwords
    weak_cases = [
        ("", "leer"),
        ("short1!", "zu kurz"),
        ("abcdefgh", "kein Großbuchstabe/Zahl/Sonderzeichen"),
        ("ABCDEFGH1!", "kein Kleinbuchstabe"),
        ("Abcdefgh!", "keine Zahl"),
        ("Abcdefg1", "kein Sonderzeichen"),
        ("Ab1!", "nur 4 Zeichen"),
    ]
    for pw, label in weak_cases:
        email = f"weak_{uuid.uuid4().hex[:6]}@example.com"
        r = api("POST", "/auth/register", json={"name": valid_name, "email": email, "password": pw})
        record("Register", f"Schwaches Passwort ({label})", "400", r, "OK" if r.status_code == 400 else "FAIL")

    # Valid registration
    r = api("POST", "/auth/register", json={"name": valid_name, "email": valid_email, "password": valid_password})
    record("Register", "Gültige Registrierung", "201", r, "OK" if r.status_code == 201 else "FAIL")

    # Duplicate email
    r = api("POST", "/auth/register", json={"name": "Other", "email": valid_email, "password": valid_password})
    record("Register", "Doppelte E-Mail", "409", r, "OK" if r.status_code == 409 else "FAIL")

    # Case insensitive email duplicate
    r = api("POST", "/auth/register", json={"name": "Other", "email": valid_email.upper(), "password": valid_password})
    record("Register", "Doppelte E-Mail (Großbuchstaben)", "409", r, "OK" if r.status_code == 409 else "FAIL")

    # Email whitespace normalization
    r2 = api("POST", "/auth/register", json={"name": valid_name, "email": f"  {valid_email}  ", "password": valid_password})
    record("Register", "Whitespace E-Mail (Duplikat)", "409", r2, "OK" if r2.status_code == 409 else "FAIL")

    print("=== LOGIN TESTS ===\n")

    # Empty / invalid login
    r = api("POST", "/auth/login", json={"email": "", "password": valid_password})
    record("Login", "Leere E-Mail", "400", r, "OK" if r.status_code == 400 else "FAIL")

    r = api("POST", "/auth/login", json={"email": "not-valid", "password": valid_password})
    record("Login", "Ungültiges E-Mail-Format", "400", r, "OK" if r.status_code == 400 else "FAIL")

    r = api("POST", "/auth/login", json={"email": valid_email, "password": ""})
    record("Login", "Leeres Passwort", "400/422", r, "OK" if r.status_code in (400, 422) else "FAIL")

    r = api("POST", "/auth/login", json={"email": "nobody@example.com", "password": valid_password})
    record("Login", "Unbekannte E-Mail", "401", r, "OK" if r.status_code == 401 else "FAIL")

    r = api("POST", "/auth/login", json={"email": valid_email, "password": "WrongPass1!"})
    record("Login", "Falsches Passwort", "401", r, "OK" if r.status_code == 401 else "FAIL")

    # Valid login
    r = api("POST", "/auth/login", json={"email": valid_email, "password": valid_password})
    token = None
    role = None
    if r.status_code == 200:
        data = r.json()
        token = data.get("access_token")
        role = data.get("role")
        has_role_in_jwt = False
        if token:
            import jwt as pyjwt
            import os
            secret = os.getenv("JWT_SECRET_KEY", "dev-only-change-with-env-JWT_SECRET_KEY")
            payload = pyjwt.decode(token, secret, algorithms=["HS256"])
            has_role_in_jwt = "role" in payload and "sub" in payload
        record("Login", "Gültiger Login", "200 + Token + role", r, f"OK role={role} jwt_fields={has_role_in_jwt}")
    else:
        record("Login", "Gültiger Login", "200", r, "FAIL")

    # Login with email case variation
    r = api("POST", "/auth/login", json={"email": valid_email.upper(), "password": valid_password})
    record("Login", "E-Mail Großbuchstaben", "200", r, "OK" if r.status_code == 200 else "FAIL")

    # /auth/me with token
    if token:
        r = api("GET", "/auth/me", headers={"Authorization": f"Bearer {token}"})
        record("Auth", "/auth/me mit gültigem Token", "200", r, "OK" if r.status_code == 200 else "FAIL")

        r = api("GET", "/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
        record("Auth", "/auth/me mit ungültigem Token", "401", r, "OK" if r.status_code == 401 else "FAIL")

    # Deactivated user test - find admin and try deactivate test user if possible
    print("=== DEACTIVATED USER (wenn Admin-Token vorhanden) ===\n")
    admin_login = api("POST", "/auth/login", json={"email": "khalilnasri@gmail.com", "password": "123456789"})
    if admin_login.status_code == 200:
        admin_token = admin_login.json().get("access_token")
        # create temp user to deactivate
        tmp_email = f"deact_{uid}@example.com"
        cr = api("POST", "/auth/register", json={"name": "Deact Test", "email": tmp_email, "password": valid_password})
        if cr.status_code == 201:
            emp_id = cr.json().get("id")
            deact = api(
                "PATCH",
                f"/admin/employees/{emp_id}/deactivate",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            if deact.status_code == 200:
                lr = api("POST", "/auth/login", json={"email": tmp_email, "password": valid_password})
                record("Login", "Deaktivierter User", "403", lr, "OK" if lr.status_code == 403 else "FAIL")
                # reactivate cleanup
                api("PATCH", f"/admin/employees/{emp_id}/activate", headers={"Authorization": f"Bearer {admin_token}"})
            else:
                record("Login", "Deaktivierter User", "403", None, f"SKIP deactivate failed {deact.status_code}")
        else:
            record("Login", "Deaktivierter User", "403", None, "SKIP could not create temp user")
    else:
        record("Login", "Deaktivierter User", "403", admin_login, "SKIP admin login failed (Demo-User fehlt?)")

    # Print summary
    print("\n" + "=" * 72)
    print(f"{'Kategorie':<12} {'Fall':<40} {'Status':<8} Ergebnis")
    print("=" * 72)
    passed = 0
    failed = 0
    skipped = 0
    for row in RESULTS:
        st = row["status"] if row["status"] is not None else "—"
        note = row["note"]
        if note.startswith("OK"):
            passed += 1
            mark = "OK"
        elif note.startswith("SKIP"):
            skipped += 1
            mark = "SKIP"
        else:
            failed += 1
            mark = "FAIL"
        detail = row["detail"]
        if isinstance(detail, str) and len(detail) > 60:
            detail = detail[:57] + "..."
        print(f"{mark} {row['category']:<10} {row['case']:<40} {st!s:<8} {note}")
        if detail and mark == "✗":
            print(f"             → {detail}")

    print("=" * 72)
    print(f"Bestanden: {passed} | Fehlgeschlagen: {failed} | Übersprungen: {skipped} | Gesamt: {len(RESULTS)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
