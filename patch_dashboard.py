import sys

filepath = r'C:\Users\khali\Desktop\time-stemple-app\frontend\src\pages\AdminDashboard.jsx'

with open(filepath, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Add useMemo to imports
old_import = 'import { useCallback, useEffect, useState } from "react";'
new_import = 'import { useCallback, useEffect, useMemo, useState } from "react";'
if old_import not in c:
    print("ERROR: import not found"); sys.exit(1)
c = c.replace(old_import, new_import)
print("Step 1 OK: useMemo added")

# 2. Add todayEmployees after locationName
old_loc = '  function locationName(id) {\n    if (!id) return "—";\n    return locations.find((l) => l.id === id)?.name ?? `#${id}`;\n  }'
extra = '''
  const todayEmployees = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const byKey = {};
    for (const rec of attendance) {
      const d = new Date(rec.created_at);
      if (d < todayStart) continue;
      const key = rec.employee_email ?? rec.employee_name;
      if (!byKey[key]) byKey[key] = { name: rec.employee_name, email: rec.employee_email, checkIns: [], checkOuts: [] };
      if (rec.type === "checkin") byKey[key].checkIns.push(d);
      else if (rec.type === "checkout") byKey[key].checkOuts.push(d);
    }
    return Object.values(byKey).map((emp) => {
      const lastIn  = emp.checkIns.length  > 0 ? new Date(Math.max(...emp.checkIns.map(Number)))  : null;
      const lastOut = emp.checkOuts.length > 0 ? new Date(Math.max(...emp.checkOuts.map(Number))) : null;
      const active = lastIn != null && (lastOut == null || lastIn > lastOut);
      let workSecs = null;
      if (lastIn && lastOut && lastOut > lastIn) workSecs = (lastOut - lastIn) / 1000;
      else if (lastIn && active) workSecs = (Date.now() - lastIn) / 1000;
      const employee = employees.find((e) => e.email === emp.email);
      const locId = employee?.assigned_location_id;
      const loc = locId ? locations.find((l) => l.id === locId) : (locations.length > 0 ? locations[0] : null);
      return {
        name: emp.name,
        checkIn:  lastIn  ? lastIn.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : null,
        checkOut: !active && lastOut ? lastOut.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : null,
        workSecs,
        active,
        location: loc?.name ?? "—",
      };
    }).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  }, [attendance, employees, locations]);

  const totalWorkSecsToday = useMemo(
    () => todayEmployees.reduce((s, e) => s + (e.workSecs ?? 0), 0),
    [todayEmployees]
  );
'''
if old_loc not in c:
    print("ERROR: locationName not found")
    print("Searching for nearby text...")
    idx = c.find("function locationName")
    if idx >= 0:
        print(repr(c[idx:idx+200]))
    sys.exit(1)
c = c.replace(old_loc, old_loc + extra)
print("Step 2 OK: todayEmployees added")

# 3. Replace dashboard section
# Find start and end
dash_start = '{activeSection === "dashboard" && ('
emp_start  = '{activeSection === "employees" && ('
i_start = c.find(dash_start)
i_end   = c.find(emp_start)
if i_start < 0 or i_end < 0:
    print(f"ERROR: section markers not found (dash={i_start}, emp={i_end})"); sys.exit(1)

old_section = c[i_start:i_end]
print(f"Dashboard section: {len(old_section)} chars")

new_section = '''{activeSection === "dashboard" && (
            <div className="ad-section">
              <div className="ad-stats-grid">
                <StatCard
                  icon="users"
                  label="Mitarbeiter"
                  value={statistics?.total_employees ?? 0}
                  color="blue"
                  sub="Aktive Mitarbeiter"
                />
                <StatCard
                  icon="check"
                  label="Heute eingestempelt"
                  value={statistics?.active_now ?? 0}
                  color="green"
                  sub={statistics?.total_employees ? `${Math.round((statistics.active_now / statistics.total_employees) * 100)}%` : "0%"}
                />
                <StatCard
                  icon="clock"
                  label="Aktuelle Arbeitszeit"
                  value={formatSeconds(totalWorkSecsToday)}
                  color="purple"
                  sub="Gesamte Arbeitszeit"
                />
                <StatCard
                  icon="chart"
                  label="Überstunden (diese Woche)"
                  value={statistics?.overtime_hours != null ? formatSeconds(statistics.overtime_hours * 3600) : "0h 00m"}
                  color="orange"
                  sub="Gesamte Überstunden"
                />
              </div>

              <div className="ad-dashboard-grid">
                <Card className="ad-card--grow">
                  <SectionTitle title="Aktuelle Mitarbeiter (heute)" />
                  <div className="ad-table-wrap">
                    <table className="ad-table">
                      <thead>
                        <tr>
                          <th>Mitarbeiter</th>
                          <th>Check-In</th>
                          <th>Check-Out</th>
                          <th>Arbeitszeit</th>
                          <th>Status</th>
                          <th>Standort</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayEmployees.length === 0 ? (
                          <tr><td colSpan={6} className="ad-empty">Heute noch niemand eingestempelt.</td></tr>
                        ) : todayEmployees.map((row, i) => (
                          <tr key={i}>
                            <td>
                              <div className="ad-user-cell">
                                <span
                                  className="ad-user-cell__avatar"
                                  style={row.active ? {} : { background: "#94a3b8" }}
                                >
                                  {row.name[0]?.toUpperCase()}
                                </span>
                                <strong>{row.name}</strong>
                              </div>
                            </td>
                            <td>{row.checkIn ?? "—"}</td>
                            <td>{row.checkOut ?? "—"}</td>
                            <td>{row.workSecs != null ? formatSeconds(row.workSecs) : "—"}</td>
                            <td>
                              <span className={`ad-badge ${row.active ? "ad-badge--green" : "ad-badge--gray"}`}>
                                {row.active ? "Eingestempelt" : "Ausgestempelt"}
                              </span>
                            </td>
                            <td>
                              <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.active ? "#22c55e" : "#94a3b8", flexShrink: 0, display: "inline-block" }} />
                                {row.location}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card className="ad-card--sidebar">
                  <SectionTitle title="Standorte" />
                  {locations.length > 0 ? (
                    <>
                      <div className="ad-mini-map-wrap">
                        <MapContainer center={[locations[0].lat, locations[0].lng]} zoom={14} className="ad-mini-map">
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                          <Marker position={[locations[0].lat, locations[0].lng]} />
                          {locations.map((loc) => (
                            <Circle key={loc.id} center={[loc.lat, loc.lng]} radius={loc.radius_meters}
                              pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.15 }} />
                          ))}
                        </MapContainer>
                      </div>
                      <div style={{ marginTop: "0.75rem" }}>
                        <p style={{ margin: "0 0 0.2rem", fontWeight: 700, color: "#0f172a", fontSize: "0.9rem" }}>
                          {locations[0].name}
                        </p>
                        {locations[0].address && (
                          <p style={{ margin: "0 0 0.2rem", fontSize: "0.82rem", color: "#64748b" }}>
                            {locations[0].address}
                          </p>
                        )}
                        <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "#64748b" }}>
                          Radius: {locations[0].radius_meters} m
                        </p>
                        <button
                          className="ad-btn ad-btn--ghost ad-btn--sm"
                          onClick={() => setActiveSection("locations")}
                        >
                          Standort bearbeiten
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="ad-empty" style={{ padding: "1rem 0" }}>Keine Standorte angelegt.</p>
                  )}
                </Card>
              </div>
            </div>
          )}

          '''

c = c.replace(old_section, new_section)
print("Step 3 OK: dashboard section replaced")

with open(filepath, 'w', encoding='utf-8', newline='') as f:
    f.write(c)
print("File saved successfully!")
