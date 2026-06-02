from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.auth.passwords import hash_password
from app.config.database import get_db
from app.models.attendance import Attendance
from app.models.employee import Employee, EmployeeRole
from app.models.location import WorkplaceLocation
from app.services.leave_service import aggregate_leave_year_window, resolved_annual_quota
from app.services.work_session_stats import get_global_session_stats
from app.schemas.admin import (
    AdminAttendanceRow,
    AdminCreateEmployeeRequest,
    AdminCreateLocationRequest,
    AdminUpdateLocationRequest,
    AdminEmployeeOut,
    EmployeeUpdateRequest,
    AdminLocationOut,
    AdminPlanningItem,
    AdminStatisticsResponse,
)

router = APIRouter(prefix="/admin", tags=["admin"])

_BERLIN = ZoneInfo("Europe/Berlin")


def _berlin_day_bounds_utc(day: date | None = None) -> tuple[datetime, datetime]:
    """Start (inkl.) und Ende (exkl.) des Kalendertags in Berlin, als aware UTC für DB-Vergleiche."""
    if day is None:
        day = datetime.now(_BERLIN).date()
    start_local = datetime.combine(day, time.min, tzinfo=_BERLIN)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def _empty_leave_agg() -> dict[str, int]:
    return {"used_ytd": 0, "pending_ytd": 0, "pending_count": 0}


def _employee_to_out(e: Employee, agg_row: dict[str, int] | None = None) -> AdminEmployeeOut:
    row = agg_row or _empty_leave_agg()
    annual = resolved_annual_quota(e)
    used = row["used_ytd"]
    pend_days = row["pending_ytd"]
    pend_cnt = row["pending_count"]
    remaining = max(0, annual - used)
    available = max(0, annual - used - pend_days)
    return AdminEmployeeOut(
        id=e.id,
        name=e.name,
        email=e.email,
        role=e.role.value,
        is_active=e.is_active,
        phone=e.phone,
        assigned_location_id=e.assigned_location_id,
        annual_leave_days=e.annual_leave_days,
        leave_annual_resolved=annual,
        leave_used_this_year=used,
        leave_pending_days_this_year=pend_days,
        leave_pending_count=pend_cnt,
        leave_remaining=remaining,
        leave_available=available,
    )


@router.get("/employees", response_model=list[AdminEmployeeOut])
def list_employees(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    rows = db.scalars(select(Employee).order_by(Employee.id)).all()
    agg = aggregate_leave_year_window(db)
    return [_employee_to_out(e, agg.get(e.id)) for e in rows]


@router.post("/employees", response_model=AdminEmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    body: AdminCreateEmployeeRequest,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Create an employee account (always role employee — admins are not created here)."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")

    email_norm = body.email.strip().lower()
    existing = db.scalars(select(Employee).where(func.lower(Employee.email) == email_norm)).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    employee = Employee(
        name=name,
        email=email_norm,
        password=hash_password(body.password),
        role=EmployeeRole.employee,
        annual_leave_days=body.annual_leave_days,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    agg = aggregate_leave_year_window(db)
    return _employee_to_out(employee, agg.get(employee.id))


@router.put("/employees/{employee_id}", response_model=AdminEmployeeOut)
def update_employee(
    employee_id: int,
    body: EmployeeUpdateRequest,
    db: Session = Depends(get_db),
    current_admin: Employee = Depends(require_admin),
):
    """Name, E-Mail, Rolle, Telefon, Standort und Status eines Mitarbeiters bearbeiten."""
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mitarbeiter nicht gefunden.")

    # E-Mail-Duplikat prüfen (außer bei sich selbst)
    email_norm = body.email.strip().lower()
    existing = db.scalars(
        select(Employee).where(func.lower(Employee.email) == email_norm)
    ).first()
    if existing is not None and existing.id != employee_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="E-Mail wird bereits verwendet.")

    # Admin darf sich selbst nicht deaktivieren
    if emp.id == current_admin.id and not body.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Du kannst dich nicht selbst deaktivieren.")

    emp.name = body.name.strip()
    emp.email = email_norm
    emp.role = EmployeeRole(body.role)
    emp.phone = body.phone.strip() if body.phone else None
    emp.assigned_location_id = body.assigned_location_id
    emp.is_active = body.is_active
    emp.annual_leave_days = body.annual_leave_days
    db.commit()
    db.refresh(emp)
    agg = aggregate_leave_year_window(db)
    return _employee_to_out(emp, agg.get(emp.id))


@router.patch("/employees/{employee_id}/activate", response_model=AdminEmployeeOut)
def activate_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mitarbeiter nicht gefunden.")
    emp.is_active = True
    db.commit()
    db.refresh(emp)
    agg = aggregate_leave_year_window(db)
    return _employee_to_out(emp, agg.get(emp.id))


@router.patch("/employees/{employee_id}/deactivate", response_model=AdminEmployeeOut)
def deactivate_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_admin: Employee = Depends(require_admin),
):
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mitarbeiter nicht gefunden.")
    if emp.id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Du kannst dich nicht selbst deaktivieren.")
    emp.is_active = False
    db.commit()
    db.refresh(emp)
    agg = aggregate_leave_year_window(db)
    return _employee_to_out(emp, agg.get(emp.id))


