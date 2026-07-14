from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.auth.deps import get_current_employee
from app.config.database import get_db
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.location import WorkplaceLocation
from app.models.planning import ShiftPlan
from app.schemas.planning import (
    ShiftBulkCreateRequest,
    ShiftBulkCreateResponse,
    ShiftCreateRequest,
    ShiftResponse,
    ShiftUpdateRequest,
    SkippedShiftDate,
)
from app.services.notification_messages import shift_assigned, shift_deleted, shift_updated
from app.services.notification_service import create_notification
from app.utils.shift_time import get_shift_end_datetime

router = APIRouter(prefix="/planning", tags=["planning"])

_BERLIN = ZoneInfo("Europe/Berlin")
# Mitarbeiter-App: genug für Monatsplanung (bis ~2 Schichten/Tag × 31 Tage)
_MY_SHIFTS_MAX = 62


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def _build_maps(db: Session) -> tuple[dict[int, str], dict[int, str]]:
    """Lädt Mitarbeiter- und Standort-Namen für schnelle Lookups."""
    employees_map = {e.id: e.name for e in db.scalars(select(Employee)).all()}
    locations_map = {l.id: l.name for l in db.scalars(select(WorkplaceLocation)).all()}
    return employees_map, locations_map


def _to_response(
    shift: ShiftPlan,
    employees_map: dict[int, str],
    locations_map: dict[int, str],
) -> ShiftResponse:
    return ShiftResponse(
        id=shift.id,
        employee_id=shift.employee_id,
        employee_name=employees_map.get(shift.employee_id),
        location_id=shift.location_id,
        location_name=locations_map.get(shift.location_id) if shift.location_id else None,
        shift_date=shift.shift_date,
        start_time=shift.start_time,
        end_time=shift.end_time,
        note=shift.note,
        created_at=shift.created_at,
    )


def _validate_references(db: Session, employee_id: int, location_id: int | None) -> None:
    """Stellt sicher, dass Mitarbeiter und Standort existieren."""
    if db.get(Employee, employee_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitarbeiter nicht gefunden.",
        )
    if location_id is not None and db.get(WorkplaceLocation, location_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Standort nicht gefunden.",
        )


def _location_name(db: Session, location_id: int | None) -> str | None:
    if location_id is None:
        return None
    loc = db.get(WorkplaceLocation, location_id)
    return loc.name if loc else None


def _validate_no_leave_conflict(db: Session, employee_id: int, shift_date: date) -> None:
    """Verhindert Schichtplanung an einem Tag, an dem der Mitarbeiter genehmigten Urlaub hat."""
    conflict = db.scalar(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= shift_date,
            LeaveRequest.end_date >= shift_date,
        )
    )
    if conflict is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mitarbeiter hat vom {conflict.start_date:%d.%m.%Y} bis "
                f"{conflict.end_date:%d.%m.%Y} genehmigten Urlaub — in diesem Zeitraum "
                "kann keine Schicht eingeplant werden."
            ),
        )


# ── Admin-Routen ──────────────────────────────────────────────────────────────

@router.get("/shifts", response_model=list[ShiftResponse])
def list_shifts(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Alle Schichten auflisten (neueste Tage zuerst)."""
    shifts = db.scalars(
        select(ShiftPlan).order_by(ShiftPlan.shift_date.desc(), ShiftPlan.start_time)
    ).all()
    employees_map, locations_map = _build_maps(db)
    return [_to_response(s, employees_map, locations_map) for s in shifts]


@router.post("/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
def create_shift(
    body: ShiftCreateRequest,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Neue Schicht anlegen."""
    _validate_references(db, body.employee_id, body.location_id)
    _validate_no_leave_conflict(db, body.employee_id, body.shift_date)

    shift = ShiftPlan(
        employee_id=body.employee_id,
        location_id=body.location_id,
        shift_date=body.shift_date,
        start_time=body.start_time,
        end_time=body.end_time,
        note=body.note,
    )
    db.add(shift)
    db.flush()
    loc_name = _location_name(db, shift.location_id)
    ntype, title, body = shift_assigned(shift, admin, location_name=loc_name)
    create_notification(
        db,
        employee_id=shift.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="shift_plan",
        entity_id=shift.id,
        actor_id=admin.id,
    )
    db.commit()
    db.refresh(shift)

    employees_map, locations_map = _build_maps(db)
    return _to_response(shift, employees_map, locations_map)


def _leave_conflict_reason(db: Session, employee_id: int, shift_date: date) -> str | None:
    conflict = db.scalar(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= shift_date,
            LeaveRequest.end_date >= shift_date,
        )
    )
    if conflict is None:
        return None
    return (
        f"Genehmigter Urlaub ({conflict.start_date:%d.%m.%Y}–{conflict.end_date:%d.%m.%Y})"
    )


