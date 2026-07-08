import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

from app.config.database import IS_SQLITE, engine, init_db
from app.routes import admin as admin_routes
from app.routes import attendance as attendance_routes
from app.routes import auth as auth_routes
from app.routes import employee as employee_routes
from app.routes import invite_codes as invite_codes_routes
from app.routes import approvals as approvals_routes
from app.routes import leave_admin as leave_admin_routes
from app.routes import planning as planning_routes
from app.routes import reports as reports_routes
from app.routes import ai as ai_routes
from app.routes import notifications as notifications_routes
from app.routes import employee_notifications as employee_notifications_routes

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.models  # noqa: F401 — register models on Base before creating tables
    import app.models.app_setting  # noqa: F401

    try:
        init_db()
        _migrate_db()
    except Exception:
        logger.exception(
            "Database init failed — running without migrated tables. "
            "Ensure PostgreSQL is up; credentials can be set via DATABASE_URL or "
            "POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB. "
            "On Windows, prefer split POSTGRES_* vars so passwords with ü etc. are encoded reliably."
        )
    yield


def _migrate_db() -> None:
    """
    Fügt neue Spalten zur employees-Tabelle hinzu (idempotent).

    ``ADD COLUMN IF NOT EXISTS`` braucht SQLite 3.35+; ältere Python-/SQLite-Bundles
    werfen sonst einen Syntaxfehler. Spalten per Inspector prüfen und nur bei Bedarf
    ALTER ausführen — funktioniert für PostgreSQL und SQLite.
    """
    insp = inspect(engine)
    if not insp.has_table("employees"):
        return
    existing = {c["name"] for c in insp.get_columns("employees")}
    with engine.begin() as conn:
        if "is_active" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE employees ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE"
                )
            )
        if "phone" not in existing:
            conn.execute(text("ALTER TABLE employees ADD COLUMN phone VARCHAR(50)"))
        if "assigned_location_id" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE employees ADD COLUMN assigned_location_id INTEGER "
                    "REFERENCES locations(id) ON DELETE SET NULL"
                )
            )
        if "annual_leave_days" not in existing:
            conn.execute(text("ALTER TABLE employees ADD COLUMN annual_leave_days INTEGER"))
        if "employment_type" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE employees ADD COLUMN employment_type VARCHAR(30) "
                    "NOT NULL DEFAULT 'full_time'"
                )
            )
        if "target_hours_month" not in existing:
            conn.execute(text("ALTER TABLE employees ADD COLUMN target_hours_month INTEGER"))

    insp2 = inspect(engine)
    if not insp2.has_table("app_settings"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE app_settings (
                        key        VARCHAR(100) PRIMARY KEY,
                        value      VARCHAR(1000),
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                    if IS_SQLITE
                    else """
                    CREATE TABLE app_settings (
                        key        VARCHAR(100) PRIMARY KEY,
                        value      VARCHAR(1000),
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                    """
                )
            )

    if (
        insp2.has_table("employees")
        and insp2.has_table("locations")
        and not insp2.has_table("employee_work_locations")
    ):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE employee_work_locations (
                        employee_id INTEGER NOT NULL,
                        location_id INTEGER NOT NULL,
                        PRIMARY KEY (employee_id, location_id),
                        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                        FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
                    )
                    """
                )
            )
            if IS_SQLITE:
                conn.execute(
                    text(
                        """
                        INSERT OR IGNORE INTO employee_work_locations (employee_id, location_id)
                        SELECT id, assigned_location_id FROM employees
                        WHERE assigned_location_id IS NOT NULL
                        """
                    )
                )
            else:
                conn.execute(
                    text(
                        """
                        INSERT INTO employee_work_locations (employee_id, location_id)
                        SELECT id, assigned_location_id FROM employees
                        WHERE assigned_location_id IS NOT NULL
                        ON CONFLICT (employee_id, location_id) DO NOTHING
                        """
                    )
                )

    insp3 = inspect(engine)
    if not insp3.has_table("invite_codes"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE invite_codes (
                        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
                        code                   VARCHAR(16) NOT NULL UNIQUE,
                        created_by_employee_id INTEGER NOT NULL REFERENCES employees(id),
                        created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        used_at                TIMESTAMP,
                        used_by_employee_id    INTEGER REFERENCES employees(id)
                    )
                    """
                    if IS_SQLITE
                    else """
                    CREATE TABLE invite_codes (
                        id                     SERIAL PRIMARY KEY,
                        code                   VARCHAR(16) NOT NULL UNIQUE,
                        created_by_employee_id INTEGER NOT NULL REFERENCES employees(id),
                        created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                        used_at                TIMESTAMP WITH TIME ZONE,
                        used_by_employee_id    INTEGER REFERENCES employees(id)
                    )
                    """
                )
            )

    insp4 = inspect(engine)
    if not insp4.has_table("notifications"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE notifications (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                        type        VARCHAR(50) NOT NULL,
                        title       VARCHAR(200) NOT NULL,
                        body        VARCHAR(1000),
                        entity_type VARCHAR(30),
                        entity_id   INTEGER,
                        actor_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
                        read_at     TIMESTAMP,
                        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
                    )
                    """
                    if IS_SQLITE
                    else """
                    CREATE TABLE notifications (
                        id          SERIAL PRIMARY KEY,
                        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                        type        VARCHAR(50) NOT NULL,
                        title       VARCHAR(200) NOT NULL,
                        body        VARCHAR(1000),
                        entity_type VARCHAR(30),
                        entity_id   INTEGER,
                        actor_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
                        read_at     TIMESTAMP WITH TIME ZONE,
                        created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX ix_notifications_employee_read "
                    "ON notifications (employee_id, read_at)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX ix_notifications_employee_created "
                    "ON notifications (employee_id, created_at)"
                )
            )
    elif not IS_SQLITE and insp4.has_table("notifications"):
        notif_cols = {c["name"]: c for c in insp4.get_columns("notifications")}
        body_col = notif_cols.get("body")
        if body_col is not None:
            body_len = getattr(body_col["type"], "length", None)
            if body_len is not None and body_len < 1000:
                with engine.begin() as conn:
                    conn.execute(
                        text("ALTER TABLE notifications ALTER COLUMN body TYPE VARCHAR(1000)")
                    )


