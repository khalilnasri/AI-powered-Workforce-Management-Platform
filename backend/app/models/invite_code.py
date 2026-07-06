from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.config.database import Base


class InviteCode(Base):
    """Einmal-Code, mit dem sich neue Mitarbeiter selbst registrieren können."""

    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(16), unique=True, index=True, nullable=False)
    created_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # NULL = noch nicht eingelöst
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
