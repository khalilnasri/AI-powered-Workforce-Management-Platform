from datetime import date, datetime, time

from pydantic import BaseModel, model_validator


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
