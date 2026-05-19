from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CheckInRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude in decimal degrees")
    lng: float = Field(..., ge=-180, le=180, description="Longitude in decimal degrees")


class CheckInResponse(BaseModel):
    status: str
    message: str
    id: int
    lat: float
    lng: float
    created_at: datetime


class CheckoutResponse(BaseModel):
    status: str
    message: str
    id: int
    type: Literal["checkout"]
    lat: float
    lng: float
    created_at: datetime


class AttendanceStatusResponse(BaseModel):
    status: Literal["checked_in", "checked_out"]
    last_type: str | None
    can_checkin: bool
    can_checkout: bool
    message: str


class AttendanceLogEntry(BaseModel):
    """One row returned to the frontend (maps ORM ``log_type`` to JSON ``type``)."""

    id: int
    type: str
    lat: float
    lng: float
    created_at: datetime


class WorkedSessionItem(BaseModel):
    checkin: datetime
    checkout: datetime | None = None
    duration_seconds: int


class WorkedTimeResponse(BaseModel):
    total_seconds: int
    total_hours: float
    active: bool
    sessions: list[WorkedSessionItem]
    # WorkSession-basierte offizielle Arbeitszeiten
    official_seconds: int = 0
    official_hours: float = 0.0
    pending_seconds: int = 0
    pending_hours: float = 0.0
    pending_count: int = 0
