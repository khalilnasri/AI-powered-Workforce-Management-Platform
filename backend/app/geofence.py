"""Geofencing: punch must be inside allowed workplace radius(es)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.company_site import ALLOWED_RADIUS_METERS, COMPANY_LAT, COMPANY_LNG
from app.models.employee import Employee
from app.models.employee_work_location import EmployeeWorkLocation
from app.models.location import WorkplaceLocation
from app.models.planning import ShiftPlan
from app.utils.distance import haversine_meters
from app.utils.shift_time import shift_matches_time

# Keep in sync with frontend `GEOFENCE_MESSAGE` (EmployeeDashboard.jsx).
OUTSIDE_WORKPLACE_MESSAGE = "Outside allowed workplace area"

OUTSIDE_COMPANY_AREA = JSONResponse(
    status_code=400,
    content={
        "status": "error",
        "message": OUTSIDE_WORKPLACE_MESSAGE,
    },
)

NO_ASSIGNED_WORKPLACE = JSONResponse(
    status_code=400,
    content={
        "status": "error",
        "message": (
            "Assigned workplace missing in database — contact admin. "
            "Or: no shift location and no work site configured."
        ),
    },
)


def _berlin_now() -> datetime:
    """Schichten und Kalendertag sind in der Regel in lokaler (Berlin) Zeit gedacht."""
    return datetime.now(ZoneInfo("Europe/Berlin"))


def shift_covers_now(shift: ShiftPlan, now: datetime) -> bool:
    """True, wenn ``now`` in [start, end] zur Schicht gehört (inkl. Nachtschicht über Mitternacht)."""
    return shift_matches_time(shift, now, now.tzinfo)


def _active_shift_locations(db: Session, employee_id: int, now: datetime) -> list[WorkplaceLocation]:
    """Standorte aus Schichten, die ``now`` abdecken und ein ``location_id`` haben."""
    day = now.date()
    yesterday = day - timedelta(days=1)
    shifts = db.scalars(
        select(ShiftPlan)
        .where(ShiftPlan.employee_id == employee_id)
        .where(ShiftPlan.shift_date.in_([yesterday, day]))
    ).all()

    seen: set[int] = set()
    result: list[WorkplaceLocation] = []
    for sh in shifts:
        if sh.location_id is None:
            continue
        if not shift_covers_now(sh, now):
            continue
        loc = db.get(WorkplaceLocation, sh.location_id)
        if loc is not None and loc.id not in seen:
            seen.add(loc.id)
            result.append(loc)
    return result


def resolve_allowed_workplace_locations(
    db: Session,
    employee: Employee,
) -> list[WorkplaceLocation] | None:
    """
    Welche Standort-Radien für einen Stempel gelten.

    - ``None``: keine Zeilen in ``locations`` → Legacy-Einzelfallback ``company_site``.
    - ``[]``: Konfigurationsfehler (z. B. ``assigned_location_id`` ohne Datensatz).
    - sonst: mindestens einen dieser Standorte treffen.
    """
    now = _berlin_now()
    active_shift_locs = _active_shift_locations(db, employee.id, now)
    if active_shift_locs:
        return active_shift_locs

    m2m = list(
        db.scalars(
            select(WorkplaceLocation)
            .join(EmployeeWorkLocation, EmployeeWorkLocation.location_id == WorkplaceLocation.id)
            .where(EmployeeWorkLocation.employee_id == employee.id)
            .order_by(WorkplaceLocation.id)
        ).all()
    )
    if m2m:
        return m2m

    if employee.assigned_location_id is not None:
        loc = db.get(WorkplaceLocation, employee.assigned_location_id)
        if loc is None:
            return []
        return [loc]

    all_locs = list(db.scalars(select(WorkplaceLocation)).all())
    return all_locs if all_locs else None


def geofence_block_response(
    db: Session,
    lat: float,
    lng: float,
    employee: Employee,
) -> JSONResponse | None:
    """
    Wenn die Koordinaten außerhalb aller erlaubten Standorte liegen → Fehler-JSON.

    Reihenfolge: aktive Schicht(en) mit Standort → sonst zugewiesener Mitarbeiter-Standort
    → sonst jeder eingetragene Firmenstandort (Legacy).
    """
    allowed = resolve_allowed_workplace_locations(db, employee)

    if allowed == []:
        return NO_ASSIGNED_WORKPLACE

    if allowed is None:
        distance_m = haversine_meters(lat, lng, COMPANY_LAT, COMPANY_LNG)
        if distance_m > ALLOWED_RADIUS_METERS:
            return OUTSIDE_COMPANY_AREA
        return None

    for loc in allowed:
        if haversine_meters(lat, lng, loc.lat, loc.lng) <= float(loc.radius_meters):
            return None
    return OUTSIDE_COMPANY_AREA


def company_geofence_block_response(lat: float, lng: float) -> JSONResponse | None:
    """Legacy: ein fester Punkt ohne DB. Für Geofencing bitte ``geofence_block_response`` nutzen."""
    distance_m = haversine_meters(lat, lng, COMPANY_LAT, COMPANY_LNG)
    if distance_m > ALLOWED_RADIUS_METERS:
        return OUTSIDE_COMPANY_AREA
    return None
