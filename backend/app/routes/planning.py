from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.auth.deps import get_current_employee
from app.config.database import get_db
from app.models.employee import Employee
from app.models.location import WorkplaceLocation
from app.models.planning import ShiftPlan
from app.schemas.planning import ShiftCreateRequest, ShiftResponse, ShiftUpdateRequest

router = APIRouter(prefix="/planning", tags=["planning"])


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
    _: Employee = Depends(require_admin),
):
    """Neue Schicht anlegen."""
    _validate_references(db, body.employee_id, body.location_id)

    shift = ShiftPlan(
        employee_id=body.employee_id,
        location_id=body.location_id,
        shift_date=body.shift_date,
        start_time=body.start_time,
        end_time=body.end_time,
        note=body.note,
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)

    employees_map, locations_map = _build_maps(db)
    return _to_response(shift, employees_map, locations_map)


@router.put("/shifts/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: int,
    body: ShiftUpdateRequest,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Bestehende Schicht aktualisieren."""
    shift = db.get(ShiftPlan, shift_id)
    if shift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schicht nicht gefunden.")

    _validate_references(db, body.employee_id, body.location_id)

    shift.employee_id = body.employee_id
    shift.location_id = body.location_id
    shift.shift_date = body.shift_date
    shift.start_time = body.start_time
    shift.end_time = body.end_time
    shift.note = body.note
    db.commit()
    db.refresh(shift)

    employees_map, locations_map = _build_maps(db)
    return _to_response(shift, employees_map, locations_map)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shift(
    shift_id: int,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Schicht löschen."""
    shift = db.get(ShiftPlan, shift_id)
    if shift is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schicht nicht gefunden.")
    db.delete(shift)
    db.commit()


# ── Employee-Routen ───────────────────────────────────────────────────────────

@router.get("/my-shifts", response_model=list[ShiftResponse])
def my_shifts(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    """Zukünftige Schichten des eingeloggten Mitarbeiters (ab heute, max. 20)."""
    today = date.today()
    shifts = db.scalars(
        select(ShiftPlan)
        .where(ShiftPlan.employee_id == current_employee.id)
        .where(ShiftPlan.shift_date >= today)
        .order_by(ShiftPlan.shift_date, ShiftPlan.start_time)
        .limit(20)
    ).all()

    employees_map = {current_employee.id: current_employee.name}
    locations_map = {l.id: l.name for l in db.scalars(select(WorkplaceLocation)).all()}
    return [_to_response(s, employees_map, locations_map) for s in shifts]
