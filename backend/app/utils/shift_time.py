"""
Zentrale Helferfunktionen für Schicht-Zeitfenster.

Nachtschichten (``end_time < start_time``) enden am Kalendertag nach
``shift_date``. Diese Fallunterscheidung darf nur an einer Stelle
implementiert sein, damit Geofencing (`app.geofence`) und die
Überfällig-Checkout-Logik (`app.routes.approvals`) sich nicht
auseinanderentwickeln.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, tzinfo as TzInfo

from app.models.planning import ShiftPlan

# Wie früh ein Check-in vor dem geplanten Schichtbeginn noch dieser Schicht
# zugeordnet wird (Mitarbeiter kommen typischerweise etwas früher).
EARLY_CHECKIN_TOLERANCE = timedelta(minutes=45)


def is_overnight_shift(start_time: time, end_time: time) -> bool:
    """True, wenn die Schicht über Mitternacht geht (Ende <= Start)."""
    return end_time <= start_time


def get_shift_end_date(shift_date: date, start_time: time, end_time: time) -> date:
    """Kalendertag, auf den das Schichtende fällt (inkl. Nachtschicht-Überlauf)."""
    if is_overnight_shift(start_time, end_time):
        return shift_date + timedelta(days=1)
    return shift_date


def get_shift_start_datetime(shift: ShiftPlan, tz: TzInfo) -> datetime:
    """Zeitzonen-bewusster Start der Schicht."""
    return datetime.combine(shift.shift_date, shift.start_time, tzinfo=tz)


def get_shift_end_datetime(shift: ShiftPlan, tz: TzInfo) -> datetime:
    """
    Zeitzonen-bewusstes Ende der Schicht.

    Bei ``end_time <= start_time`` handelt es sich um eine Nachtschicht,
    deren Ende auf den Folgetag von ``shift_date`` fällt.
    """
    end_date = get_shift_end_date(shift.shift_date, shift.start_time, shift.end_time)
    return datetime.combine(end_date, shift.end_time, tzinfo=tz)


def shift_matches_time(
    shift: ShiftPlan,
    when: datetime,
    tz: TzInfo,
    *,
    early_tolerance: timedelta = timedelta(0),
) -> bool:
    """
    True, wenn ``when`` innerhalb ``[start, end]`` dieser Schicht liegt
    (inkl. Nachtschicht). ``early_tolerance`` erlaubt zusätzlich einen
    Zeitraum vor dem geplanten Start (z. B. Mitarbeiter, die kurz vor
    Schichtbeginn einchecken). Standardmäßig ``0`` (kein früherer Match),
    damit z. B. Geofencing-Prüfungen unverändert bleiben.
    """
    when_local = when.astimezone(tz)
    start_dt = get_shift_start_datetime(shift, tz) - early_tolerance
    end_dt = get_shift_end_datetime(shift, tz)
    return start_dt <= when_local <= end_dt
