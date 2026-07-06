"""
Umfassender Test: Mitarbeiter, Standorte, Schichten, Check-in/out, Zeitberechnung.

Ausfuehren (Backend auf :8000):
  cd backend && python scripts/test_workforce_combinations.py
"""
from __future__ import annotations

import sys
import time
import uuid
from datetime import date, datetime, time as dt_time
from zoneinfo import ZoneInfo

import requests

BASE = "http://127.0.0.1:8000"
BERLIN = ZoneInfo("Europe/Berlin")
COMPANY_LAT = 52.40059713060576
COMPANY_LNG = 9.665570295954318
FAR_LAT, FAR_LNG = 53.0, 11.0  # weit weg
ALT_LAT, ALT_LNG = 52.4100, 9.6800  # zweiter Standort ~1km entfernt
PWD = "TestPass1!"

RESULTS: list[dict] = []


def rec(cat: str, case: str, ok: bool, detail: str, extra: str = ""):
    RESULTS.append({"cat": cat, "case": case, "ok": ok, "detail": detail, "extra": extra})


class Client:
    def __init__(self):
        self.s = requests.Session()
        self.token: str | None = None

    def set_token(self, t: str | None):
        self.token = t
        if t:
            self.s.headers["Authorization"] = f"Bearer {t}"
        elif "Authorization" in self.s.headers:
            del self.s.headers["Authorization"]

    def req(self, method: str, path: str, **kw) -> requests.Response:
        return self.s.request(method, f"{BASE}{path}", timeout=15, **kw)

    def login(self, email: str, password: str) -> bool:
        r = self.req("POST", "/auth/login", json={"email": email, "password": password})
        if r.status_code == 200:
            self.set_token(r.json()["access_token"])
            return True
        return False

    def msg(self, r: requests.Response) -> str:
        try:
            j = r.json()
            return str(j.get("message") or j.get("detail") or j)
        except Exception:
            return r.text[:120]


def shift_window_today() -> tuple[str, str]:
    """Schicht die jetzt aktiv ist (Berlin)."""
    return "00:00:00", "23:59:00"


