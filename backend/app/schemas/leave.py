from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator


class LeaveRequestCreate(BaseModel):
    start_date: date
    end_date: date
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def end_after_start(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date muss am oder nach start_date liegen.")
        return self


class LeaveRequestOut(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    start_date: date
    end_date: date
    note: str | None
    status: str
    decided_at: datetime | None = None
    rejection_reason: str | None = None
    created_at: datetime


class LeaveSummaryOut(BaseModel):
    """Für die Urlaubs-Karte im Mitarbeiter-Dashboard."""

    annual_leave_days: int = Field(description="Effektives Soll (Admin oder System-Default).")
    used_days_this_year: int = Field(description="Genehmigte Urlaubstage im laufenden Jahr (Kalendertage).")
    pending_days_this_year: int = Field(
        default=0,
        description="Tage im Jahr, die durch ausstehende Anträge reserviert sind.",
    )
    pending_requests: int = Field(default=0, description="Anzahl ausstehender Anträge.")
    remaining_days: int = Field(description="Soll minus genehmigt (ohne ausstehende Reservierung).")
    available_days: int = Field(description="Noch buchbar: Soll minus genehmigt minus ausstehend (Jahr).")
