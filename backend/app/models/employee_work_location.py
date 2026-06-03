"""Zuordnung Mitarbeiter ↔ mehrere Arbeitsstandorte (Geofencing erlaubt alle gewählten)."""

from sqlalchemy import Column, ForeignKey, Integer

from app.config.database import Base


class EmployeeWorkLocation(Base):
    __tablename__ = "employee_work_locations"

    employee_id = Column(
        Integer,
        ForeignKey("employees.id", ondelete="CASCADE"),
        primary_key=True,
    )
    location_id = Column(
        Integer,
        ForeignKey("locations.id", ondelete="CASCADE"),
        primary_key=True,
    )
