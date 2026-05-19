"""
Prüft die Datenbank-Verbindung (PostgreSQL oder SQLite).

Ausführen im Ordner backend:
  python scripts/check_postgres.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_REPO = _BACKEND.parent

try:
    from dotenv import load_dotenv

    loaded = []
    for env_path in (_BACKEND / ".env", _REPO / ".env"):
        if env_path.is_file():
            load_dotenv(env_path, override=True, encoding="utf-8")
            loaded.append(str(env_path))
    if loaded:
        print("Geladene .env-Dateien:")
        for p in loaded:
            print(f"  - {p}")
    else:
        print(f"Keine .env gefunden unter:\n  {_BACKEND / '.env'}\n  {_REPO / '.env'}")
except ImportError:
    print("python-dotenv fehlt: pip install python-dotenv")

sys.path.insert(0, str(_BACKEND))

db_url = (os.getenv("DATABASE_URL") or "").strip()
use_sqlite = (os.getenv("USE_SQLITE") or "").strip().lower() in ("1", "true", "yes")
print(f"USE_SQLITE: {use_sqlite}")
print(f"DATABASE_URL gesetzt: {bool(db_url)}")
if db_url.lower().startswith("sqlite"):
    print("Modus: SQLite (aus DATABASE_URL)")
elif use_sqlite:
    print("Modus: SQLite (USE_SQLITE=1)")
elif not db_url:
    pw = os.getenv("POSTGRES_PASSWORD")
    print(f"Modus: PostgreSQL (POSTGRES_*)")
    print(f"POSTGRES_USER: {os.getenv('POSTGRES_USER', 'postgres')!r}")
    print(f"POSTGRES_PASSWORD: {'(leer)' if not pw else '(gesetzt, ' + str(len(pw)) + ' Zeichen)'}")
    print(f"POSTGRES_HOST: {os.getenv('POSTGRES_HOST', 'localhost')!r}")
    print(f"POSTGRES_DB: {os.getenv('POSTGRES_DB', 'timestemple')!r}")

from sqlalchemy import text

from app.config.database import DATABASE_URL, IS_SQLITE, engine

print(f"\nAktive URL beginnt mit: {DATABASE_URL.split(':', 1)[0]}")

print("\nVerbindungsversuch …")
try:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print("OK: Datenbank erreichbar.")
except Exception as e:
    print(f"FEHLGESCHLAGEN: {e}")
    if IS_SQLITE:
        print(
            "\nSQLite: Ordner backend/data beschreibbar? Pfad in DATABASE_URL korrekt?\n"
            "  Standard bei USE_SQLITE=1: backend/data/timestemple_local.db",
        )
    else:
        print(
            "\nPostgreSQL:\n"
            "  1) Passwort in .env = Passwort des Users postgres in diesem Server.\n"
            "  2) Oder lokal ohne Passwort-Stress: in .env USE_SQLITE=1 setzen (siehe .env.example).\n"
            "  3) DATABASE_URL in Windows-Systemumgebung prüfen.",
        )
    sys.exit(1)
