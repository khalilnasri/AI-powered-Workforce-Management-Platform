"""Admin: Urlaubsanträge einsehen, genehmigen oder ablehnen."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.schemas.leave import LeaveRequestOut

router = APIRouter(prefix="/admin", tags=["admin"])


def _to_out(row: LeaveRequest, db: Session) -> LeaveRequestOut:
    emp = db.get(Employee, row.employee_id)
    return LeaveRequestOut(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=emp.name if emp else None,
        start_date=row.start_date,
        end_date=row.end_date,
        note=row.note,
        status=row.status,
        decided_at=row.decided_at,
        rejection_reason=row.rejection_reason,
        created_at=row.created_at,
    )


@router.get("/leave-requests", response_model=list[LeaveRequestOut])
def list_leave_requests(
    status_filter: str | None = Query(default=None, alias="status"),
    employee_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    stmt = select(LeaveRequest).order_by(LeaveRequest.created_at.desc())
    if status_filter:
        stmt = stmt.where(LeaveRequest.status == status_filter)
    if employee_id is not None:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    rows = db.scalars(stmt).all()
    return [_to_out(r, db) for r in rows]


@router.patch("/leave-requests/{request_id}/approve", response_model=LeaveRequestOut)
def approve_leave_request(
    request_id: int,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    row = db.get(LeaveRequest, request_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden.")
    if row.status != "pending":
        raise HTTPException(status_code=400, detail="Nur ausstehende Anträge können genehmigt werden.")

    row.status = "approved"
    row.decided_by_id = admin.id
    row.decided_at = datetime.now(UTC)
    row.rejection_reason = None
    db.commit()
    db.refresh(row)
    return _to_out(row, db)


class LeaveRejectRequest(BaseModel):
    rejection_reason: str = Field(..., min_length=1, max_length=1000)


@router.patch("/leave-requests/{request_id}/reject", response_model=LeaveRequestOut)
def reject_leave_request(
    request_id: int,
    body: LeaveRejectRequest,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    row = db.get(LeaveRequest, request_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antrag nicht gefunden.")
    if row.status != "pending":
        raise HTTPException(status_code=400, detail="Nur ausstehende Anträge können abgelehnt werden.")

    row.status = "rejected"
    row.decided_by_id = admin.id
    row.decided_at = datetime.now(UTC)
    row.rejection_reason = body.rejection_reason.strip()
    db.commit()
    db.refresh(row)
    return _to_out(row, db)
