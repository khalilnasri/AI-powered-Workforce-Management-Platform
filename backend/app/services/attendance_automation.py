"""
Hintergrundjob-Logik: automatischer plan-basierter Checkout, proaktive
Überfällig-Erinnerung ohne Schichtplan, und No-Show-Erkennung.

Wird periodisch aus dem FastAPI-Lifespan (``backend/main.py``) heraus
aufgerufen. Die Schicht-Matching-Logik ist hier zentralisiert, damit die
Admin-Route (`app.routes.approvals`) und der Hintergrundjob nicht
auseinanderlaufen.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.attendance import Attendance
from app.models.employee import Employee, EmployeeRole
from app.models.notification import Notification
from app.models.planning import ShiftPlan
from app.models.work_session import WorkSession
from app.services.notification_messages import (
    attendance_auto_checkout_admin,
    attendance_auto_checkout_employee,
    attendance_no_show,
    attendance_overdue_alert,
)
from app.services.notification_service import create_notification
from app.utils.shift_time import (
    EARLY_CHECKIN_TOLERANCE,
    get_shift_end_datetime,
    get_shift_start_datetime,
    shift_matches_time,
)

_BERLIN = ZoneInfo("Europe/Berlin")

# Nach dieser Zeit nach geplantem Schichtende wird automatisch ausgecheckt
# bzw. eine Schicht ohne Checkin als No-Show erkannt.
AUTO_CHECKOUT_GRACE = timedelta(minutes=15)

# Fallback-Regel für Mitarbeiter ohne Schichtplan: nach dieser Dauer ohne
# Checkout gilt ein Check-in als überfällig (proaktive Admin-Erinnerung).
NO_SHIFT_OVERDUE_AFTER = timedelta(hours=12)

# Wie weit in die Vergangenheit nach No-Show-Kandidaten gesucht wird, um die
# Query zu begrenzen. Eine bereits erkannte, aber noch nicht entschiedene
# No-Show bleibt unabhängig davon dauerhaft in der Genehmigungen-Liste sichtbar.
NO_SHOW_LOOKBACK = timedelta(days=3)

logger = logging.getLogger(__name__)


@dataclass
class OpenCheckinCandidate:
    checkin: Attendance
    employee: Employee
    shift: ShiftPlan | None
    shift_end_utc: datetime | None


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def find_matching_shift(shifts: list[ShiftPlan], checkin_time: datetime) -> ShiftPlan | None:
    """
    Aus Kandidaten-Schichten eines Mitarbeiters diejenige wählen, deren
    Zeitfenster (inkl. Nachtschicht-Tagesüberlauf und Toleranz vor
    Schichtbeginn) ``checkin_time`` tatsächlich enthält. Bei mehreren
    Treffern wird die mit dem spätesten Start gewählt.
    """
    matches = [
        s for s in shifts
        if shift_matches_time(s, checkin_time, _BERLIN, early_tolerance=EARLY_CHECKIN_TOLERANCE)
    ]
    if not matches:
        return None
    return max(matches, key=lambda s: (s.shift_date, s.start_time))


def find_open_checkin_candidates(db: Session) -> list[OpenCheckinCandidate]:
    """
    Aktive Mitarbeiter, deren letztes Attendance-Ereignis ein Check-in ist,
    zusammen mit der (falls vorhanden) dazu passenden geplanten Schicht.
    """
    latest_sub = (
        select(Attendance.employee_id, func.max(Attendance.created_at).label("latest"))
        .group_by(Attendance.employee_id)
        .subquery()
    )

    open_checkins = db.scalars(
        select(Attendance)
        .join(
            latest_sub,
            (Attendance.employee_id == latest_sub.c.employee_id)
            & (Attendance.created_at == latest_sub.c.latest),
        )
        .where(Attendance.log_type == "checkin")
    ).all()

    results: list[OpenCheckinCandidate] = []
    for checkin in open_checkins:
        emp = db.get(Employee, checkin.employee_id)
        if emp is None or not emp.is_active:
            continue

        checkin_aware = _as_utc(checkin.created_at)
        checkin_local_date = checkin_aware.astimezone(_BERLIN).date()

        candidate_shifts = db.scalars(
            select(ShiftPlan)
            .where(ShiftPlan.employee_id == checkin.employee_id)
            .where(ShiftPlan.shift_date >= checkin_local_date - timedelta(days=1))
            .where(ShiftPlan.shift_date <= checkin_local_date)
        ).all()

        shift = find_matching_shift(candidate_shifts, checkin_aware)
        shift_end_utc = get_shift_end_datetime(shift, _BERLIN).astimezone(UTC) if shift else None

        results.append(
            OpenCheckinCandidate(checkin=checkin, employee=emp, shift=shift, shift_end_utc=shift_end_utc)
        )

    return results


def _active_admins(db: Session) -> list[Employee]:
    return list(
        db.scalars(
            select(Employee).where(Employee.role == EmployeeRole.admin, Employee.is_active.is_(True))
        ).all()
    )


def _process_auto_checkouts(db: Session, candidates: list[OpenCheckinCandidate], now_utc: datetime) -> int:
    """Fall A: Plan vorhanden, Checkout seit > Toleranz nach Schichtende vergessen."""
    processed = 0
    admins: list[Employee] | None = None

    for c in candidates:
        if c.shift is None or c.shift_end_utc is None:
            continue
        if now_utc <= c.shift_end_utc + AUTO_CHECKOUT_GRACE:
            continue

        shift_start_utc = get_shift_start_datetime(c.shift, _BERLIN).astimezone(UTC)
        checkout_time = c.shift_end_utc

        checkout_log = Attendance(
            employee_id=c.employee.id,
            log_type="checkout",
            lat=c.checkin.lat,
            lng=c.checkin.lng,
            created_at=checkout_time,
        )
        db.add(checkout_log)
        db.flush()

        duration = max(0, int((checkout_time - shift_start_utc).total_seconds()))
        ws = WorkSession(
            employee_id=c.employee.id,
            checkin_log_id=c.checkin.id,
            checkout_log_id=checkout_log.id,
            checkin_time=shift_start_utc,
            checkout_time=checkout_time,
            duration_seconds=duration,
            status="auto_checkout",
            approved_at=now_utc,
            admin_note="Automatisch ausgecheckt: Schichtende laut Plan erreicht.",
            updated_at=now_utc,
        )
        db.add(ws)
        db.flush()

        ntype, title, body = attendance_auto_checkout_employee(shift_start_utc, checkout_time, duration)
        create_notification(
            db, employee_id=c.employee.id, type=ntype, title=title, body=body,
            entity_type="work_session", entity_id=ws.id,
        )

        if admins is None:
            admins = _active_admins(db)
        if admins:
            a_ntype, a_title, a_body = attendance_auto_checkout_admin(
                c.employee.name, shift_start_utc, checkout_time, duration,
            )
            for admin in admins:
                create_notification(
                    db, employee_id=admin.id, type=a_ntype, title=a_title, body=a_body,
                    entity_type="work_session", entity_id=ws.id,
                )

        db.commit()
        processed += 1
        logger.info(
            "Auto-Checkout: employee_id=%d, checkin_log=%d, checkout=%s",
            c.employee.id, c.checkin.id, checkout_time.isoformat(),
        )

    return processed


def _process_overdue_reminders(db: Session, candidates: list[OpenCheckinCandidate], now_utc: datetime) -> int:
    """Fall B: kein Plan, seit > 12h eingecheckt → einmalige Admin-Erinnerung."""
    processed = 0
    admins: list[Employee] | None = None

    for c in candidates:
        if c.shift is not None:
            continue

        checkin_aware = _as_utc(c.checkin.created_at)
        if now_utc <= checkin_aware + NO_SHIFT_OVERDUE_AFTER:
            continue

        already_alerted = db.scalar(
            select(func.count()).select_from(Notification).where(
                Notification.type == "attendance.overdue_alert",
                Notification.entity_type == "attendance_log",
                Notification.entity_id == c.checkin.id,
            )
        )
        if already_alerted:
            continue

        if admins is None:
            admins = _active_admins(db)
        if not admins:
            continue

        ntype, title, body = attendance_overdue_alert(c.employee.name, checkin_aware)
        for admin in admins:
            create_notification(
                db, employee_id=admin.id, type=ntype, title=title, body=body,
                entity_type="attendance_log", entity_id=c.checkin.id,
            )

        db.commit()
        processed += 1

    return processed


def _process_no_shows(db: Session, now_utc: datetime) -> int:
    """Plan vorhanden, aber gar kein Checkin → No-Show-Erkennung am Schichtende (+Toleranz)."""
    cutoff_start = now_utc - NO_SHOW_LOOKBACK
    candidate_shifts = db.scalars(
        select(ShiftPlan).where(
            ShiftPlan.shift_date >= (cutoff_start.astimezone(_BERLIN).date() - timedelta(days=1)),
            ShiftPlan.shift_date <= now_utc.astimezone(_BERLIN).date(),
        )
    ).all()

    processed = 0
    admins: list[Employee] | None = None

    for shift in candidate_shifts:
        shift_end_utc = get_shift_end_datetime(shift, _BERLIN).astimezone(UTC)
        if now_utc <= shift_end_utc + AUTO_CHECKOUT_GRACE:
            continue
        if shift_end_utc < cutoff_start:
            continue

        shift_start_utc = get_shift_start_datetime(shift, _BERLIN).astimezone(UTC)

        already_handled = db.scalar(
            select(func.count()).select_from(WorkSession).where(
                WorkSession.employee_id == shift.employee_id,
                WorkSession.checkin_time == shift_start_utc,
            )
        )
        if already_handled:
            continue

        has_checkin = db.scalar(
            select(func.count()).select_from(Attendance).where(
                Attendance.employee_id == shift.employee_id,
                Attendance.log_type == "checkin",
                Attendance.created_at >= shift_start_utc - EARLY_CHECKIN_TOLERANCE,
                Attendance.created_at <= shift_end_utc,
            )
        )
        if has_checkin:
            continue

        emp = db.get(Employee, shift.employee_id)
        if emp is None or not emp.is_active:
            continue

        duration = max(0, int((shift_end_utc - shift_start_utc).total_seconds()))
        ws = WorkSession(
            employee_id=shift.employee_id,
            checkin_log_id=None,
            checkout_log_id=None,
            checkin_time=shift_start_utc,
            checkout_time=shift_end_utc,
            duration_seconds=duration,
            status="no_show_pending",
            admin_note="Automatisch erkannt: kein Check-in zur geplanten Schicht.",
            updated_at=now_utc,
        )
        db.add(ws)
        db.flush()

        if admins is None:
            admins = _active_admins(db)
        if admins:
            ntype, title, body = attendance_no_show(emp.name, shift)
            for admin in admins:
                create_notification(
                    db, employee_id=admin.id, type=ntype, title=title, body=body,
                    entity_type="work_session", entity_id=ws.id,
                )

        db.commit()
        processed += 1
        logger.info("No-Show erkannt: employee_id=%d, shift_id=%d", shift.employee_id, shift.id)

    return processed


def run_attendance_automation_tick(db: Session) -> None:
    """Ein Durchlauf: Fall A (Auto-Checkout), Fall B (Überfällig-Alert), No-Show."""
    now_utc = datetime.now(UTC)
    candidates = find_open_checkin_candidates(db)
    _process_auto_checkouts(db, candidates, now_utc)
    _process_overdue_reminders(db, candidates, now_utc)
    _process_no_shows(db, now_utc)