@router.post("/shifts/bulk", response_model=ShiftBulkCreateResponse, status_code=status.HTTP_201_CREATED)
def create_shifts_bulk(
    body: ShiftBulkCreateRequest,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Schichten für jeden Mitarbeiter und jeden Tag im Datumsbereich anlegen."""
    for item in body.employees:
        _validate_references(db, item.employee_id, item.location_id)

    created: list[ShiftPlan] = []
    skipped: list[SkippedShiftDate] = []
    day = body.date_from

    while day <= body.date_to:
        for item in body.employees:
            emp_id = item.employee_id
            reason = _leave_conflict_reason(db, emp_id, day)
            if reason:
                skipped.append(SkippedShiftDate(employee_id=emp_id, shift_date=day, reason=reason))
            else:
                loc_name = _location_name(db, item.location_id)
                shift = ShiftPlan(
                    employee_id=emp_id,
                    location_id=item.location_id,
                    shift_date=day,
                    start_time=body.start_time,
                    end_time=body.end_time,
                    note=body.note,
                )
                db.add(shift)
                db.flush()
                ntype, title, nbody = shift_assigned(shift, admin, location_name=loc_name)
                create_notification(
                    db,
                    employee_id=shift.employee_id,
                    type=ntype,
                    title=title,
                    body=nbody,
                    entity_type="shift_plan",
                    entity_id=shift.id,
                    actor_id=admin.id,
                )
                created.append(shift)
        day += timedelta(days=1)

    if not created:
        db.rollback()
        detail = "Keine Schichten angelegt."
        if skipped:
            detail += f" {len(skipped)} Kombination(en) übersprungen (z. B. Urlaub)."
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    db.commit()
    for shift in created:
        db.refresh(shift)

    employees_map, locations_map = _build_maps(db)
    return ShiftBulkCreateResponse(
        created_count=len(created),
        skipped=skipped,
        shifts=[_to_response(s, employees_map, locations_map) for s in created],
    )


@router.put("/shifts/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: int,
    body: ShiftUpdateRequest,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Bestehende Schicht aktualisieren."""
    shift = db.get(ShiftPlan, shift_id)
    if shift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schicht nicht gefunden.")

    _validate_references(db, body.employee_id, body.location_id)
    _validate_no_leave_conflict(db, body.employee_id, body.shift_date)

    old_employee_id = shift.employee_id
    old_date = shift.shift_date
    old_start = shift.start_time
    old_end = shift.end_time
    old_location_id = shift.location_id

    shift.employee_id = body.employee_id
    shift.location_id = body.location_id
    shift.shift_date = body.shift_date
    shift.start_time = body.start_time
    shift.end_time = body.end_time
    shift.note = body.note

    new_loc_name = _location_name(db, shift.location_id)
    old_loc_name = _location_name(db, old_location_id)

    if old_employee_id != body.employee_id:
        ntype_old, title_old, body_old = shift_deleted(
            old_date, old_start, old_end, admin, location_name=old_loc_name,
        )
        create_notification(
            db,
            employee_id=old_employee_id,
            type=ntype_old,
            title=title_old,
            body=body_old,
            entity_type="shift_plan",
            entity_id=shift.id,
            actor_id=admin.id,
        )
        ntype_new, title_new, body_new = shift_assigned(
            shift, admin, location_name=new_loc_name,
        )
        create_notification(
            db,
            employee_id=shift.employee_id,
            type=ntype_new,
            title=title_new,
            body=body_new,
            entity_type="shift_plan",
            entity_id=shift.id,
            actor_id=admin.id,
        )
    else:
        ntype, title, body = shift_updated(shift, admin, location_name=new_loc_name)
        create_notification(
            db,
            employee_id=shift.employee_id,
            type=ntype,
            title=title,
            body=body,
            entity_type="shift_plan",
            entity_id=shift.id,
            actor_id=admin.id,
        )
    db.commit()
    db.refresh(shift)

    employees_map, locations_map = _build_maps(db)
    return _to_response(shift, employees_map, locations_map)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    """Schicht löschen."""
    shift = db.get(ShiftPlan, shift_id)
    if shift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schicht nicht gefunden.")

    loc_name = _location_name(db, shift.location_id)
    ntype, title, body = shift_deleted(
        shift.shift_date, shift.start_time, shift.end_time, admin, location_name=loc_name,
    )
    create_notification(
        db,
        employee_id=shift.employee_id,
        type=ntype,
        title=title,
        body=body,
        entity_type="shift_plan",
        entity_id=shift.id,
        actor_id=admin.id,
    )
    db.delete(shift)
    db.commit()


# ── Employee-Routen ───────────────────────────────────────────────────────────

@router.get("/my-shifts", response_model=list[ShiftResponse])
def my_shifts(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    """
    Aktuelle und zukünftige Schichten des eingeloggten Mitarbeiters.

    Schließt eine Schicht vom Vortag mit ein, wenn diese als Nachtschicht
    aktuell noch läuft (Ende nach Mitternacht). Limit deckt Monatsplanung ab.
    """
    now_berlin = datetime.now(_BERLIN)
    today     = now_berlin.date()
    yesterday = today - timedelta(days=1)

    candidates = db.scalars(
        select(ShiftPlan)
        .where(ShiftPlan.employee_id == current_employee.id)
        .where(ShiftPlan.shift_date >= yesterday)
        .order_by(ShiftPlan.shift_date, ShiftPlan.start_time)
    ).all()

    shifts = [
        s for s in candidates
        if s.shift_date >= today or get_shift_end_datetime(s, _BERLIN) > now_berlin
    ][:_MY_SHIFTS_MAX]

    employees_map = {current_employee.id: current_employee.name}
    locations_map = {l.id: l.name for l in db.scalars(select(WorkplaceLocation)).all()}
    return [_to_response(s, employees_map, locations_map) for s in shifts]
