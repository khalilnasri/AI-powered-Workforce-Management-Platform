from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Time, func

from app.config.database import Base


class ShiftPlan(Base):
    """Eine geplante Schicht für einen Mitarbeiter an einem bestimmten Standort."""

    __tablename__ = "shift_plans"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id = Column(
        Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    shift_date = Column(Date, nullable=False, index=True)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
