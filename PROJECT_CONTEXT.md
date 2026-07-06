# Time Stemple — Vollständige Projektbeschreibung für KI-Assistenten

> Dieses Dokument beschreibt die gesamte Architektur, alle Modelle, Routen, Frontend-Seiten
> und Geschäftslogik der **Time Stemple**-Applikation. Ziel: ein KI-Assistent (z.B. ChatGPT)
> soll das Projekt vollständig verstehen, ohne den Code zu sehen.

---

## 1. Projektziel

**Time Stemple** ist ein webbasiertes **Workforce-Management-System** für Unternehmen.
Mitarbeiter können sich per GPS ein- und ausstempeln. Admins verwalten Standorte,
Mitarbeiter, Schichtpläne, Urlaubsanträge, Arbeitsstunden-Genehmigungen und Reports.

**Produktions-URLs:**
- Frontend: `https://app.work-track.de`
- Backend-API: `https://api.work-track.de`
- Lokale Entwicklung: Frontend `http://localhost:5173`, Backend `http://localhost:8000`

---

## 2. Tech-Stack

| Schicht | Technologie |
|---|---|
| Backend | Python 3.11+, FastAPI, SQLAlchemy ORM |
| Datenbank | PostgreSQL (Produktion) / SQLite (lokal via `USE_SQLITE=1`) |
| Auth | JWT (Bearer Token, HS256), bcrypt für Passwörter |
| Frontend | React 18, Vite, React Router v6, Axios |
| Charts | Recharts |
| Karten (GPS-Overlay) | Leaflet + react-leaflet |
| Deployment | Backend: Hetzner VPS (uvicorn), Frontend: Vercel |
| Entwicklung | `npm run dev:all` startet beide Server gleichzeitig via `concurrently` |

---

## 3. Verzeichnisstruktur

```
time-stemple-app/
├── backend/
│   ├── main.py                    ← FastAPI App-Einstiegspunkt, Router-Registration, CORS, DB-Migration
│   ├── app/
│   │   ├── models/                ← SQLAlchemy ORM-Modelle (eine Datei pro Tabelle)
│   │   ├── routes/                ← FastAPI Router (eine Datei pro Feature-Bereich)
│   │   ├── schemas/               ← Pydantic Request/Response-Schemas
│   │   ├── services/              ← Business-Logik (Email, Urlaub, Stunden-Statistik, KI)
│   │   ├── auth/                  ← JWT-Tokens, Abhängigkeiten (deps), Passwort-Policy
│   │   ├── config/                ← Datenbankverbindung, company_site.py (Fallback-GPS)
│   │   ├── geofence.py            ← GPS-Geofencing-Logik
│   │   ├── worked_time.py         ← Berechnung der gearbeiteten Stunden pro Mitarbeiter
│   │   └── attendance_rules.py    ← Regeln: wann kann ein- / ausgecheckt werden?
│   └── scripts/                   ← Hilfsskripte (Admin anlegen, DB prüfen, Tests)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                ← Routing (/, /login, /register, /employee/dashboard, /admin/dashboard)
│   │   ├── apiClient.js           ← Axios-Instanz mit JWT-Interceptor, Token-Verwaltung
│   │   ├── pages/
│   │   │   ├── Login.jsx          ← Login-Formular
│   │   │   ├── Register.jsx       ← Registrierung (nur möglich wenn Admin aktiviert)
│   │   │   ├── EmployeeDashboard.jsx      ← Desktop-Mitarbeiter-Dashboard (>640px)
│   │   │   ├── MobileEmployeeDashboard.jsx ← Mobile-Mitarbeiter-Dashboard (≤640px)
│   │   │   └── AdminDashboard.jsx ← Komplettes Admin-Panel
│   │   ├── components/
│   │   │   └── AuthPasswordInput.jsx ← Passwort-Eingabe mit Stärke-Anzeige
│   │   └── utils/
│   │       └── authValidation.js  ← Passwort-Validierungs-Logik
│   └── vite.config.ts             ← Proxy `/api` → Backend, Build-Config
├── package.json                   ← Root: `dev:all` Skript (concurrently)
└── vercel.json                    ← Vercel Routing-Konfiguration
```

