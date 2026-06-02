from enum import Enum

from sqlalchemy import Boolean, Column, Enum as SAEnum, ForeignKey, Integer, String

from app.config.database import Base


class EmployeeRole(str, Enum):
    employee = "employee"
    admin = "admin"


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    role = Column(
        SAEnum(EmployeeRole, native_enum=False, length=20),
        nullable=False,
        default=EmployeeRole.employee,
        server_default=EmployeeRole.employee.value,
    )
    # Soft-Delete: niemals hart löschen, nur deaktivieren
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    # Optionale Kontaktdaten
    phone = Column(String(50), nullable=True)
    # Zugewiesener Standort (optional, FK zu locations)
    assigned_location_id = Column(Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    # Soll-Urlaubstage pro Kalenderjahr (NULL = System-Standard aus DEFAULT_ANNUAL_LEAVE_DAYS)
    annual_leave_days = Column(Integer, nullable=True)
