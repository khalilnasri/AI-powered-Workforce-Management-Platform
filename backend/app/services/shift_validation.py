from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.leave_request import LeaveRequest


def leave_conflict_reason(db: Session, employee_id: int, shift_date: date) -> str | None:
    """Gibt einen Grund zurück, falls der Mitarbeiter an diesem Tag genehmigten Urlaub hat."""
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
