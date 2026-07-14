"""
Admin-Endpunkte für die Arbeitszeit-Genehmigung.

GET  /admin/approvals/work-sessions              – alle Sessions auflisten (gefiltert)
PATCH /admin/approvals/work-sessions/{id}/approve – genehmigen
PATCH /admin/approvals/work-sessions/{id}/reject  – ablehnen
PATCH /admin/approvals/work-sessions/{id}/correct – korrigieren
DELETE /admin/approvals/work-sessions/{id}       – Session-Eintrag löschen (Roh-Stempel bleiben)
POST  /admin/approvals/backfill                   – alte Logs nachträglich als Sessions anlegen
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.location import WorkplaceLocation
from app.models.planning import ShiftPlan
from app.models.work_session import WorkSession
from app.schemas.approvals import (
    OverdueCheckoutOut,
    WorkSessionCorrectRequest,
    WorkSessionRejectRequest,
    WorkSessionResponse,
)
from app.services.notification_messages import (
    attendance_force_checkout,
    attendance_reminder,
    session_approved,
    session_corrected,
    session_deleted,
    session_rejected,
)
from app.services.notification_service import create_notification
from app.utils.shift_time import get_shift_end_datetime, shift_matches_time

_BERLIN = ZoneInfo("Europe/Berlin")

# Fallback-Regel für Mitarbeiter ohne Schichtplan: nach dieser Dauer ohne
# Checkout gilt ein Check-in als überfällig.
_NO_SHIFT_OVERDUE_AFTER = timedelta(hours=12)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/approvals", tags=["approvals"])


# ── Hilfsfunktionen ──────────────────────────────────────────────────────────

def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _find_matching_shift(shifts: list[ShiftPlan], checkin_time: datetime) -> ShiftPlan | None:
    """
    Aus den Kandidaten-Schichten eines Mitarbeiters diejenige wählen, deren
    Zeitfenster (inkl. Nachtschicht-Tagesüberlauf) ``checkin_time`` tatsächlich
    enthält. Bei mehreren Treffern (sollte durch Planung nicht vorkommen)
    wird die mit dem spätesten Start gewählt.
    """
    matches = [s for s in shifts if shift_matches_time(s, checkin_time, _BERLIN)]
    if not matches:
        return None
    return max(matches, key=lambda s: (s.shift_date, s.start_time))


def _build_response(session: WorkSession, db: Session) -> WorkSessionResponse:
    emp      = db.get(Employee, session.employee_id)
    approver = db.get(Employee, session.approved_by_id) if session.approved_by_id else None

    # Original-Stempelzeiten aus attendance_logs laden (nur bei korrigierten Sessions)
    original_checkin_time  = None
    original_checkout_time = None
    if session.status == "corrected":
        if session.checkin_log_id:
            att_in = db.get(Attendance, session.checkin_log_id)
            if att_in:
                original_checkin_time = att_in.created_at
        if session.checkout_log_id:
            att_out = db.get(Attendance, session.checkout_log_id)
            if att_out:
                original_checkout_time = att_out.created_at

    return WorkSessionResponse(
        id=session.id,
        employee_id=session.employee_id,
        employee_name=emp.name if emp else None,
        checkin_log_id=session.checkin_log_id,
        checkout_log_id=session.checkout_log_id,
        checkin_time=session.checkin_time,
        checkout_time=session.checkout_time,
        duration_seconds=session.duration_seconds,
        status=session.status,
        approved_by_id=session.approved_by_id,
        approved_by_name=approver.name if approver else None,
        approved_at=session.approved_at,
        rejection_reason=session.rejection_reason,
        admin_note=session.admin_note,
        original_checkin_time=original_checkin_time,
        original_checkout_time=original_checkout_time,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/work-sessions", response_model=list[WorkSessionResponse])
def list_work_sessions(
    employee_id: int | None = Query(default=None, description="Nur diesen Mitarbeiter"),
    status:      str | None = Query(default=None, description="pending | approved | rejected | corrected"),
    start_date:  str | None = Query(default=None, description="YYYY-MM-DD"),
    end_date:    str | None = Query(default=None, description="YYYY-MM-DD"),
    db:    Session  = Depends(get_db),
    _:     Employee = Depends(require_admin),
):
    stmt = select(WorkSession).order_by(WorkSession.checkin_time.desc())

    if employee_id is not None:
        stmt = stmt.where(WorkSession.employee_id == employee_id)
    if status is not None:
        stmt = stmt.where(WorkSession.status == status)
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date).replace(tzinfo=UTC)
            stmt = stmt.where(WorkSession.checkin_time >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Ungültiges Startdatum: {start_date}")
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date).replace(tzinfo=UTC) + timedelta(days=1)
            stmt = stmt.where(WorkSession.checkin_time < end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Ungültiges Enddatum: {end_date}")

    sessions = db.scalars(stmt).all()
    return [_build_response(s, db) for s in sessions]


@router.patch("/work-sessions/{session_id}/approve", response_model=WorkSessionResponse)
def approve_session(
    session_id: int,
    db:    Session  = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Session genehmigen → status = approved."""
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session nicht gefunden.")
    if session.status != "pending":
        raise HTTPException(status_code=400, detail="Nur ausstehende Sessions können genehmigt werden.")

    session.status         = "approved"
    session.approved_by_id = admin.id
    session.approved_at    = datetime.now(UTC)
    session.updated_at     = datetime.now(UTC)
    session.rejection_reason = None
    ntype, title, body = session_approved(session, admin)
    create_notification(
        db,
        employee_id=session.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="work_session",
        entity_id=session.id,
        actor_id=admin.id,
    )
    db.commit()
    db.refresh(session)
    return _build_response(session, db)


