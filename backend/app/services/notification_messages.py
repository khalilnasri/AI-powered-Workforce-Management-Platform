"""Deutsche Benachrichtigungstexte für Admin-Aktionen (Titel + Detail-Body)."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from app.models.employee import Employee
from app.models.planning import ShiftPlan
from app.models.work_session import WorkSession

_BERLIN = ZoneInfo("Europe/Berlin")


def admin_name(admin: Employee) -> str:
    return (admin.name or "Administration").strip()


def _to_berlin(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(_BERLIN)


def _fmt_date(dt: datetime | date) -> str:
    if isinstance(dt, datetime):
        return _to_berlin(dt).strftime("%d.%m.%Y")
    return dt.strftime("%d.%m.%Y")


def _fmt_time(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    return _to_berlin(dt).strftime("%H:%M")


def _fmt_duration(seconds: int) -> str:
    s = max(0, int(seconds))
    h = s // 3600
    m = (s % 3600) // 60
    if h and m:
        return f"{h} Std. {m} Min."
    if h:
        return f"{h} Std."
    return f"{m} Min."


def _fmt_shift_slot(shift_date: date, start: time, end: time) -> str:
    return f"{shift_date:%d.%m.%Y} · {start:%H:%M}–{end:%H:%M} Uhr"


def _managed_by(admin: Employee) -> str:
    return f"Verwaltet von {admin_name(admin)}"


def _leave_range(start: date, end: date) -> str:
    if start == end:
        return _fmt_date(start)
    return f"{_fmt_date(start)} – {_fmt_date(end)}"


# ── Arbeitszeit (WorkSession) ───────────────────────────────────────────────

def session_approved(session: WorkSession, admin: Employee) -> tuple[str, str, str]:
    day = _fmt_date(session.checkin_time)
    body = (
        f"{_managed_by(admin)} · Arbeitszeit genehmigt.\n"
        f"Datum: {day}\n"
        f"Zeit: {_fmt_time(session.checkin_time)} – {_fmt_time(session.checkout_time)} Uhr\n"
        f"Dauer: {_fmt_duration(session.duration_seconds)}"
    )
    return ("session.approved", f"Arbeitszeit genehmigt ({day})", body)


def session_rejected(session: WorkSession, admin: Employee, reason: str) -> tuple[str, str, str]:
    day = _fmt_date(session.checkin_time)
    body = (
        f"{_managed_by(admin)} · Arbeitszeit abgelehnt.\n"
        f"Datum: {day}\n"
        f"Zeit: {_fmt_time(session.checkin_time)} – {_fmt_time(session.checkout_time)} Uhr\n"
        f"Grund: {reason.strip()}"
    )
    return ("session.rejected", f"Arbeitszeit abgelehnt ({day})", body)


def session_corrected(
    session: WorkSession,
    admin: Employee,
    *,
    old_checkin: datetime,
    old_checkout: datetime | None,
    old_duration: int,
    admin_note: str | None,
) -> tuple[str, str, str]:
    day = _fmt_date(session.checkin_time)
    lines = [
        f"{_managed_by(admin)} · Arbeitszeit korrigiert.",
        f"Datum: {day}",
        f"Neu: {_fmt_time(session.checkin_time)} – {_fmt_time(session.checkout_time)} Uhr "
        f"({_fmt_duration(session.duration_seconds)})",
        f"Vorher: {_fmt_time(old_checkin)} – {_fmt_time(old_checkout)} Uhr "
        f"({_fmt_duration(old_duration)})",
    ]
    if admin_note and admin_note.strip():
        lines.append(f"Notiz: {admin_note.strip()}")
    return ("session.corrected", f"Arbeitszeit korrigiert ({day})", "\n".join(lines))


def session_deleted(session: WorkSession, admin: Employee) -> tuple[str, str, str]:
    day = _fmt_date(session.checkin_time)
    body = (
        f"{_managed_by(admin)} · Zeiteintrag gelöscht.\n"
        f"Datum: {day}\n"
        f"Zeit: {_fmt_time(session.checkin_time)} – {_fmt_time(session.checkout_time)} Uhr\n"
        f"Dauer: {_fmt_duration(session.duration_seconds)}"
    )
    return ("session.deleted", f"Zeiteintrag gelöscht ({day})", body)


def attendance_reminder(admin: Employee, checkin_at: datetime) -> tuple[str, str, str]:
    body = (
        f"{_managed_by(admin)} · Erinnerung zum Ausstempeln.\n"
        f"Du bist seit {_fmt_time(checkin_at)} Uhr ({_fmt_date(checkin_at)}) eingestempelt.\n"
        f"Bitte stemple aus, sobald deine Schicht beendet ist."
    )
    return ("attendance.reminder", "Erinnerung: Bitte ausstempeln", body)


def attendance_force_checkout(
    admin: Employee,
    checkin_at: datetime,
    checkout_at: datetime,
    duration_seconds: int,
) -> tuple[str, str, str]:
    day = _fmt_date(checkin_at)
    body = (
        f"{_managed_by(admin)} · Automatischer Checkout durch Admin.\n"
        f"Datum: {day}\n"
        f"Einstempeln: {_fmt_time(checkin_at)} Uhr\n"
        f"Ausstempeln: {_fmt_time(checkout_at)} Uhr\n"
        f"Dauer: {_fmt_duration(duration_seconds)}\n"
        f"Der Eintrag wartet auf deine Prüfung unter Arbeitszeit."
    )
    return ("attendance.force_checkout", f"Admin-Checkout ({day})", body)


# ── Urlaub ────────────────────────────────────────────────────────────────────

def leave_approved(start: date, end: date, admin: Employee) -> tuple[str, str, str]:
    period = _leave_range(start, end)
    body = (
        f"{_managed_by(admin)} · Urlaubsantrag genehmigt.\n"
        f"Zeitraum: {period}"
    )
    return ("leave.approved", f"Urlaub genehmigt ({period})", body)


def leave_rejected(start: date, end: date, admin: Employee, reason: str) -> tuple[str, str, str]:
    period = _leave_range(start, end)
    body = (
        f"{_managed_by(admin)} · Urlaubsantrag abgelehnt.\n"
        f"Zeitraum: {period}\n"
        f"Grund: {reason.strip()}"
    )
    return ("leave.rejected", f"Urlaub abgelehnt ({period})", body)


# ── Schichtplanung ────────────────────────────────────────────────────────────

def shift_assigned(
    shift: ShiftPlan,
    admin: Employee,
    *,
    location_name: str | None = None,
) -> tuple[str, str, str]:
    slot = _fmt_shift_slot(shift.shift_date, shift.start_time, shift.end_time)
    lines = [
        f"{_managed_by(admin)} · Neue Schicht eingetragen.",
        f"Termin: {slot}",
    ]
    if location_name:
        lines.append(f"Standort: {location_name}")
    if shift.note and shift.note.strip():
        lines.append(f"Notiz: {shift.note.strip()}")
    return ("shift.assigned", f"Neue Schicht ({shift.shift_date:%d.%m.%Y})", "\n".join(lines))


def shift_updated(
    shift: ShiftPlan,
    admin: Employee,
    *,
    location_name: str | None = None,
) -> tuple[str, str, str]:
    slot = _fmt_shift_slot(shift.shift_date, shift.start_time, shift.end_time)
    lines = [
        f"{_managed_by(admin)} · Schicht geändert.",
        f"Neuer Termin: {slot}",
    ]
    if location_name:
        lines.append(f"Standort: {location_name}")
    if shift.note and shift.note.strip():
        lines.append(f"Notiz: {shift.note.strip()}")
    return ("shift.updated", f"Schicht geändert ({shift.shift_date:%d.%m.%Y})", "\n".join(lines))


def shift_deleted(
    shift_date: date,
    start: time,
    end: time,
    admin: Employee,
    *,
    location_name: str | None = None,
) -> tuple[str, str, str]:
    slot = _fmt_shift_slot(shift_date, start, end)
    lines = [
        f"{_managed_by(admin)} · Geplante Schicht entfernt.",
        f"Termin: {slot}",
    ]
    if location_name:
        lines.append(f"Standort: {location_name}")
    return ("shift.deleted", f"Schicht entfernt ({shift_date:%d.%m.%Y})", "\n".join(lines))