app = FastAPI(lifespan=lifespan)


@app.exception_handler(OperationalError)
def database_operational_error_handler(request, exc: OperationalError):
    """Clear API response when Postgres password/host is wrong (instead of opaque 500)."""
    logger.warning("Database unavailable: %s", exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "Keine Verbindung zur Datenbank. "
                "Lokal ohne PostgreSQL: in .env USE_SQLITE=1 setzen und Server neu starten. "
                "Mit PostgreSQL: POSTGRES_PASSWORD prüfen. Hilfe: python scripts/check_postgres.py"
            ),
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://app.work-track.de",

        "https://ai-powered-workforce-management-pla.vercel.app",
        "https://ai-powered-workforce-management-platform-5jne5x0ax.vercel.app",
	
        
        "https://ai-powered-workforce-management-platform-33xn9jbdk.vercel.app",
        "https://ai-powered-workforce-management-git-3ac484-khalil-zeit-management.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_routes.router)
app.include_router(invite_codes_routes.router)
app.include_router(leave_admin_routes.router)
app.include_router(approvals_routes.router)
app.include_router(reports_routes.router)
app.include_router(auth_routes.router)
app.include_router(attendance_routes.router)
app.include_router(employee_routes.router)
app.include_router(planning_routes.router)
app.include_router(ai_routes.router)
app.include_router(notifications_routes.router)
app.include_router(employee_notifications_routes.router)


@app.get("/")
def read_root():
    return {"message": "Time Stemple Backend Running"}


@app.get("/health")
def health():
    """Läuft der HTTP-Server — ohne Datenbank."""
    return {"status": "ok", "service": "time-stemple-api"}


@app.get("/health/db")
def health_db():
    """Prüft eine echte DB-Verbindung (hilft bei Login-Problemen)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        payload: dict = {"status": "ok", "database": "connected"}
        if IS_SQLITE:
            payload["engine"] = "sqlite"
        return payload
    except OperationalError as e:
        logger.warning("health/db failed: %s", e)
        hint = (
            "SQLite-Datei prüfen (Schreibrechte im Ordner backend/data)."
            if IS_SQLITE
            else "POSTGRES_PASSWORD in time-stemple-app/.env muss mit Postgres-User übereinstimmen. "
            "Lokal ohne Postgres: USE_SQLITE=1 in .env setzen."
        )
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": "disconnected",
                "hint": hint,
            },
        )
