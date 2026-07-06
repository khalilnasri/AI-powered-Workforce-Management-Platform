from datetime import date, datetime

from pydantic import BaseModel, Field


class WorkSessionResponse(BaseModel):
    """Vollständige Antwort für Admin- und Employee-Endpunkte."""

    id: int
    employee_id: int
    employee_name: str | None = None

    checkin_log_id:  int | None = None
    checkout_log_id: int | None = None

    checkin_time:     datetime
    checkout_time:    datetime | None = None
    duration_seconds: int

    status: str  # pending | approved | rejected | corrected

    approved_by_id:   int | None = None
    approved_by_name: str | None = None
    approved_at:      datetime | None = None
    rejection_reason: str | None = None
    admin_note:       str | None = None

    # Original-Stempelzeiten (nur bei status=corrected befüllt)
    # checkin_time/checkout_time enthalten dann die korrigierten Zeiten
    original_checkin_time:  datetime | None = None
    original_checkout_time: datetime | None = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkSessionRejectRequest(BaseModel):
    rejection_reason: str = Field(..., min_length=1, max_length=1000)


class WorkSessionCorrectRequest(BaseModel):
    checkin_time:  datetime
    checkout_time: datetime
    admin_note:    str | None = Field(default=None, max_length=1000)


class OverdueCheckoutOut(BaseModel):
    """Ein Mitarbeiter, der nach Schichtende noch eingecheckt ist."""
    employee_id:    int
    employee_name:  str | None = None
    checkin_time:   datetime
    checkin_log_id: int
    shift_date:     date
    shift_end:      datetime
    location_id:    int | None = None
    location_name:  str | None = None

    model_config = {"from_attributes": True}
