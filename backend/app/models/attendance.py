from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, func, text

from app.config.database import Base


class Attendance(Base):
    """One row per GPS check-in event (and later other attendance types)."""

    __tablename__ = "attendance_logs"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    # DB column is named "type" (SQL keyword); Python attribute is log_type to avoid shadowing built-in `type`.
    log_type = Column(
        "type",
        String(50),
        nullable=False,
        default="checkin",
        server_default=text("'checkin'"),
    )
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
