# Time Stemple — GPS Employee Time Tracking

A full-stack web application for GPS-based employee time tracking and workforce management.
Employees clock in and out directly from the browser using their device location.
Administrators manage employees, workplace locations, attendance records, and export reports — all from a real-time dashboard with an interactive map.

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, React Router v6, Axios, Leaflet / react-leaflet, Vite, CSS Modules |
| **Backend** | Python 3.11+, FastAPI, SQLAlchemy 2.0, Uvicorn |
| **Database** | PostgreSQL (production) · SQLite (local / fallback via `USE_SQLITE=1`) |
| **Auth** | JWT Bearer tokens (PyJWT), bcrypt password hashing (passlib) |
| **GPS / Maps** | Browser Geolocation API, Haversine distance formula, OpenStreetMap tiles |

---

## Features

### Employee
- GPS-based **Check-in / Check-out** directly from the browser
- **Geofence enforcement** — the server blocks punches outside the allowed radius: **during an active shift**, only the shift’s workplace counts; otherwise the employee’s **assigned** workplace; if neither is set, any registered location (legacy).
- **Worked-time summary**: total hours, session list (open + closed), active-clock indicator
- **Attendance log**: last 20 punches with timestamp, coordinates, and type
- **Leave (Urlaub)**: request vacation/absence dates (one pending request at a time); dashboard card shows **remaining days** this year (default annual quota via `DEFAULT_ANNUAL_LEAVE_DAYS`, default 30) and approved usage in the Berlin calendar year.
- Automatic redirect to login on token expiry (401 interceptor)

### Admin
- **Employee management**: create, edit (name, email, role, phone, assigned location), activate / deactivate (soft-delete, never hard-delete)
- **Location management**: create, edit, and delete workplace locations with configurable geofence radius — interactive Leaflet map with click-to-place and radius circle preview
- **Attendance overview**: latest 500 punches across all employees
- **Statistics dashboard**: total employees, currently checked-in count, total log entries
- **Reports**: filter by employee and/or date range — download as **CSV** (Excel-compatible with BOM) or view as JSON
- **Leave requests (Urlaubanträge)**: list employee leave requests; **approve** or **reject** (with reason); sidebar badge shows pending count
- Role-based access guard: employees are redirected away from admin routes

---

## Backend API Overview

All endpoints require a `Bearer <token>` header except `/auth/login` and `/auth/register`.

### Auth — `/auth`
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create a new employee account |
| POST | `/auth/login` | Authenticate and receive a JWT |
| GET | `/auth/me` | Return the current user's profile and role |

### Attendance — `/attendance`
| Method | Path | Description |
|---|---|---|
| GET | `/attendance/status` | Current check-in / check-out state + allowed actions |
| POST | `/attendance/checkin` | Record a check-in with GPS coordinates |
| POST | `/attendance/checkout` | Record a check-out with GPS coordinates |
| GET | `/attendance/logs` | Last 20 punches for the current employee |
| GET | `/attendance/worked-time` | Paired sessions and total hours |

### Admin — `/admin` _(admin role required)_
| Method | Path | Description |
|---|---|---|
| GET | `/admin/employees` | List all employees |
| POST | `/admin/employees` | Create a new employee |
| PUT | `/admin/employees/{id}` | Update name, email, role, phone, location, status |
| PATCH | `/admin/employees/{id}/activate` | Activate an employee |
| PATCH | `/admin/employees/{id}/deactivate` | Deactivate an employee |
| GET | `/admin/locations` | List all workplace locations |
| POST | `/admin/locations` | Create a location with geofence radius |
| PUT | `/admin/locations/{id}` | Update a location |
| DELETE | `/admin/locations/{id}` | Remove a location |
| GET | `/admin/attendance` | Latest 500 attendance records across all employees |
| GET | `/admin/statistics` | Aggregated counts (employees, logs, currently active) |
| GET | `/admin/reports/attendance` | Filtered attendance report (JSON) |
| GET | `/admin/reports/attendance.csv` | Filtered attendance report (CSV download) |

### Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | HTTP server liveness check |
| GET | `/health/db` | Database connectivity check |

---

## Frontend Pages

| Route | Page | Access |
|---|---|---|
| `/login` | Login | Public |
| `/register` | Register | Public |
| `/employee/dashboard` | Employee Dashboard | Authenticated |
| `/admin/dashboard` | Admin Dashboard | Admin role only |

---

## Project Structure

