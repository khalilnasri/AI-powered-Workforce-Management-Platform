"""Urlaubs- / Abwesenheitsanträge (Mitarbeiter → Admin-Genehmigung)."""

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, func

from app.config.database import Base


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer,
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    note = Column(String(500), nullable=True)
    # pending | approved | rejected
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    decided_by_id = Column(
        Integer,
        ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
    )
    decided_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
