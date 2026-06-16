"""
Lokale Benachrichtigungs-Automation: Mitarbeiter die zu lange eingecheckt sind.

Endpunkte:
  GET  /admin/notifications/long-checkins?hours=12   → offene Eincheck-Liste
  GET  /admin/notifications/settings                 → aktuelle Einstellungen
  PUT  /admin/notifications/settings                 → Einstellungen speichern
  POST /admin/notifications/check                    → manuelle Prüfung + Mail-Versand
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.app_setting import AppSetting
from app.services.email_service import is_smtp_configured, send_email

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/notifications", tags=["notifications"])

# ── Einstellungs-Schlüssel ─────────────────────────────────────────────────
KEY_ENABLED = "checkin_alert_enabled"
KEY_HOURS   = "checkin_alert_hours"
KEY_EMAIL   = "checkin_alert_email"
DEFAULT_HOURS = 12


# ── Schemas ───────────────────────────────────────────────────────────────
class LongCheckinRow(BaseModel):
    employee_id:   int
    employee_name: str
    checkin_time:  datetime
    hours_elapsed: float


class NotifSettings(BaseModel):
    enabled: bool
    hours:   int
    email:   str


class CheckResult(BaseModel):
    checked:    bool
    alerts:     list[LongCheckinRow]
    email_sent: bool
    email_to:   Optional[str]
    smtp_ready: bool


# ── Hilfsfunktionen ──────────────────────────────────────────────────────
def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppSetting, key)
    return row.value if row else default


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    db.commit()


def _find_long_checkins(db: Session, threshold_hours: int) -> list[LongCheckinRow]:
    now_utc = datetime.now(UTC)

    latest_sub = (
        select(Attendance.employee_id, func.max(Attendance.created_at).label("latest"))
        .group_by(Attendance.employee_id)
        .subquery()
    )
    open_checkins = db.scalars(
        select(Attendance)
        .join(
            latest_sub,
            (Attendance.employee_id == latest_sub.c.employee_id)
            & (Attendance.created_at == latest_sub.c.latest),
        )
        .where(Attendance.log_type == "checkin")
    ).all()

    result: list[LongCheckinRow] = []
    for checkin in open_checkins:
        emp = db.get(Employee, checkin.employee_id)
        if emp is None or not emp.is_active:
            continue

        ci_time = checkin.created_at
        if ci_time.tzinfo is None:
            ci_time = ci_time.replace(tzinfo=UTC)

        elapsed_hours = (now_utc - ci_time).total_seconds() / 3600
        if elapsed_hours >= threshold_hours:
            result.append(
                LongCheckinRow(
                    employee_id=emp.id,
                    employee_name=emp.name,
                    checkin_time=ci_time,
                    hours_elapsed=round(elapsed_hours, 1),
                )
            )

    return sorted(result, key=lambda r: r.hours_elapsed, reverse=True)


def _build_email_html(alerts: list[LongCheckinRow], threshold_hours: int) -> str:
    rows = ""
    for a in alerts:
        checkin_local = a.checkin_time.strftime("%d.%m.%Y %H:%M")
        rows += (
            f"<tr>"
            f"<td style='padding:8px;border:1px solid #ddd'>{a.employee_name}</td>"
            f"<td style='padding:8px;border:1px solid #ddd'>{checkin_local} Uhr</td>"
            f"<td style='padding:8px;border:1px solid #ddd;color:#c0392b'>"
            f"<b>{a.hours_elapsed:.1f} Std.</b></td>"
            f"</tr>"
        )
    return f"""
    <html><body style='font-family:Arial,sans-serif;color:#333'>
    <h2 style='color:#1e3a5f'>⚠️ Lange Eincheck-Warnung</h2>
    <p>Folgende Mitarbeiter sind seit mehr als <b>{threshold_hours} Stunden</b>
       eingecheckt ohne auszuchecken:</p>
    <table style='border-collapse:collapse;width:100%;max-width:600px'>
      <thead>
        <tr style='background:#1e3a5f;color:white'>
          <th style='padding:10px;text-align:left'>Mitarbeiter</th>
          <th style='padding:10px;text-align:left'>Eincheck-Zeit</th>
          <th style='padding:10px;text-align:left'>Dauer</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
    <p style='margin-top:20px;color:#666;font-size:12px'>
      Diese E-Mail wurde automatisch vom Time Stemple System gesendet.
    </p>
    </body></html>
    """


# ── Endpunkte ────────────────────────────────────────────────────────────
@router.get("/long-checkins", response_model=list[LongCheckinRow])
def list_long_checkins(
    hours: int = DEFAULT_HOURS,
    db:    Session  = Depends(get_db),
    _:     Employee = Depends(require_admin),
):
    """Gibt alle Mitarbeiter zurück, die länger als `hours` Stunden eingecheckt sind."""
    return _find_long_checkins(db, hours)


@router.get("/settings", response_model=NotifSettings)
def get_settings(
    db: Session  = Depends(get_db),
    _:  Employee = Depends(require_admin),
):
    return NotifSettings(
        enabled=_get_setting(db, KEY_ENABLED, "false").lower() == "true",
        hours=int(_get_setting(db, KEY_HOURS, str(DEFAULT_HOURS))),
        email=_get_setting(db, KEY_EMAIL, ""),
    )


@router.put("/settings", response_model=NotifSettings)
def save_settings(
    payload: NotifSettings,
    db:      Session  = Depends(get_db),
    _:       Employee = Depends(require_admin),
):
    _set_setting(db, KEY_ENABLED, "true" if payload.enabled else "false")
    _set_setting(db, KEY_HOURS,   str(max(1, payload.hours)))
    _set_setting(db, KEY_EMAIL,   payload.email.strip())
    return payload


@router.post("/check", response_model=CheckResult)
def run_check(
    db: Session  = Depends(get_db),
    _:  Employee = Depends(require_admin),
):
    """Manuelle Prüfung: findet lange Einchecks und sendet bei Bedarf eine E-Mail."""
    threshold = int(_get_setting(db, KEY_HOURS, str(DEFAULT_HOURS)))
    email_to  = _get_setting(db, KEY_EMAIL, "")
    smtp_ok   = is_smtp_configured()

    alerts = _find_long_checkins(db, threshold)
    email_sent = False

    if alerts and email_to and smtp_ok:
        try:
            html = _build_email_html(alerts, threshold)
            send_email(
                to=email_to,
                subject=f"⚠️ {len(alerts)} Mitarbeiter seit >{threshold}h eingecheckt",
                html_body=html,
            )
            email_sent = True
        except Exception:
            logger.exception("Fehler beim E-Mail-Versand")

    return CheckResult(
        checked=True,
        alerts=alerts,
        email_sent=email_sent,
        email_to=email_to or None,
        smtp_ready=smtp_ok,
    )
