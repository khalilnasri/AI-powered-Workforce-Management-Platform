"""Monats-Soll-Stunden aus Beschäftigungsart (Admin-konfigurierbar)."""

from __future__ import annotations

from app.models.employee import Employee

_MONTHLY_TARGETS = {
    "full_time": 160,
    "part_time_80": 80,
    "part_time_120": 120,
}

_DEFAULT_MINIJOB_HOURS = 43


def resolved_month_target_hours(emp: Employee) -> int:
    """
    Soll-Stunden für den laufenden Monat (Anzeige / Abweichung).

    Wenn ``target_hours_month`` gesetzt ist (1–200), gilt dieser Wert für **jede**
    Beschäftigungsart (Admin-Überschreibung). Sonst: Vollzeit 160, Teilzeit 80/120,
    Minijob 43.
    """
    custom = getattr(emp, "target_hours_month", None)
    if custom is not None and int(custom) > 0:
        return max(1, min(int(custom), 200))
    et = (getattr(emp, "employment_type", None) or "full_time").strip().lower()
    if et == "minijob":
        return _DEFAULT_MINIJOB_HOURS
    return int(_MONTHLY_TARGETS.get(et, 160))


def normalize_employment_type(raw: str | None) -> str:
    v = (raw or "full_time").strip().lower()
    if v in ("full_time", "part_time_80", "part_time_120", "minijob"):
        return v
    return "full_time"