---

## 4. Datenbankmodelle

### 4.1 `employees` — Mitarbeiter / Admins

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | Integer PK | |
| `name` | String(255) | Vollständiger Name |
| `email` | String(255) UNIQUE | Login-E-Mail |
| `password` | String(255) | bcrypt-Hash |
| `role` | Enum | `employee` oder `admin` |
| `is_active` | Boolean | Soft-Delete (nie wirklich löschen) |
| `phone` | String(50) nullable | Telefon |
| `assigned_location_id` | FK → locations | Legacy: ein Standort |
| `annual_leave_days` | Integer nullable | Urlaubstage/Jahr (NULL = System-Standard 28) |
| `employment_type` | String(30) | `full_time` / `part_time_80` / `part_time_120` / `minijob` |
| `target_hours_month` | Integer nullable | Nur für Minijob: Soll-Stunden/Monat |

### 4.2 `attendance_logs` — Rohe Stempel-Ereignisse

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | Integer PK | |
| `employee_id` | FK → employees | |
| `log_type` | String(50) | `checkin` oder `checkout` |
| `lat` | Float | GPS-Breitengrad |
| `lng` | Float | GPS-Längengrad |
| `created_at` | DateTime TZ | UTC-Zeitstempel |

### 4.3 `work_sessions` — Geprüfte Arbeitssitzungen

Wird automatisch beim Checkout erstellt. Enthält die offizielle Arbeitszeit.

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | Integer PK | |
| `employee_id` | FK → employees CASCADE | |
| `checkin_log_id` | FK → attendance_logs SET NULL | |
| `checkout_log_id` | FK → attendance_logs SET NULL | |
| `checkin_time` | DateTime TZ | |
| `checkout_time` | DateTime TZ nullable | NULL = Session noch offen |
| `duration_seconds` | Integer | Offizielle Dauer |
| `status` | String(20) | `pending` / `approved` / `rejected` / `corrected` |
| `approved_by_id` | FK → employees SET NULL | Admin der genehmigt hat |
| `approved_at` | DateTime TZ nullable | |
| `rejection_reason` | String(1000) nullable | |
| `admin_note` | String(1000) nullable | Bei Korrektur |
| `created_at` / `updated_at` | DateTime TZ | |

### 4.4 `locations` — Arbeitsstandorte

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | Integer PK | |
| `name` | String(255) | z.B. "Mercure City Hamburg" |
| `address` | String(512) | Adresse |
| `lat` / `lng` | Float | GPS-Mittelpunkt |
| `radius_meters` | Float | Erlaubter Radius (Standard 200m) |
| `created_at` | DateTime TZ | |

### 4.5 `employee_work_locations` — M2M: Mitarbeiter ↔ Standorte

| Spalte | Typ | Beschreibung |
|---|---|---|
| `employee_id` | FK PK | |
| `location_id` | FK PK | |

Ein Mitarbeiter kann mehreren Standorten zugeordnet sein. Das Geofencing erlaubt
den Check-in an **allen** zugewiesenen Standorten.

### 4.6 `leave_requests` — Urlaubsanträge

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | Integer PK | |
| `employee_id` | FK → employees CASCADE | |
| `start_date` / `end_date` | Date | |
| `note` | String(500) nullable | |
| `status` | String(20) | `pending` / `approved` / `rejected` |
| `decided_by_id` | FK → employees nullable | |
| `decided_at` | DateTime TZ nullable | |
| `rejection_reason` | String(1000) nullable | |
| `created_at` | DateTime TZ | |

### 4.7 `shift_plans` — Schichtplanung

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | Integer PK | |
| `employee_id` | FK → employees CASCADE | |
| `location_id` | FK → locations SET NULL nullable | |
| `shift_date` | Date | |
| `start_time` / `end_time` | Time | (Nachtschichten über Mitternacht möglich) |
| `note` | String(500) nullable | |
| `created_at` | DateTime TZ | |