@router.patch("/work-sessions/{session_id}/reject", response_model=WorkSessionResponse)
def reject_session(
    session_id: int,
    body:  WorkSessionRejectRequest,
    db:    Session  = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Session ablehnen → status = rejected."""
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session nicht gefunden.")
    if session.status != "pending":
        raise HTTPException(status_code=400, detail="Nur ausstehende Sessions können abgelehnt werden.")

    session.status           = "rejected"
    session.rejection_reason = body.rejection_reason.strip()
    session.approved_by_id   = admin.id
    session.approved_at      = datetime.now(UTC)
    session.updated_at       = datetime.now(UTC)
    ntype, title, body = session_rejected(session, admin, session.rejection_reason or "")
    create_notification(
        db,
        employee_id=session.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="work_session",
        entity_id=session.id,
        actor_id=admin.id,
    )
    db.commit()
    db.refresh(session)
    return _build_response(session, db)


@router.patch("/work-sessions/{session_id}/correct", response_model=WorkSessionResponse)
def correct_session(
    session_id: int,
    body:  WorkSessionCorrectRequest,
    db:    Session  = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Zeiten korrigieren → status = corrected, duration neu berechnen."""
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session nicht gefunden.")
    if session.status not in ("pending", "rejected"):
        raise HTTPException(
            status_code=400,
            detail="Nur ausstehende oder abgelehnte Sessions können korrigiert werden.",
        )

    checkin_time  = _ensure_utc(body.checkin_time)
    checkout_time = _ensure_utc(body.checkout_time)

    if checkout_time <= checkin_time:
        raise HTTPException(status_code=400, detail="Check-out muss nach Check-in liegen.")

    old_checkin = session.checkin_time
    old_checkout = session.checkout_time
    old_duration = session.duration_seconds

    duration = max(0, int((checkout_time - checkin_time).total_seconds()))

    session.checkin_time     = checkin_time
    session.checkout_time    = checkout_time
    session.duration_seconds = duration
    session.admin_note       = body.admin_note
    session.status           = "corrected"
    session.rejection_reason = None
    session.approved_by_id   = admin.id
    session.approved_at      = datetime.now(UTC)
    session.updated_at       = datetime.now(UTC)
    ntype, title, body = session_corrected(
        session,
        admin,
        old_checkin=old_checkin,
        old_checkout=old_checkout,
        old_duration=old_duration,
        admin_note=body.admin_note,
    )
    create_notification(
        db,
        employee_id=session.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="work_session",
        entity_id=session.id,
        actor_id=admin.id,
    )
    db.commit()
    db.refresh(session)
    return _build_response(session, db)


@router.delete("/work-sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_session(
    session_id: int,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """
    Entfernt die WorkSession (Genehmigungs-/Buchungszeile).

    Check-in-/Check-out-Rohdaten in ``attendance_logs`` bleiben erhalten;
    ggf. kann ein Admin später erneut ``/backfill`` ausführen oder die Zeiten
    manuell auswerten.
    """
    session = db.get(WorkSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session nicht gefunden.")

    ntype, title, body = session_deleted(session, admin)
    create_notification(
        db,
        employee_id=session.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="work_session",
        entity_id=session.id,
        actor_id=admin.id,
    )
    db.delete(session)
    db.commit()
    return None


@router.get("/overdue-checkouts", response_model=list[OverdueCheckoutOut])
def list_overdue_checkouts(
    db:    Session  = Depends(get_db),
    _:     Employee = Depends(require_admin),
):
    """
    Mitarbeiter, deren letztes Attendance-Ereignis ein Check-in ist und die
    entweder ihre zum Check-in passende geplante Schicht bereits
    überschritten haben, oder – ohne Schichtplan – seit mehr als
    ``_NO_SHIFT_OVERDUE_AFTER`` eingecheckt sind.
    """
    now_utc = datetime.now(UTC)

    # Letztes Ereignis je Mitarbeiter ermitteln
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

    result: list[OverdueCheckoutOut] = []
    for checkin in open_checkins:
        emp = db.get(Employee, checkin.employee_id)
        if emp is None or not emp.is_active:
            continue

        checkin_aware = (
            checkin.created_at if checkin.created_at.tzinfo
            else checkin.created_at.replace(tzinfo=UTC)
        )
        checkin_local_date = checkin_aware.astimezone(_BERLIN).date()

        # Kandidaten-Schichten: Start am Check-in-Tag oder am Vortag (deckt
        # Nachtschichten ab, deren Zeitfenster erst nach Mitternacht in den
        # Check-in-Tag hineinreicht).
        candidate_shifts = db.scalars(
            select(ShiftPlan)
            .where(ShiftPlan.employee_id == checkin.employee_id)
            .where(ShiftPlan.shift_date >= checkin_local_date - timedelta(days=1))
            .where(ShiftPlan.shift_date <= checkin_local_date)
        ).all()

        shift = _find_matching_shift(candidate_shifts, checkin_aware)

        if shift is None:
            # Kein zum Check-in passender Schichtplan → Fallback: fester
            # Zeitraum ab Check-in statt geplantem Schichtende.
            shift_end_utc = checkin_aware + _NO_SHIFT_OVERDUE_AFTER
            if now_utc <= shift_end_utc:
                continue  # noch nicht überfällig

            result.append(
                OverdueCheckoutOut(
                    employee_id=emp.id,
                    employee_name=emp.name,
                    checkin_time=checkin_aware,
                    checkin_log_id=checkin.id,
                    shift_date=checkin_local_date,
                    shift_end=shift_end_utc,
                    location_id=None,
                    location_name=None,
                )
            )
            continue

        shift_end_utc = get_shift_end_datetime(shift, _BERLIN).astimezone(UTC)

        if now_utc <= shift_end_utc:
            continue  # Schicht läuft noch

        loc = db.get(WorkplaceLocation, shift.location_id) if shift.location_id else None

        result.append(
            OverdueCheckoutOut(
                employee_id=emp.id,
                employee_name=emp.name,
                checkin_time=checkin_aware,
                checkin_log_id=checkin.id,
                shift_date=shift.shift_date,
                shift_end=shift_end_utc,
                location_id=shift.location_id,
                location_name=loc.name if loc else None,
            )
        )

    return sorted(result, key=lambda x: x.shift_end)


@router.post("/overdue-checkouts/{checkin_log_id}/remind", status_code=200)
def remind_overdue_employee(
    checkin_log_id: int,
    db: Session  = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    checkin_log = db.get(Attendance, checkin_log_id)
    if checkin_log is None:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden.")
    if checkin_log.log_type != "checkin":
        raise HTTPException(status_code=400, detail="Kein offener Check-in.")

    checkin_at = (
        checkin_log.created_at if checkin_log.created_at.tzinfo
        else checkin_log.created_at.replace(tzinfo=UTC)
    )
    ntype, title, body = attendance_reminder(admin, checkin_at)
    create_notification(
        db,
        employee_id=checkin_log.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="attendance_log",
        entity_id=checkin_log.id,
        actor_id=admin.id,
    )
    db.commit()
    return {"status": "ok", "message": "Erinnerung wurde gesendet."}


@router.post("/overdue-checkouts/{checkin_log_id}/force-checkout", status_code=200)
def force_checkout_overdue(
    checkin_log_id: int,
    db:    Session  = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Erstellt einen manuellen Checkout und legt eine WorkSession (pending) an."""
    checkin_log = db.get(Attendance, checkin_log_id)
    if checkin_log is None or checkin_log.log_type != "checkin":
        raise HTTPException(status_code=404, detail="Check-in nicht gefunden.")

    now_utc = datetime.now(UTC)

    checkin_time = (
        checkin_log.created_at if checkin_log.created_at.tzinfo
        else checkin_log.created_at.replace(tzinfo=UTC)
    )
    checkin_local_date = checkin_time.astimezone(_BERLIN).date()

    # Zur Check-in-Zeit passende Schicht suchen (Kandidaten: Start am
    # Check-in-Tag oder am Vortag, deckt Nachtschichten ab).
    candidate_shifts = db.scalars(
        select(ShiftPlan)
        .where(ShiftPlan.employee_id == checkin_log.employee_id)
        .where(ShiftPlan.shift_date >= checkin_local_date - timedelta(days=1))
        .where(ShiftPlan.shift_date <= checkin_local_date)
    ).all()

    shift = _find_matching_shift(candidate_shifts, checkin_time)

    # Schichtende (bzw. 12h-Fallback ohne Schichtplan) als Checkout-Zeit
    # verwenden, sofern es bereits in der Vergangenheit liegt.
    if shift:
        shift_end_utc = get_shift_end_datetime(shift, _BERLIN).astimezone(UTC)
    else:
        shift_end_utc = checkin_time + _NO_SHIFT_OVERDUE_AFTER

    checkout_time = shift_end_utc if shift_end_utc < now_utc else now_utc

    # Checkout-Attendance-Log anlegen (Koordinaten vom Check-in übernehmen)
    checkout_log = Attendance(
        employee_id=checkin_log.employee_id,
        log_type="checkout",
        lat=checkin_log.lat,
        lng=checkin_log.lng,
        created_at=checkout_time,
    )
    db.add(checkout_log)
    db.flush()

    duration = max(0, int((checkout_time - checkin_time).total_seconds()))

    ws = WorkSession(
        employee_id=checkin_log.employee_id,
        checkin_log_id=checkin_log.id,
        checkout_log_id=checkout_log.id,
        checkin_time=checkin_time,
        checkout_time=checkout_time,
        duration_seconds=duration,
        status="pending",
        updated_at=now_utc,
    )
    db.add(ws)
    db.flush()
    ntype, title, body = attendance_force_checkout(
        admin, checkin_time, checkout_time, duration,
    )
    create_notification(
        db,
        employee_id=checkin_log.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="work_session",
        entity_id=ws.id,
        actor_id=admin.id,
    )
    db.commit()
    logger.info(
        "Manueller Checkout: employee_id=%d, checkin_log=%d, checkout=%s",
        checkin_log.employee_id, checkin_log.id, checkout_time.isoformat(),
    )
    return {"status": "ok", "message": "Manueller Checkout durchgefuehrt."}


@router.post("/backfill", status_code=200)
def backfill_sessions(
    db:    Session  = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """
    Erstellt WorkSessions für alte Checkout-Logs, die noch keine haben.
    Nützlich bei erstmaliger Einführung des Genehmigungssystems.
    """
    # Alle checkout-Logs ohne matching WorkSession
    existing_checkout_ids = set(
        db.scalars(
            select(WorkSession.checkout_log_id).where(WorkSession.checkout_log_id.isnot(None))
        ).all()
    )

    all_checkouts = db.scalars(
        select(Attendance)
        .where(Attendance.log_type == "checkout")
        .order_by(Attendance.created_at.asc())
    ).all()

    created = 0
    for checkout in all_checkouts:
        if checkout.id in existing_checkout_ids:
            continue

        # Letzten passenden Checkin suchen (vor diesem Checkout)
        last_checkin = db.scalars(
            select(Attendance)
            .where(Attendance.employee_id == checkout.employee_id)
            .where(Attendance.log_type == "checkin")
            .where(Attendance.created_at < checkout.created_at)
            .order_by(Attendance.created_at.desc())
            .limit(1)
        ).first()

        if last_checkin is None:
            continue

        checkin_time  = _ensure_utc(last_checkin.created_at)
        checkout_time = _ensure_utc(checkout.created_at)
        duration      = max(0, int((checkout_time - checkin_time).total_seconds()))

        ws = WorkSession(
            employee_id=checkout.employee_id,
            checkin_log_id=last_checkin.id,
            checkout_log_id=checkout.id,
            checkin_time=checkin_time,
            checkout_time=checkout_time,
            duration_seconds=duration,
            status="pending",
            updated_at=datetime.now(UTC),
        )
        db.add(ws)
        created += 1

    db.commit()
    logger.info("Backfill: %d WorkSessions erstellt.", created)
    return {"created": created, "message": f"{created} Sessions als 'pending' angelegt."}
