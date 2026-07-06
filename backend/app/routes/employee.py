from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_employee
from app.config.database import get_db
from app.models.employee import Employee
from app.models.employee_work_location import EmployeeWorkLocation
from app.models.leave_request import LeaveRequest
from app.models.location import WorkplaceLocation
from app.schemas.leave import LeaveRequestCreate, LeaveRequestOut, LeaveSummaryOut
from app.services.leave_service import can_request_leave_days, inclusive_days, leave_balance_for_employee

router = APIRouter(prefix="/employee", tags=["employee"])


@router.get("/my-location")
def get_my_assigned_location(
    current_employee: Employee = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    # Priorität 1: M2M-Standorte (neueres System)
    loc = db.scalars(
        select(WorkplaceLocation)
        .join(EmployeeWorkLocation, EmployeeWorkLocation.location_id == WorkplaceLocation.id)
        .where(EmployeeWorkLocation.employee_id == current_employee.id)
        .order_by(WorkplaceLocation.id)
        .limit(1)
    ).first()

    # Priorität 2: Legacy assigned_location_id
    if loc is None and current_employee.assigned_location_id:
        loc = db.get(WorkplaceLocation, current_employee.assigned_location_id)

    if not loc:
        return {"location": None}

    return {
        "location": {
            "id": loc.id,
            "name": loc.name,
            "lat": loc.lat,
            "lng": loc.lng,
            "radius_meters": loc.radius_meters,
        }
    }


@router.get("/dashboard")
def employee_dashboard(current_employee: Employee = Depends(get_current_employee)):
    return {
        "message": f"Hello, {current_employee.name}",
        "role": current_employee.role.value,
        "employee_id": current_employee.id,
        "email": current_employee.email,
    }


@router.get("/leave-summary", response_model=LeaveSummaryOut)
def leave_summary(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    bal = leave_balance_for_employee(db, current_employee)
    return LeaveSummaryOut(
        annual_leave_days=bal["annual_resolved"],
        used_days_this_year=bal["used_ytd"],
        pending_days_this_year=bal["pending_ytd"],
        pending_requests=bal["pending_count"],
        remaining_days=bal["remaining"],
        available_days=bal["available"],
    )


@router.get("/leave-requests", response_model=list[LeaveRequestOut])
def my_leave_requests(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.employee_id == current_employee.id)
        .order_by(LeaveRequest.created_at.desc())
    ).all()
    return [
        LeaveRequestOut(
            id=r.id,
            employee_id=r.employee_id,
            employee_name=current_employee.name,
            start_date=r.start_date,
            end_date=r.end_date,
            note=r.note,
            status=r.status,
            decided_at=r.decided_at,
            rejection_reason=r.rejection_reason,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/leave-requests", response_model=LeaveRequestOut, status_code=status.HTTP_201_CREATED)
def create_leave_request(
    body: LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    days = inclusive_days(body.start_date, body.end_date)
    if days > 60:
        raise HTTPException(status_code=400, detail="Maximal 60 Kalendertage pro Antrag.")

    ok, avail, req_in_year = can_request_leave_days(
        db, current_employee, body.start_date, body.end_date
    )
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Für das laufende Jahr sind nur noch {avail} Urlaubstage verfügbar "
                f"(bereits genehmigte und ausstehende Anträge zählen). "
                f"Dein Zeitraum betrifft {req_in_year} Kalendertage in diesem Jahr."
            ),
        )

    row = LeaveRequest(
        employee_id=current_employee.id,
        start_date=body.start_date,
        end_date=body.end_date,
        note=(body.note or "").strip() or None,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return LeaveRequestOut(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=current_employee.name,
        start_date=row.start_date,
        end_date=row.end_date,
        note=row.note,
        status=row.status,
        decided_at=row.decided_at,
        rejection_reason=row.rejection_reason,
        created_at=row.created_at,
    )
