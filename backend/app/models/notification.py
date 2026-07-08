from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, func

from app.config.database import Base


class Notification(Base):
    """
    Benachrichtigung an einen Mitarbeiter über eine Admin-Aktion
    (Genehmigung, Ablehnung, Korrektur, Schichtplanung, Urlaubsentscheidung, ...).

    ``type`` ist ein einfacher String (kein natives DB-Enum, analog zu
    ``WorkSession.status``/``Employee.role``), damit neue Benachrichtigungs-
    typen ohne Schema-Migration ergänzt werden können.

    ``entity_type``/``entity_id`` referenzieren die auslösende Zeile
    (work_session | shift_plan | leave_request) ohne DB-FK-Constraint, damit
    künftige Entitätstypen keine neue Spalte/Migration brauchen.
    """

    __tablename__ = "notifications"

    id          = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    type  = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    body  = Column(String(1000), nullable=True)

    entity_type = Column(String(30), nullable=True)
    entity_id   = Column(Integer, nullable=True)

    actor_id = Column(
        Integer, ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
    )

    read_at    = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_notifications_employee_read", "employee_id", "read_at"),
        Index("ix_notifications_employee_created", "employee_id", "created_at"),
    )
