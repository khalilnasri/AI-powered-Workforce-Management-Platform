from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class AdminEmployeeOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_active: bool = True
    phone: str | None = None
    assigned_location_id: int | None = None


# Alias — wird in Routen als response_model genutzt
EmployeeAdminResponse = AdminEmployeeOut


class AdminCreateEmployeeRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class EmployeeUpdateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    role: str = Field(..., pattern="^(admin|employee)$")
    phone: str | None = Field(default=None, max_length=50)
    assigned_location_id: int | None = None
    is_active: bool = True


class AdminLocationOut(BaseModel):
    id: int
    name: str
    address: str
    lat: float
    lng: float
    radius_meters: float
    created_at: datetime


class AdminCreateLocationRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: str = Field(default="", max_length=512)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    radius_meters: float = Field(..., gt=0, le=50_000)


class AdminUpdateLocationRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: str = Field(default="", max_length=512)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    radius_meters: float = Field(..., gt=0, le=50_000)


class AdminAttendanceRow(BaseModel):
    employee_name: str
    employee_email: str
    type: str
    lat: float
    lng: float
    created_at: datetime


class AdminStatisticsResponse(BaseModel):
    total_employees: int
    total_logs: int
    active_now: int
    # WorkSession-basierte offizielle Arbeitszeiten
    official_seconds: int = 0
    official_hours: float = 0.0
    pending_count: int = 0
    pending_hours: float = 0.0


class AdminPlanningItem(BaseModel):
    """Placeholder until shift planning is implemented."""

    id: str
    title: str
    note: str


# ── Report-Schemas ────────────────────────────────────────────────────────────

class ReportSession(BaseModel):
    """Eine einzelne Arbeitsschicht (checkin → checkout)."""
    checkin: datetime
    checkout: datetime | None
    duration_seconds: int
    duration_hours: float
    status: str  # "closed" oder "open"
    work_session_status: str | None = None  # pending | approved | rejected | corrected


class EmployeeReportRow(BaseModel):
    """Auswertung für einen Mitarbeiter."""
    employee_id: int
    employee_name: str
    employee_email: str
    total_seconds: int
    total_hours: float
    sessions: list[ReportSession]
    # Offizielle Arbeitszeit = approved + corrected
    approved_seconds: int = 0
    approved_hours: float = 0.0


class AttendanceReportResponse(BaseModel):
    """Gesamtergebnis des Reports."""
    employees: list[EmployeeReportRow]
    total_seconds: int
    total_hours: float
    session_count: int
    start_date: str | None
    end_date: str | None
    # Offizielle Gesamtstunden (approved + corrected)
    approved_total_seconds: int = 0
    approved_total_hours: float = 0.0