### 4.8 `app_settings` — Systemeinstellungen

| Spalte | Typ | Beschreibung |
|---|---|---|
| `key` | String(100) PK | z.B. `notif_enabled`, `notif_email` |
| `value` | String(1000) nullable | |
| `updated_at` | DateTime | |

---

## 5. Geofencing-Logik (`geofence.py`)

Beim Check-in/Check-out prüft das Backend ob die GPS-Koordinaten innerhalb des
erlaubten Radius liegen. **Priorität** (Cascading-Fallback):

1. **Aktive Schicht** mit Standort (aus `shift_plans` wenn `now` im Schicht-Zeitfenster)
2. **M2M-Standorte** aus `employee_work_locations` (alle zugewiesenen Standorte)
3. **Legacy**: `employees.assigned_location_id` (ein einzelner Standort)
4. **Alle Standorte** in der Datenbank (wenn nichts zugeordnet)
5. **Hardcoded Fallback**: `company_site.py` mit fester GPS-Koordinate + Radius

Wenn keine Koordinate stimmt → HTTP 400 `"Outside allowed workplace area"`.

---

## 6. Backend API-Routen

### Auth (`/auth/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/auth/login` | JWT-Token bei korrektem E-Mail/Passwort |
| POST | `/auth/register` | Neuen Mitarbeiter registrieren |
| GET | `/auth/me` | Eigenes Profil (Name, E-Mail, Rolle) |

### Attendance (`/attendance/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/attendance/status` | Kann Mitarbeiter ein-/ausstempeln? + aktive Check-in-Zeit |
| POST | `/attendance/checkin` | Einstempeln (GPS-Check, erstellt attendance_log) |
| POST | `/attendance/checkout` | Ausstempeln (GPS-Check, erstellt attendance_log + work_session) |
| GET | `/attendance/logs` | Eigene rohe Stempel-Logs (letzte 200) |
| GET | `/attendance/worked-time` | Gesamte gearbeitete Zeit heute + Sessions + Statistiken |
| GET | `/attendance/my-sessions` | Eigene WorkSessions mit Genehmigungsstatus (letzte 50) |

### Employee (`/employee/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/employee/my-location` | Zugewiesener Standort (M2M-Priorität, dann Legacy) |
| GET | `/employee/dashboard` | Einfacher Willkommens-Endpunkt |
| GET | `/employee/leave-summary` | Urlaubskonto (Jahressoll, genommen, übrig, ausstehend) |
| GET | `/employee/leave-requests` | Eigene Urlaubsanträge |
| POST | `/employee/leave-requests` | Neuen Urlaubsantrag stellen |

### Admin (`/admin/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/admin/employees` | Alle Mitarbeiter (mit Urlaubsdaten) |
| POST | `/admin/employees` | Mitarbeiter anlegen |
| PUT | `/admin/employees/{id}` | Mitarbeiter bearbeiten (inkl. M2M-Standorte) |
| DELETE | `/admin/employees/{id}` | Mitarbeiter deaktivieren (Soft-Delete) |
| GET | `/admin/locations` | Alle Standorte |
| POST | `/admin/locations` | Standort anlegen |
| PUT | `/admin/locations/{id}` | Standort bearbeiten |
| DELETE | `/admin/locations/{id}` | Standort löschen |
| GET | `/admin/live` | Live-Übersicht: wer ist gerade eingestempelt |
| GET | `/admin/statistics` | KPI-Übersicht: Mitarbeiter, Standorte, Sessions heute |

### Approvals (`/admin/approvals/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/admin/approvals/work-sessions` | Alle WorkSessions (filterbar nach Status) |
| POST | `/admin/approvals/work-sessions/{id}/approve` | Session genehmigen |
| POST | `/admin/approvals/work-sessions/{id}/reject` | Session ablehnen (mit Grund) |
| POST | `/admin/approvals/work-sessions/{id}/correct` | Session korrigieren (neue Check-in/out-Zeit) |
| DELETE | `/admin/approvals/work-sessions/{id}` | Session löschen |

