from datetime import date, datetime, time

from pydantic import BaseModel, Field, model_validator


class ShiftCreateRequest(BaseModel):
    employee_id: int
    location_id: int | None = None
    shift_date: date
    start_time: time
    end_time: time
    note: str | None = None

    @model_validator(mode="after")
    def check_times(self):
        # Nur identische Zeiten blockieren.
        # end_time < start_time ist erlaubt → Nachtschicht über Mitternacht
        # Beispiel: 22:45 → 06:04  (endet am nächsten Tag)
        if self.start_time == self.end_time:
            raise ValueError("Start- und Endzeit dürfen nicht identisch sein.")
        return self


class ShiftUpdateRequest(ShiftCreateRequest):
    pass


class BulkShiftEmployee(BaseModel):
    """Ein Mitarbeiter mit optionalem Standort für die Zeitraum-Planung."""

    employee_id: int
    location_id: int | None = None


class ShiftBulkCreateRequest(BaseModel):
    """Mehrere Schichten: Mitarbeiter × Tage, gleiche Uhrzeit, Standort pro Person."""

    employees: list[BulkShiftEmployee] = Field(min_length=1)
    date_from: date
    date_to: date
    start_time: time
    end_time: time
    note: str | None = None

    @model_validator(mode="after")
    def check_bulk(self):
        if self.date_from > self.date_to:
            raise ValueError("„Von“-Datum darf nicht nach „Bis“-Datum liegen.")
        if self.start_time == self.end_time:
            raise ValueError("Start- und Endzeit dürfen nicht identisch sein.")
        days = (self.date_to - self.date_from).days + 1
        if days > 366:
            raise ValueError("Maximal 366 Tage auf einmal planbar.")
        emp_ids = [e.employee_id for e in self.employees]
        if len(emp_ids) != len(set(emp_ids)):
            raise ValueError("Jeder Mitarbeiter darf nur einmal in der Liste stehen.")
        if len(self.employees) > 100:
            raise ValueError("Maximal 100 Mitarbeiter auf einmal planbar.")
        if days * len(self.employees) > 5000:
            raise ValueError("Zu viele Schichten auf einmal (max. 5000).")
        return self


class SkippedShiftDate(BaseModel):
    employee_id: int
    shift_date: date
    reason: str


class ShiftBulkCreateResponse(BaseModel):
    created_count: int
    skipped: list[SkippedShiftDate]
    shifts: list["ShiftResponse"]


class ShiftResponse(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    shift_date: date
    start_time: time
    end_time: time
    note: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ShiftImportRowResult(BaseModel):
    row_number: int
    sheet_name: str = ""
    employee_id: int | None = None
    employee_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    shift_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    is_valid: bool
    errors: list[str] = Field(default_factory=list)


class ShiftImportPreviewResponse(BaseModel):
    total_rows: int
    valid_count: int
    invalid_count: int
    rows: list[ShiftImportRowResult]


class ShiftImportSkipped(BaseModel):
    row_number: int
    sheet_name: str = ""
    reason: str


class ShiftImportCommitResponse(BaseModel):
    created_count: int
    skipped: list[ShiftImportSkipped]
    shifts: list["ShiftResponse"]
