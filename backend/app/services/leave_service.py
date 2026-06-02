"""Berechnungen und Hilfen für Urlaubsanträge."""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.leave_request import LeaveRequest

_BERLIN = ZoneInfo("Europe/Berlin")


def default_annual_leave_days() -> int:
    raw = (os.getenv("DEFAULT_ANNUAL_LEAVE_DAYS") or "30").strip()
    try:
        n = int(raw)
        return max(0, min(n, 365))
    except ValueError:
        return 30


def resolved_annual_quota(emp: Employee) -> int:
    """Effektives Jahres-Soll: Mitarbeiterfeld oder System-Default."""
    if emp.annual_leave_days is not None:
        return max(0, min(int(emp.annual_leave_days), 365))
    return default_annual_leave_days()


def inclusive_days(start: date, end: date) -> int:
    return max(0, (end - start).days + 1)


def overlap_calendar_days(
    req_start: date, req_end: date, win_start: date, win_end: date,
) -> int:
    a = max(req_start, win_start)
    b = min(req_end, win_end)
    if a > b:
        return 0
    return inclusive_days(a, b)


def current_year_window_berlin() -> tuple[date, date]:
    y = datetime.now(_BERLIN).date().year
    return date(y, 1, 1), date(y, 12, 31)


def approved_leave_days_in_year(db: Session, employee_id: int) -> int:
    ys, ye = current_year_window_berlin()
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.employee_id == employee_id)
        .where(LeaveRequest.status == "approved")
    ).all()
    total = 0
    for r in rows:
        total += overlap_calendar_days(r.start_date, r.end_date, ys, ye)
    return total


def pending_leave_days_in_year(db: Session, employee_id: int) -> int:
    """Kalendertage im laufenden Jahr, die durch ausstehende Anträge „reserviert“ sind."""
    ys, ye = current_year_window_berlin()
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.employee_id == employee_id)
        .where(LeaveRequest.status == "pending")
    ).all()
    total = 0
    for r in rows:
        total += overlap_calendar_days(r.start_date, r.end_date, ys, ye)
    return total


def pending_leave_count(db: Session, employee_id: int) -> int:
    return len(
        db.scalars(
            select(LeaveRequest)
            .where(LeaveRequest.employee_id == employee_id)
            .where(LeaveRequest.status == "pending")
        ).all()
    )


def aggregate_leave_year_window(db: Session) -> dict[int, dict[str, int]]:
    """
    Pro Mitarbeiter: genehmigte Tage (im Berliner Kalenderjahr), ausstehende Tage (Überlappung),
    Anzahl ausstehender Anträge.
    """
    ys, ye = current_year_window_berlin()
    out: dict[int, dict[str, int]] = defaultdict(lambda: {"used_ytd": 0, "pending_ytd": 0, "pending_count": 0})
    for lr in db.scalars(select(LeaveRequest)).all():
        eid = lr.employee_id
        od = overlap_calendar_days(lr.start_date, lr.end_date, ys, ye)
        if od <= 0:
            continue
        if lr.status == "approved":
            out[eid]["used_ytd"] += od
        elif lr.status == "pending":
            out[eid]["pending_ytd"] += od
            out[eid]["pending_count"] += 1
    return dict(out)


def leave_balance_for_employee(db: Session, emp: Employee) -> dict[str, int]:
    """Eine Zeile Kennzahlen für UI und Validierung."""
    agg = aggregate_leave_year_window(db).get(emp.id, {"used_ytd": 0, "pending_ytd": 0, "pending_count": 0})
    annual = resolved_annual_quota(emp)
    used = agg["used_ytd"]
    pend = agg["pending_ytd"]
    remaining = max(0, annual - used)
    available = max(0, annual - used - pend)
    return {
        "annual_resolved": annual,
        "used_ytd": used,
        "pending_ytd": pend,
        "pending_count": agg["pending_count"],
        "remaining": remaining,
        "available": available,
    }


def requested_days_in_current_year(start: date, end: date) -> int:
    ys, ye = current_year_window_berlin()
    return overlap_calendar_days(start, end, ys, ye)


def can_request_leave_days(
    db: Session,
    emp: Employee,
    start: date,
    end: date,
) -> tuple[bool, int, int]:
    """
    Prüft, ob der Zeitraum im laufenden Jahr noch in die verfügbaren Tage passt.

    Returns: (ok, available_before_request, requested_in_year)
    """
    bal = leave_balance_for_employee(db, emp)
    req_ytd = requested_days_in_current_year(start, end)
    avail = bal["available"]
    return (req_ytd <= avail, avail, req_ytd)