### Reports (`/admin/reports/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/admin/reports/attendance` | JSON-Bericht (filterbar: employee_id, from, to) |
| GET | `/admin/reports/attendance.csv` | CSV-Export |
| GET | `/admin/reports/summary` | Chart-Daten: Stunden/Standort, Monatstrend, Soll-Ist |
| GET | `/admin/reports/excel` | Excel-Export (.xlsx, 4 Sheets) |
| GET | `/admin/reports/v2/summary` | Erweiterter Bericht: Multi-Filter, Trend, Mitarbeiter+Standort-Auswertung |
| GET | `/admin/reports/v2/excel` | Excel-Export V2 (professionell, 4 Sheets) |

### Leave Admin (`/admin/leave-requests/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/admin/leave-requests` | Alle Urlaubsanträge (filterbar: status) |
| POST | `/admin/leave-requests/{id}/approve` | Genehmigen |
| POST | `/admin/leave-requests/{id}/reject` | Ablehnen (mit Grund) |

### Planning (`/planning/`, `/admin/planning/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/planning/my-shifts` | Eigene Schichten (Mitarbeiter) |
| GET | `/admin/planning/shifts` | Alle Schichten (Admin) |
| POST | `/admin/planning/shifts` | Schicht erstellen |
| PUT | `/admin/planning/shifts/{id}` | Schicht bearbeiten |
| DELETE | `/admin/planning/shifts/{id}` | Schicht löschen |

### Notifications (`/admin/notifications/`)
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/admin/notifications/settings` | SMTP-/Benachrichtigungseinstellungen laden |
| POST | `/admin/notifications/settings` | Einstellungen speichern |
| POST | `/admin/notifications/check` | Test-E-Mail senden |

### Health
| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/health` | Server läuft? |
| GET | `/health/db` | Datenbank erreichbar? |

---

## 7. Authentication & Autorisierung

- **JWT Bearer Token** im `Authorization`-Header
- Token wird im `localStorage` unter Key `timestemple_access_token` gespeichert
- **Axios-Interceptor** in `apiClient.js`: Bei 401/403 → Token löschen → Redirect zu `/login`
- **Zwei Rollen**: `employee` (nur eigene Daten) und `admin` (alle Daten + Verwaltung)
- Admin-Routen prüfen via `require_admin` Dependency
- Passwort-Policy: Mindestlänge 8, mind. 1 Zahl, 1 Sonderzeichen (geprüft in `password_policy.py`)

---

## 8. Frontend-Seiten

### 8.1 Login (`/login`)
- E-Mail + Passwort Formular
- POST `/auth/login` → JWT speichern → Weiterleitung basierend auf Rolle
  - `admin` → `/admin/dashboard`
  - `employee` → `/employee/dashboard`

### 8.2 Register (`/register`)
- Registrierungsformular (Name, E-Mail, Passwort)
- Passwort-Stärke-Indikator

### 8.3 Employee Dashboard (Desktop `>640px`)
**Datei:** `EmployeeDashboard.jsx`

Tabs:
- **Home**: Heutiger Status (ein-/ausgestempelt), Uhr, Check-in/out Button
- **Verlauf**: Bisherige Sessions mit Datum/Dauer
- **Planung**: Schichtübersicht + Urlaubsanträge stellen
- **Profil**: Name, E-Mail, Standort

Check-in/out-Ablauf:
1. Klick auf Button → GPS-Koordinaten holen
2. POST `/attendance/checkin` oder `/attendance/checkout` mit `{lat, lng}`
3. Backend prüft Geofencing → Erfolg oder Fehler "Outside allowed workplace area"
4. Bei Erfolg: Statusanzeige wechselt, Live-Timer startet/stoppt

### 8.4 Mobile Employee Dashboard (`≤640px`)
**Datei:** `MobileEmployeeDashboard.jsx`