@router.get("/locations", response_model=list[AdminLocationOut])
def list_locations(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    rows = db.scalars(select(WorkplaceLocation).order_by(WorkplaceLocation.id)).all()
    return [
        AdminLocationOut(
            id=r.id,
            name=r.name,
            address=r.address or "",
            lat=r.lat,
            lng=r.lng,
            radius_meters=float(r.radius_meters),
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/locations", response_model=AdminLocationOut, status_code=status.HTTP_201_CREATED)
def create_location(
    body: AdminCreateLocationRequest,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    loc = WorkplaceLocation(
        name=body.name.strip(),
        address=(body.address or "").strip(),
        lat=body.lat,
        lng=body.lng,
        radius_meters=body.radius_meters,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return AdminLocationOut(
        id=loc.id,
        name=loc.name,
        address=loc.address or "",
        lat=loc.lat,
        lng=loc.lng,
        radius_meters=float(loc.radius_meters),
        created_at=loc.created_at,
    )


@router.put("/locations/{location_id}", response_model=AdminLocationOut)
def update_location(
    location_id: int,
    body: AdminUpdateLocationRequest,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    loc = db.get(WorkplaceLocation, location_id)
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Standort nicht gefunden.")
    loc.name = body.name.strip()
    loc.address = (body.address or "").strip()
    loc.lat = body.lat
    loc.lng = body.lng
    loc.radius_meters = body.radius_meters
    db.commit()
    db.refresh(loc)
    return AdminLocationOut(
        id=loc.id,
        name=loc.name,
        address=loc.address or "",
        lat=loc.lat,
        lng=loc.lng,
        radius_meters=float(loc.radius_meters),
        created_at=loc.created_at,
    )


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    location_id: int,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    loc = db.get(WorkplaceLocation, location_id)
    if loc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Standort nicht gefunden.")
    db.delete(loc)
    db.commit()


@router.get("/attendance", response_model=list[AdminAttendanceRow])
def list_all_attendance(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    stmt = (
        select(Attendance, Employee)
        .join(Employee, Attendance.employee_id == Employee.id)
        .order_by(Attendance.created_at.desc())
        .limit(500)
    )
    rows = db.execute(stmt).all()
    return [
        AdminAttendanceRow(
            employee_name=emp.name,
            employee_email=emp.email,
            type=att.log_type,
            lat=att.lat,
            lng=att.lng,
            created_at=att.created_at,
        )
        for att, emp in rows
    ]


@router.get("/statistics", response_model=AdminStatisticsResponse)
def statistics(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    total_employees = db.scalar(select(func.count()).select_from(Employee)) or 0
    total_logs = db.scalar(select(func.count()).select_from(Attendance)) or 0

    rn = (
        func.row_number()
        .over(partition_by=Attendance.employee_id, order_by=Attendance.created_at.desc())
        .label("rn")
    )
    subq = (
        select(Attendance.employee_id, Attendance.log_type, rn)
        .where(Attendance.employee_id.is_not(None))
        .subquery()
    )
    latest = (
        select(subq.c.employee_id, subq.c.log_type).where(subq.c.rn == 1).subquery()
    )
    active_now = (
        db.scalar(select(func.count()).select_from(latest).where(latest.c.log_type == "checkin")) or 0
    )

    day_start_utc, day_end_utc = _berlin_day_bounds_utc()
    checked_rows = db.scalars(
        select(Attendance.employee_id)
        .where(Attendance.log_type == "checkin")
        .where(Attendance.created_at >= day_start_utc)
        .where(Attendance.created_at < day_end_utc)
    ).all()
    checked_in_today = len({eid for eid in checked_rows if eid is not None})

    ws_stats = get_global_session_stats(db)

    return AdminStatisticsResponse(
        total_employees=total_employees,
        total_logs=total_logs,
        active_now=active_now,
        checked_in_today=checked_in_today,
        official_seconds=ws_stats["official_seconds"],
        official_hours=ws_stats["official_hours"],
        pending_count=ws_stats["pending_count"],
        pending_hours=ws_stats["pending_hours"],
    )


@router.get("/planning", response_model=list[AdminPlanningItem])
def planning_placeholder(
    _: Employee = Depends(require_admin),
):
    """Reserved for shifts and rosters — empty for now."""
    return []
