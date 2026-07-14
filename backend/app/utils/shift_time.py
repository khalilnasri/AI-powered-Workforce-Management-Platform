"""
Zentrale Helferfunktionen für Schicht-Zeitfenster.

Nachtschichten (``end_time < start_time``) enden am Kalendertag nach
``shift_date``. Diese Fallunterscheidung darf nur an einer Stelle
implementiert sein, damit Geofencing (`app.geofence`) und die
Überfällig-Checkout-Logik (`app.routes.approvals`) sich nicht
auseinanderentwickeln.
"""

from __future__ import annotations

from datetime import datetime, timedelta, tzinfo as TzInfo

from app.models.planning import ShiftPlan


def get_shift_start_datetime(shift: ShiftPlan, tz: TzInfo) -> datetime:
    """Zeitzonen-bewusster Start der Schicht."""
    return datetime.combine(shift.shift_date, shift.start_time, tzinfo=tz)


def get_shift_end_datetime(shift: ShiftPlan, tz: TzInfo) -> datetime:
    """
    Zeitzonen-bewusstes Ende der Schicht.

    Bei ``end_time <= start_time`` handelt es sich um eine Nachtschicht,
    deren Ende auf den Folgetag von ``shift_date`` fällt.
    """
    end_date = shift.shift_date
    if shift.end_time <= shift.start_time:
        end_date += timedelta(days=1)
    return datetime.combine(end_date, shift.end_time, tzinfo=tz)


def shift_matches_time(shift: ShiftPlan, when: datetime, tz: TzInfo) -> bool:
    """True, wenn ``when`` innerhalb ``[start, end]`` dieser Schicht liegt (inkl. Nachtschicht)."""
    when_local = when.astimezone(tz)
    start_dt = get_shift_start_datetime(shift, tz)
    end_dt = get_shift_end_datetime(shift, tz)
    return start_dt <= when_local <= end_dt
