from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.config.database import Base


class WorkSession(Base):
    """
    Eine geprüfte Arbeitszeit-Einheit.

    Wird automatisch beim Checkout erstellt (status='pending').
    Admin kann sie genehmigen, ablehnen oder korrigieren.
    Attendance-Logs (Rohdaten) bleiben unverändert.
    """

    __tablename__ = "work_sessions"

    id               = Column(Integer, primary_key=True, index=True)
    employee_id      = Column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    checkin_log_id   = Column(
        Integer, ForeignKey("attendance_logs.id", ondelete="SET NULL"),
        nullable=True,
    )
    checkout_log_id  = Column(
        Integer, ForeignKey("attendance_logs.id", ondelete="SET NULL"),
        nullable=True,
    )
    checkin_time     = Column(DateTime(timezone=True), nullable=False)
    checkout_time    = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=False, default=0)

    # pending | approved | rejected | corrected
    status           = Column(String(20), nullable=False, default="pending",
                              server_default="pending")

    approved_by_id   = Column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at      = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String(1000), nullable=True)
    admin_note       = Column(String(1000), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