Design-Tokens: Cream `#F0EADD`, Ink `#1A1612`, Vermillion `#E0431D`
Schriften: Instrument Serif (Überschriften), Hanken Grotesk (Text), Space Mono (Zahlen/Timer)

Tabs (Bottom-Navigation):
- **Home (Dashboard)**: Großer Kreis-Button (Vermillion = Einchecken, Dunkel = Auschecken)
  - Klick → GPS direkt holen (kein Overlay/Popup) → API-Aufruf → Button wechselt Farbe
  - Timer `HH:MM:SS` läuft beim Einchecken, reset auf `00:00:00` beim Auschecken
  - Greeting-Bereich: Datum UPPERCASE, `Hallo, Khalil.` in Serif-Italic
  - Timer-Card: Status-Dot, Live-Uhr, Check-in/Check-out Zeiten
- **Verlauf**: Session-Cards mit Genehmigungsstatus-Badges
  - Gelb = Ausstehend, Grün = Genehmigt, Blau = Korrigiert, Rot = Abgelehnt
  - Offizielle Dauer (approved/corrected) vs. berechnete Dauer (pending)
- **Statistik**: Monatsstunden, Resturlaub, Fortschrittsbalken
- **Planung**: Schichten + Urlaubsanträge

### 8.5 Admin Dashboard (`/admin/dashboard`)
**Datei:** `AdminDashboard.jsx`

Sidebar-Navigation (Gruppen):
- **Übersicht**: Dashboard (KPIs, Live-Map, Aktivitäts-Feed), Mitarbeiter, Zeiterfassung
- **Verwaltung**: Urlaubanträge, Standorte, Planung, Berichte, Genehmigungen
- **Tools**: Wissensdatenbank (KI-RAG), Einstellungen

Wichtige Bereiche:
- **Dashboard**: Live-Mitarbeiter-Status, Google Maps, Statistik-Karten
- **Mitarbeiter**: CRUD-Tabelle, Standort-Zuweisung (Multi-Select M2M), Urlaubskonto
- **Zeiterfassung**: Filter nach Mitarbeiter + Datum, Sessions anzeigen/löschen
- **Genehmigungen**: WorkSessions genehmigen/ablehnen/korrigieren
- **Berichte (V2)**: Multi-Filter (Mitarbeiter + Standort + Datum + Gruppierung), Charts:
  - Stunden pro Standort (Balken) — nur approved/corrected
  - Stundenentwicklung (Linie) — official vs. ausstehend
  - Verteilung nach Standort (Torte)
  - Detailtabelle mit Schichten
- **Planung**: Schichten erstellen/bearbeiten, Kalenderansicht
- **Urlaubanträge**: Genehmigen/Ablehnen mit Grund
- **Einstellungen**: E-Mail-Benachrichtigungen (SMTP), Systeminfo

Topbar:
- Seitentitel + Datum links
- Refresh-Button (manuell + Auto-Poll alle 30s für pending count)
- Bell-Icon mit Badge (Anzahl ausstehender Genehmigungen) → Klick → Genehmigungen-Tab
- User-Avatar + Name + Rolle rechts

---

## 9. Schlüssel-Business-Logik

### Arbeitsstunden-Berechnung (`worked_time.py`)
- **Gesamtstunden**: Summe aller check-in → check-out Paare (auch laufende Session)
- **Offizielle Stunden**: Nur `approved` + `corrected` WorkSessions
- **Ausstehend**: `pending` Sessions
- **Monatssoll** je `employment_type`:
  - `full_time` → 160h
  - `part_time_80` → 128h (80%)
  - `part_time_120` → 96h (60%)
  - `minijob` → aus `target_hours_month` (Standard 40h)

### Urlaubsberechnung (`leave_service.py`)
- **Jahressoll**: `annual_leave_days` oder System-Standard (28 Tage)
- **Verbraucht**: `approved` Anträge in diesem Jahr (Kalendertage)
- **Ausstehend**: `pending` Anträge (belegen schon Kontingent)
- **Verfügbar** = Jahressoll − Verbraucht − Ausstehend