```
time-stemple-app/
├── backend/
│   ├── main.py                    # FastAPI app, CORS, DB init, migration
│   ├── requirements.txt
│   ├── .env                       # Not committed — see .env example below
│   ├── app/
│   │   ├── models/
│   │   │   ├── employee.py        # Employee, EmployeeRole
│   │   │   ├── attendance.py      # Attendance (checkin/checkout log)
│   │   │   └── location.py        # WorkplaceLocation (geofence)
│   │   ├── schemas/
│   │   │   ├── auth.py
│   │   │   ├── attendance.py
│   │   │   └── admin.py
│   │   ├── routes/
│   │   │   ├── auth.py
│   │   │   ├── attendance.py
│   │   │   ├── admin.py
│   │   │   ├── employee.py
│   │   │   └── reports.py
│   │   ├── auth/
│   │   │   ├── jwt_tokens.py
│   │   │   ├── passwords.py
│   │   │   ├── deps.py            # get_current_employee
│   │   │   └── admin_deps.py      # require_admin
│   │   ├── config/
│   │   │   ├── database.py        # SQLAlchemy engine, session, URL resolution
│   │   │   └── company_site.py    # Fallback geofence (single fixed point)
│   │   ├── geofence.py            # Multi-location Haversine check
│   │   ├── attendance_rules.py    # Alternate check-in / check-out validation
│   │   └── worked_time.py         # Session pairing, total-hours calculation
│   └── scripts/
│       ├── ensure_admin_user.py   # Create / reset admin account
│       └── check_postgres.py      # Diagnose DB connection issues
└── frontend/
    ├── vite.config.js             # Vite + React plugin, dev proxy to :8000
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx                # Routes, ProtectedRoute, AdminRoute
        ├── apiClient.js           # Axios instance, token helpers, 401 redirect
        ├── authPaths.js
        └── pages/
            ├── Login.jsx / .css
            ├── Register.jsx
            ├── EmployeeDashboard.jsx / .css
            └── AdminDashboard.jsx / .css
```

---

## Installation

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 14+ **or** skip it with `USE_SQLITE=1` (SQLite, no install needed)

### 1 — Clone the repository

```bash
git clone <repo-url>
cd time-stemple-app
```

### 2 — Backend setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 3 — Frontend setup

```bash
cd frontend
npm install
```

---

## Environment Variables (.env)

Create a `.env` file in the **project root** (`time-stemple-app/.env`):

```env
# ── Database ─────────────────────────────────────────────────────────────────
# Option A: PostgreSQL (production)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=yourpassword
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=timestemple

# Option B: SQLite (local dev — no PostgreSQL needed)
# USE_SQLITE=1

# ── JWT ──────────────────────────────────────────────────────────────────────
SECRET_KEY=change-me-to-a-long-random-string
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# ── Frontend (optional) ───────────────────────────────────────────────────────
# VITE_API_BASE=https://api.yourproductiondomain.com
```

> The backend reads `.env` from `backend/` or the project root automatically via `python-dotenv`.

---

## Start Commands

### Backend (FastAPI + Uvicorn)

```bash
cd backend
uvicorn main:app --reload --port 8000
```

API docs available at: `http://localhost:8000/docs`

### Frontend (Vite dev server)

```bash
cd frontend
npm run dev
```

App available at: `http://localhost:5173`

The Vite dev server proxies `/auth`, `/attendance`, `/admin` etc. to `http://localhost:8000`.

### Create the first admin user

```bash
cd backend
python scripts/ensure_admin_user.py
```

---

## Demo Login

After running `ensure_admin_user.py`, log in with:

| Field | Value |
|---|---|
| Email | `khalilnasri@gmail.com` |
| Password | `123456789` |
| Role | Admin |

> This script is idempotent — it resets the password and promotes the account to admin on every run.
> It does **not** affect the PostgreSQL server password.

---

## Current Status

| Area | Status |
|---|---|
| JWT authentication (login, register, role guard) | Done |
| Employee Check-in / Check-out with GPS | Done |
| Geofence validation (multi-location, Haversine) | Done |
| Attendance rule enforcement (alternating check-in/out) | Done |
| Worked-time calculation (session pairing, open sessions) | Done |
| Admin: Employee CRUD + soft-delete | Done |
| Admin: Location management with interactive map | Done |
| Admin: Attendance overview (latest 500 records) | Done |
| Admin: Statistics dashboard | Done |
| Admin: Reports with date filter + CSV export | Done |
| SQLite fallback (local dev without PostgreSQL) | Done |
| Automatic 401 redirect + token handling | Done |

---

## Open / Planned Features

| Feature | Status |
|---|---|
| Shift and roster planning | API stub exists — not implemented |
| Admin settings page | UI tab exists — backend not connected |
| Automated tests (Pytest / Vitest) | Not yet written |
| Docker / docker-compose | Not yet added |
| Email notifications / alerts | Planned |

---

## Portfolio Description

**Time Stemple** is a production-ready full-stack web application demonstrating end-to-end software development across the entire stack:

- **Backend architecture**: RESTful API with FastAPI, dependency injection, JWT auth middleware, Pydantic schemas, SQLAlchemy ORM with automatic DB migration on startup, and dual-database support (PostgreSQL + SQLite).
- **GPS & geofencing**: Browser Geolocation API combined with server-side Haversine distance validation against configurable, database-stored workplace zones — punches outside the allowed perimeter are rejected server-side.
- **Admin tooling**: Full CRUD operations for employees and locations, an interactive Leaflet map with click-to-place and radius circle preview, real-time statistics, and CSV report export with Excel BOM compatibility.
- **Frontend**: React SPA with React Router, role-based route guards, Axios interceptors for automatic token injection and session expiry handling, and a responsive two-panel dashboard layout.
- **Developer experience**: SQLite fallback eliminates the PostgreSQL requirement for local development; a helper script seeds the admin account in one command; `/health/db` provides a clear connection diagnostic endpoint.
