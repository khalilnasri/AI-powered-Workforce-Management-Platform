"""
Employee-Endpunkte für In-App-Benachrichtigungen.

GET  /notifications                – eigene Benachrichtigungen auflisten
GET  /notifications/unread-count   – Anzahl ungelesener Benachrichtigungen
POST /notifications/{id}/read      – einzelne als gelesen markieren
POST /notifications/mark-all-read  – alle als gelesen markieren
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.deps import get_current_employee
from app.config.database import get_db
from app.models.employee import Employee
from app.models.notification import Notification
from app.schemas.notifications import NotificationOut, UnreadCountOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _to_out(row: Notification, db: Session, actors: dict[int, Employee]) -> NotificationOut:
    actor = actors.get(row.actor_id) if row.actor_id else None
    return NotificationOut(
        id=row.id,
        type=row.type,
        title=row.title,
        body=row.body,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        actor_id=row.actor_id,
        actor_name=actor.name if actor else None,
        read_at=row.read_at,
        created_at=row.created_at,
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    rows = db.scalars(
        select(Notification)
        .where(Notification.employee_id == current_employee.id)
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    actor_ids = {r.actor_id for r in rows if r.actor_id}
    actors: dict[int, Employee] = {}
    if actor_ids:
        actors = {
            e.id: e
            for e in db.scalars(select(Employee).where(Employee.id.in_(actor_ids))).all()
        }
    return [_to_out(r, db, actors) for r in rows]


@router.get("/unread-count", response_model=UnreadCountOut)
def unread_count(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    total = db.scalar(
        select(func.count()).select_from(Notification).where(
            Notification.employee_id == current_employee.id,
            Notification.read_at.is_(None),
        )
    )
    return UnreadCountOut(count=total or 0)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    row = db.get(Notification, notification_id)
    if row is None or row.employee_id != current_employee.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benachrichtigung nicht gefunden.")

    if row.read_at is None:
        row.read_at = datetime.now(UTC)
        db.commit()
        db.refresh(row)
    actors: dict[int, Employee] = {}
    if row.actor_id:
        actor = db.get(Employee, row.actor_id)
        if actor:
            actors[row.actor_id] = actor
    return _to_out(row, db, actors)


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    db.execute(
        update(Notification)
        .where(
            Notification.employee_id == current_employee.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    db.commit()
    return None