### WorkSession-Lebenszyklus
```
Checkout → WorkSession erstellt (status=pending)
Admin: Genehmigen → status=approved (duration_seconds bleibt original)
Admin: Ablehnen  → status=rejected + rejection_reason
Admin: Korrigieren → status=corrected, checkin/checkout_time + duration_seconds neu gesetzt, admin_note
```

### Auto-Polling (Frontend)
- Admin-Dashboard: alle **30 Sekunden** `/admin/approvals/work-sessions` → pending count aktualisieren
- Bell-Badge zeigt sofort neue Genehmigungsanfragen wenn Mitarbeiter ausstempelt

---

## 10. Standort-Zuordnung: Dual-System

Das System hat **zwei parallele** Wege Mitarbeiter einem Standort zuzuordnen:

| System | Spalte/Tabelle | Beschreibung |
|---|---|---|
| **Legacy (alt)** | `employees.assigned_location_id` | 1 Standort pro Mitarbeiter |
| **M2M (neu)** | `employee_work_locations` | N Standorte pro Mitarbeiter |

**Priorität** beim `/employee/my-location` Endpunkt: M2M zuerst, Legacy als Fallback.

**Reports-Zuordnung**: Bei aktivem Standort-Filter wird der Mitarbeiter dem gefilterten
Standort zugeordnet (nicht seinem "ersten" M2M-Standort nach ID).

---

## 11. Deployment & Umgebungsvariablen

### Backend `.env`
```env
# Datenbank (eines von beiden)
DATABASE_URL=postgresql+psycopg://user:pass@host:5432/dbname
USE_SQLITE=1        # Für lokale Entwicklung ohne Postgres

# Alternativ einzelne Postgres-Variablen
POSTGRES_USER=postgres
POSTGRES_PASSWORD=meinPasswort
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=timestemple

# JWT
SECRET_KEY=dein-geheimer-schluessel
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

# SMTP (optional, für Benachrichtigungen)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
```

### Frontend `.env`
```env
VITE_API_BASE=https://api.work-track.de  # Leer = Vite-Proxy (lokal)
```

### CORS (in `main.py` konfiguriert)
Erlaubt: `localhost:5173`, `app.work-track.de`, Vercel-Preview-URLs

---

## 12. Bekannte Architektur-Entscheidungen

1. **Kein hard-delete**: Mitarbeiter werden nur deaktiviert (`is_active=false`)
2. **Attendance-Logs** sind unveränderlich — WorkSessions sind die korrigierbare Schicht darüber
3. **GPS ohne Standort-Speicherung in WorkSessions**: Sessions wissen nicht "wo" gearbeitet wurde — nur welchem Standort der Mitarbeiter *zugeordnet* ist
4. **Responsive Split**: `≤640px` → `MobileEmployeeDashboard`, `>640px` → `EmployeeDashboard` (beide unter `/employee/dashboard`)
5. **Token-Typ**: Kein Refresh-Token — bei Ablauf oder 401 → Logout
6. **Live-Timer-Hydration**: Beim Laden des Dashboards wird der aktive Check-in-Zeitstempel aus dem Backend geholt und der Timer rückwirkend gestartet
7. **SQLite-Fallback**: Für lokale Entwicklung ohne PostgreSQL — `USE_SQLITE=1` in `.env`

---

## 13. Schnellstart lokal

```bash
# 1. Root-Dependencies
npm install

# 2. Backend-Dependencies
cd backend && pip install -r requirements.txt && cd ..

# 3. .env anlegen
echo "USE_SQLITE=1" > backend/.env
echo "SECRET_KEY=localdev" >> backend/.env

# 4. Admin-Account anlegen
cd backend && python scripts/ensure_admin_user.py && cd ..

# 5. Beide Server starten
npm run dev:all
# → Backend: http://localhost:8000
# → Frontend: http://localhost:5173
```

---

*Erstellt am 2026-06-29. Aktueller Stand des Projekts.*
