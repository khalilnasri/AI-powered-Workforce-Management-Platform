"""
Admin-Endpunkte für die Arbeitszeit-Genehmigung.

GET  /admin/approvals/work-sessions              – alle Sessions auflisten (gefiltert)
PATCH /admin/approvals/work-sessions/{id}/approve – genehmigen
PATCH /admin/approvals/work-sessions/{id}/reject  – ablehnen
PATCH /admin/approvals/work-sessions/{id}/correct – korrigieren
POST  /admin/approvals/backfill                   – alte Logs nachträglich als Sessions anlegen
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.work_session import WorkSession
from app.schemas.approvals import (
    WorkSessionCorrectRequest,
    WorkSessionRejectRequest,
    WorkSessionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/approvals", tags=["approvals"])


# ── Hilfsfunktionen ──────────────────────────────────────────────────────────

def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _build_response(session: WorkSession, db: Session) -> WorkSessionResponse:
    emp      = db.get(Employee, session.employee_id)
    approver = db.get(Employee, session.approved_by_id) if session.approved_by_id else None
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

    session.status         = "approved"
    session.approved_by_id = admin.id
    session.approved_at    = datetime.now(UTC)
    session.updated_at     = datetime.now(UTC)
    session.rejection_reason = None
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

    session.status           = "rejected"
    session.rejection_reason = body.rejection_reason.strip()
    session.approved_by_id   = admin.id
    session.approved_at      = datetime.now(UTC)
    session.updated_at       = datetime.now(UTC)
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

    checkin_time  = _ensure_utc(body.checkin_time)
    checkout_time = _ensure_utc(body.checkout_time)

    if checkout_time <= checkin_time:
        raise HTTPException(status_code=400, detail="Check-out muss nach Check-in liegen.")

    duration = max(0, int((checkout_time - checkin_time).total_seconds()))

    session.checkin_time     = checkin_time
    session.checkout_time    = checkout_time
    session.duration_seconds = duration
    session.admin_note       = body.admin_note
    session.status           = "corrected"
    session.approved_by_id   = admin.id
    session.approved_at      = datetime.now(UTC)
    session.updated_at       = datetime.now(UTC)
    db.commit()
    db.refresh(session)
    return _build_response(session, db)


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
