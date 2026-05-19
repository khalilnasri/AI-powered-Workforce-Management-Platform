import os
from collections.abc import Generator
from pathlib import Path
from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker


def _load_env_files() -> None:
    """
    Load .env from backend/, then project root (later file wins).

    Uses override=True so values from .env win over stale shell variables
    (e.g. old POSTGRES_PASSWORD in PowerShell) — project config is source of truth.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    backend_root = Path(__file__).resolve().parents[2]
    repo_root = Path(__file__).resolve().parents[3]
    for path in (backend_root / ".env", repo_root / ".env"):
        if path.is_file():
            load_dotenv(path, override=True, encoding="utf-8")


_load_env_files()

# Tell libpq to prefer UTF-8 before first connect.
os.environ.setdefault("PGCLIENTENCODING", "UTF8")


def _clean_pg_var(value: str | None, default: str) -> str:
    """Strip whitespace and optional surrounding quotes from .env values."""
    if value is None:
        return default
    s = value.strip()
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        s = s[1:-1].strip()
    return s if s else default


def _postgres_password() -> str:
    """
    Password for PostgreSQL URL.

    - If ``POSTGRES_PASSWORD`` is **missing** from the environment → default ``postgres``
      (backward compatible).
    - If it is **set** (even to empty, e.g. ``POSTGRES_PASSWORD=`` in ``.env``) → use that
      value after trim/quotes — empty string means *no password* (needs ``trust`` in
      ``pg_hba.conf`` for local connections).
    """
    raw = os.getenv("POSTGRES_PASSWORD")
    if raw is None:
        return "postgres"
    s = raw.strip()
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        s = s[1:-1].strip()
    return s


def _sqlite_default_url() -> str:
    """File-based SQLite under backend/data/ — no PostgreSQL password needed."""
    backend_root = Path(__file__).resolve().parents[2]
    data_dir = backend_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "timestemple_local.db"
    return "sqlite:///" + str(db_path.resolve()).replace("\\", "/")


def resolve_database_url() -> str:
    """
    Database URL resolution order:

    1) DATABASE_URL starting with ``sqlite`` → SQLite (local file, no Postgres).
    2) USE_SQLITE=1 / true / yes → SQLite file at backend/data/timestemple_local.db
    3) DATABASE_URL (postgresql) → use as configured.
    4) Else build URL from POSTGRES_* (password optional: empty ``POSTGRES_PASSWORD=``
       needs PostgreSQL ``trust`` for local — see .env.example).
    """
    raw = (os.getenv("DATABASE_URL") or "").strip().lstrip("\ufeff")
    use_sqlite_flag = (os.getenv("USE_SQLITE") or "").strip().lower() in ("1", "true", "yes")

    if raw.lower().startswith("sqlite"):
        return raw

    if use_sqlite_flag:
        return _sqlite_default_url()

    if raw:
        url = raw
        if url.startswith("postgresql+psycopg2://"):
            url = "postgresql+psycopg://" + url.removeprefix("postgresql+psycopg2://")
        elif url.startswith("postgresql://") and "+" not in url.split(":", 1)[0]:
            url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
        return url

    user = _clean_pg_var(os.getenv("POSTGRES_USER"), "postgres")
    password = _postgres_password()
    host = _clean_pg_var(os.getenv("POSTGRES_HOST"), "localhost")
    port = _clean_pg_var(os.getenv("POSTGRES_PORT"), "5432")
    db = _clean_pg_var(os.getenv("POSTGRES_DB"), "timestemple")
    if password == "":
        auth = f"{quote_plus(user)}:"
    else:
        auth = f"{quote_plus(user)}:{quote_plus(password)}"
    return f"postgresql+psycopg://{auth}@{host}:{port}/{db}"


DATABASE_URL = resolve_database_url()
IS_SQLITE = DATABASE_URL.lower().startswith("sqlite")

_connect_args: dict[str, str | bool] = {}
if IS_SQLITE:
    # FastAPI runs sync code in a thread pool; SQLite needs this for cross-thread use.
    _connect_args = {"check_same_thread": False}
else:
    _connect_args = {
        "options": "-c client_encoding=UTF8 -c lc_messages=C",
    }

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables for all models that inherit from Base (import models first)."""
    Base.metadata.create_all(bind=engine)