def main() -> int:
    try:
        if requests.get(f"{BASE}/health", timeout=5).status_code != 200:
            print("Backend nicht erreichbar")
            return 1
    except requests.RequestException:
        print("Backend nicht erreichbar auf", BASE)
        return 1

    admin = Client()
    if not admin.login("khalilnasri@gmail.com", "123456789"):
        rec("Setup", "Admin-Login", False, "Demo-Admin nicht verfuegbar")
        print_summary()
        return 1
    rec("Setup", "Admin-Login", True, "OK")

    uid = uuid.uuid4().hex[:8]
    emp_email = f"wf_test_{uid}@example.com"
    emp_name = f"WF Test {uid}"

    # --- Standorte anlegen ---
    loc_a = admin.req("POST", "/admin/locations", json={
        "name": f"Test Standort A {uid}",
        "address": "Hannover A",
        "lat": COMPANY_LAT,
        "lng": COMPANY_LNG,
        "radius_meters": 200,
    })
    loc_b = admin.req("POST", "/admin/locations", json={
        "name": f"Test Standort B {uid}",
        "address": "Hannover B",
        "lat": ALT_LAT,
        "lng": ALT_LNG,
        "radius_meters": 150,
    })
    ok_locs = loc_a.status_code == 201 and loc_b.status_code == 201
    rec("Standort", "Zwei Standorte anlegen", ok_locs, admin.msg(loc_a) if not ok_locs else "201")
    if not ok_locs:
        print_summary()
        return 1
    loc_a_id = loc_a.json()["id"]
    loc_b_id = loc_b.json()["id"]

    # --- Mitarbeiter anlegen ---
    cr = admin.req("POST", "/admin/employees", json={
        "name": emp_name,
        "email": emp_email,
        "password": PWD,
    })
    rec("Mitarbeiter", "Mitarbeiter anlegen (Admin)", cr.status_code == 201, admin.msg(cr))
    if cr.status_code != 201:
        print_summary()
        return 1
    emp_id = cr.json()["id"]

    emp = Client()
    if not emp.login(emp_email, PWD):
        rec("Mitarbeiter", "Mitarbeiter-Login", False, "Login fehlgeschlagen")
        print_summary()
        return 1
    rec("Mitarbeiter", "Mitarbeiter-Login", True, "OK")

    inside = {"lat": COMPANY_LAT, "lng": COMPANY_LNG}
    inside_b = {"lat": ALT_LAT, "lng": ALT_LNG}
    outside = {"lat": FAR_LAT, "lng": FAR_LNG}

    # =====================================================================
    # A) Kein Standort zugewiesen — Geofence = alle Standorte in DB
    # =====================================================================
    st = emp.req("GET", "/attendance/status")
    rec("Status", "Initial: ausgecheckt", st.status_code == 200 and st.json().get("can_checkin") is True,
        str(st.json()) if st.status_code == 200 else admin.msg(st))

    r = emp.req("POST", "/attendance/checkin", json=inside)
    rec("Check-in", "A1: Innen (kein Standort zugewiesen)", r.status_code == 200, admin.msg(r))

    r2 = emp.req("POST", "/attendance/checkin", json=inside)
    rec("Check-in", "A2: Doppel-Check-in blockiert", r2.status_code == 400 and "twice" in admin.msg(r2).lower(),
        admin.msg(r2))

    r3 = emp.req("POST", "/attendance/checkout", json=outside)
    rec("Check-out", "A3: Checkout ausserhalb Geofence blockiert", r3.status_code == 400,
        admin.msg(r3))

    r4 = emp.req("POST", "/attendance/checkout", json=inside)
    rec("Check-out", "A4: Checkout innen erfolgreich", r4.status_code == 200, admin.msg(r4))

    r5 = emp.req("POST", "/attendance/checkout", json=inside)
    rec("Check-out", "A5: Doppel-Checkout blockiert", r5.status_code == 400, admin.msg(r5))

    wt = emp.req("GET", "/attendance/worked-time")
    if wt.status_code == 200:
        d = wt.json()
        rec("Zeit", "A6: Worked-time nach 1 Schicht", d.get("total_hours", 0) >= 0 and len(d.get("sessions", [])) >= 1,
            f"total_hours={d.get('total_hours')} sessions={len(d.get('sessions', []))} pending={d.get('pending_count')}")
    else:
        rec("Zeit", "A6: Worked-time", False, admin.msg(wt))

    ms = emp.req("GET", "/attendance/my-sessions")
    if ms.status_code == 200:
        sess = ms.json()
        rec("Zeit", "A7: WorkSession nach Checkout (pending)", len(sess) >= 1 and sess[0].get("status") == "pending",
            f"count={len(sess)} status={sess[0].get('status') if sess else '-'}")
    else:
        rec("Zeit", "A7: WorkSession", False, admin.msg(ms))

    # =====================================================================
    # B) Mitarbeiter nur Standort A zugewiesen
    # =====================================================================
    up = admin.req("PUT", f"/admin/employees/{emp_id}", json={
        "name": emp_name,
        "email": emp_email,
        "role": "employee",
        "phone": None,
        "is_active": True,
        "annual_leave_days": None,
        "employment_type": "full_time",
        "target_hours_month": None,
        "assigned_location_ids": [loc_a_id],
    })
    rec("Mitarbeiter", "B0: Nur Standort A zuweisen", up.status_code == 200, admin.msg(up))

    r = emp.req("POST", "/attendance/checkin", json=inside_b)
    rec("Check-in", "B1: Check-in Standort B (nicht freigegeben)", r.status_code == 403,
        admin.msg(r))

    r = emp.req("POST", "/attendance/checkin", json=inside)
    rec("Check-in", "B2: Check-in Standort A (freigegeben)", r.status_code == 200, admin.msg(r))

    r = emp.req("POST", "/attendance/checkout", json=inside)
    rec("Check-out", "B3: Checkout Standort A", r.status_code == 200, admin.msg(r))

    # =====================================================================
    # C) Schicht an Standort B — waehrend aktiver Schicht gilt Schicht-Standort
    # =====================================================================
    today = datetime.now(BERLIN).date().isoformat()
    t_start, t_end = shift_window_today()
    sh = admin.req("POST", "/planning/shifts", json={
        "employee_id": emp_id,
        "location_id": loc_b_id,
        "shift_date": today,
        "start_time": t_start,
        "end_time": t_end,
        "note": f"Testschicht {uid}",
    })
    rec("Schicht", "C0: Schicht heute an Standort B", sh.status_code == 201, admin.msg(sh))
    shift_id = sh.json().get("id") if sh.status_code == 201 else None

    # Mitarbeiter ist Standort A zugewiesen, aber aktive Schicht an B
    # Geofence: Schicht B -> muss bei B sein
    r = emp.req("POST", "/attendance/checkin", json=inside)
    rec("Check-in", "C1: Check-in A waehrend Schicht B (Geofence)", r.status_code == 400,
        admin.msg(r))

    r = emp.req("POST", "/attendance/checkin", json=inside_b)
    # Geofence OK at B, but assignment check: only A assigned -> 403
    rec("Check-in", "C2: Check-in B (Schicht B, Zuweisung nur A)", r.status_code == 403,
        admin.msg(r))

    # Zuweisung auch B hinzufuegen
    up2 = admin.req("PUT", f"/admin/employees/{emp_id}", json={
        "name": emp_name, "email": emp_email, "role": "employee",
        "phone": None, "is_active": True, "annual_leave_days": None,
        "employment_type": "full_time", "target_hours_month": None,
        "assigned_location_ids": [loc_a_id, loc_b_id],
    })
    rec("Mitarbeiter", "C3: Standort A+B zuweisen", up2.status_code == 200, admin.msg(up2))

    r = emp.req("POST", "/attendance/checkin", json=inside_b)
    rec("Check-in", "C4: Check-in B (Schicht B + Zuweisung A+B)", r.status_code == 200, admin.msg(r))

    r = emp.req("POST", "/attendance/checkout", json=inside_b)
    rec("Check-out", "C5: Checkout B", r.status_code == 200, admin.msg(r))

    # Schicht ohne Standort
    if shift_id:
        admin.req("DELETE", f"/planning/shifts/{shift_id}")
    sh2 = admin.req("POST", "/planning/shifts", json={
        "employee_id": emp_id,
        "location_id": None,
        "shift_date": today,
        "start_time": t_start,
        "end_time": t_end,
        "note": "Ohne Standort",
    })
    rec("Schicht", "C6: Schicht ohne Standort", sh2.status_code == 201, admin.msg(sh2))
    shift_id2 = sh2.json().get("id") if sh2.status_code == 201 else None

    # Ohne Schicht-Standort: wieder M2M-Standorte A+B
    r = emp.req("POST", "/attendance/checkin", json=inside)
    rec("Check-in", "C7: Check-in A (Schicht ohne Standort, Zuweisung A+B)", r.status_code == 200, admin.msg(r))
    r = emp.req("POST", "/attendance/checkout", json=inside)
    rec("Check-out", "C7b: Checkout A", r.status_code == 200, admin.msg(r))

    # =====================================================================
    # D) Schicht-Planung CRUD + my-shifts
    # =====================================================================
    lst = admin.req("GET", "/planning/shifts")
    rec("Schicht", "D1: Admin listet Schichten", lst.status_code == 200 and len(lst.json()) >= 1,
        f"count={len(lst.json()) if lst.status_code == 200 else 0}")

    my = emp.req("GET", "/planning/my-shifts")
    rec("Schicht", "D2: Mitarbeiter my-shifts", my.status_code == 200,
        f"count={len(my.json()) if my.status_code == 200 else 0}")

    bad = admin.req("POST", "/planning/shifts", json={
        "employee_id": 999999,
        "location_id": loc_a_id,
        "shift_date": today,
        "start_time": "08:00:00",
        "end_time": "16:00:00",
    })
    rec("Schicht", "D3: Ungueltiger Mitarbeiter", bad.status_code == 404, admin.msg(bad))

    bad2 = admin.req("POST", "/planning/shifts", json={
        "employee_id": emp_id,
        "location_id": 999999,
        "shift_date": today,
        "start_time": "08:00:00",
        "end_time": "16:00:00",
    })
    rec("Schicht", "D4: Ungueltiger Standort", bad2.status_code == 404, admin.msg(bad2))

    # =====================================================================
    # E) Zeitberechnung — mehrere Schichten am Tag
    # =====================================================================
  # ensure checked out
    emp.req("POST", "/attendance/checkout", json=inside)
    emp.req("POST", "/attendance/checkin", json=inside)
    time.sleep(1.1)
    emp.req("POST", "/attendance/checkout", json=inside)
    emp.req("POST", "/attendance/checkin", json=inside_b)
    time.sleep(1.1)
    emp.req("POST", "/attendance/checkout", json=inside_b)

    wt2 = emp.req("GET", "/attendance/worked-time")
    if wt2.status_code == 200:
        d = wt2.json()
        rec("Zeit", "E1: Mehrere Sessions total_hours>0", d.get("total_hours", 0) > 0,
            f"total_hours={d.get('total_hours')} official={d.get('official_hours')} pending_h={d.get('pending_hours')}")
        rec("Zeit", "E2: month_target_hours gesetzt", d.get("month_target_hours", 0) > 0,
            f"target={d.get('month_target_hours')}")
    else:
        rec("Zeit", "E1/E2", False, admin.msg(wt2))

  # =====================================================================
    # F) Checkout ohne Check-in
    # =====================================================================
    # Force checked-out state: if last is checkin, checkout first
    st2 = emp.req("GET", "/attendance/status")
    if st2.json().get("can_checkout"):
        emp.req("POST", "/attendance/checkout", json=inside)
    r = emp.req("POST", "/attendance/checkout", json=inside)
    rec("Check-out", "F1: Checkout ohne Check-in", r.status_code == 400, admin.msg(r))

    # =====================================================================
    # G) Admin Statistik / Mitarbeiterliste
    # =====================================================================
    el = admin.req("GET", "/admin/employees")
    found = any(e.get("id") == emp_id for e in el.json()) if el.status_code == 200 else False
    rec("Mitarbeiter", "G1: In Admin-Liste", el.status_code == 200 and found, f"found={found}")

    deact = admin.req("PATCH", f"/admin/employees/{emp_id}/deactivate")
    rec("Mitarbeiter", "G2: Deaktivieren", deact.status_code == 200, admin.msg(deact))

    emp2 = Client()
    emp2.login(emp_email, PWD)
    r = emp2.req("POST", "/attendance/checkin", json=inside)
    rec("Mitarbeiter", "G3: Deaktiviert: Check-in", r.status_code in (401, 403), admin.msg(r))

    # Cleanup
    if shift_id2:
        admin.req("DELETE", f"/planning/shifts/{shift_id2}")
    admin.req("DELETE", f"/admin/locations/{loc_a_id}")
    admin.req("DELETE", f"/admin/locations/{loc_b_id}")

    print_summary()
    failed = sum(1 for r in RESULTS if not r["ok"])
    return 1 if failed else 0


def print_summary():
    print("\n" + "=" * 80)
    print(f"{'OK':3} {'Kategorie':<14} {'Fall':<42} Detail")
    print("=" * 80)
    ok_n = fail_n = 0
    for row in RESULTS:
        mark = "OK" if row["ok"] else "FAIL"
        if row["ok"]:
            ok_n += 1
        else:
            fail_n += 1
        det = row["detail"][:50] + ("..." if len(row["detail"]) > 50 else "")
        print(f"{mark:4} {row['cat']:<14} {row['case']:<42} {det}")
        if row["extra"]:
            print(f"     {row['extra']}")
    print("=" * 80)
    print(f"Bestanden: {ok_n} | Fehlgeschlagen: {fail_n} | Gesamt: {len(RESULTS)}")


if __name__ == "__main__":
    sys.exit(main())
