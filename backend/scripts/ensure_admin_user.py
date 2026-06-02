"""
Create or update an admin user (bcrypt password, role admin).

Run from the backend folder:
  python scripts/ensure_admin_user.py

Loads .env from the project root (time-stemple-app/.env) BEFORE connecting — same
variables as the FastAPI app (POSTGRES_* or DATABASE_URL).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# --- load env first (before app.config.database builds DATABASE_URL) ---
_BACKEND = Path(__file__).resolve().parent.parent
_REPO = _BACKEND.parent

try:
    from dotenv import load_dotenv

    for env_path in (_BACKEND / ".env", _REPO / ".env"):
        if env_path.is_file():
            load_dotenv(env_path, override=True, encoding="utf-8")
except ImportError:
    print("Hinweis: pip install python-dotenv  (damit .env automatisch geladen wird)")

sys.path.insert(0, str(_BACKEND))

from sqlalchemy import func, select

from app.auth.passwords import hash_password
from app.config.database import SessionLocal, init_db
from app.models.employee import Employee, EmployeeRole
import app.models  # noqa: F401 — register all models before create_all

# --- App-Login (employees-Tabelle), nicht PostgreSQL-Passwort ---
EMAIL = "khalilnasri@gmail.com"
PASSWORD = "123456789"
DISPLAY_NAME = "Khalil Nasri"


def main() -> None:
    init_db()  # Tabellen anlegen falls noch nicht vorhanden
    email_norm = EMAIL.strip().lower()
    db = SessionLocal()
    try:
        emp = db.scalars(select(Employee).where(func.lower(Employee.email) == email_norm)).first()
        pw_hash = hash_password(PASSWORD)
        if emp:
            emp.name = emp.name or DISPLAY_NAME
            emp.password = pw_hash
            emp.role = EmployeeRole.admin
            print(f"Aktualisiert: Nutzer id={emp.id} -> admin, Passwort neu gesetzt.")
        else:
            emp = Employee(
                name=DISPLAY_NAME,
                email=email_norm,
                password=pw_hash,
                role=EmployeeRole.admin,
            )
            db.add(emp)
            print(f"Neu angelegt: Admin {email_norm}")
        db.commit()
        print("Fertig. Anmeldung im Browser: /login mit dieser E-Mail und diesem Passwort (nicht POSTGRES_PASSWORD).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
