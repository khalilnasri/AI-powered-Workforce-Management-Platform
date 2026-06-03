import L from "leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link, useNavigate } from "react-router-dom";
import { apiClient, clearToken } from "../apiClient";
import "./AdminDashboard.css";

// ── Leaflet icon fix ────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── API URLs ────────────────────────────────────────────────────────────────
const EMPLOYEES_URL  = "/admin/employees";
const LOCATIONS_URL  = "/admin/locations";
const ATTENDANCE_URL = "/admin/attendance";
const STATISTICS_URL = "/admin/statistics";
const SHIFTS_URL     = "/planning/shifts";
const REPORTS_URL    = "/admin/reports/attendance";
const DEFAULT_CENTER = [52.4006, 9.6656];

// ── SVG Icons ───────────────────────────────────────────────────────────────
const Ico = {
  grid:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  users:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  clock:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  map:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  chart:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  gear:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  logout:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  bell:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  refresh: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  person:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  plus:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  check:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
  x:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  download:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  pin:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  search:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  arrow:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>,
  location:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>,
  brain:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>,
  sun:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  umbrella: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-6"/><path d="M4.5 10a7.5 7.5 0 0 1 15 0Z"/><path d="M2 10h20"/></svg>,
  warning:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
};

// ── Leaflet Helpers ─────────────────────────────────────────────────────────
function MapFlyTo({ position, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, zoom != null ? zoom : Math.max(map.getZoom(), 15));
  }, [position, zoom, map]);
  return null;
}
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

// ── Sidebar ─────────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: "Übersicht",
    items: [
      { id: "dashboard",  label: "Dashboard",     icon: "grid"  },
      { id: "employees",  label: "Mitarbeiter",   icon: "users" },
      { id: "attendance", label: "Zeiterfassung", icon: "clock" },
    ],
  },
  {
    label: "Verwaltung",
    items: [
      { id: "leaveRequests", label: "Urlaubanträge", icon: "umbrella" },
      { id: "locations", label: "Standorte",       icon: "map"      },
      { id: "planning",  label: "Planung",          icon: "calendar" },
      { id: "reports",   label: "Berichte",        icon: "chart"    },
      { id: "approvals", label: "Genehmigungen",   icon: "check"    },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "knowledge", label: "Wissensdatenbank", icon: "brain" },
      { id: "settings",  label: "Einstellungen",    icon: "gear"  },
    ],
  },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function Sidebar({ active, onNav, onLogout, pendingCount, leavePendingCount }) {
  return (
    <aside className="ad-sidebar">
      <div className="ad-sidebar__brand">
        <div className="ad-sidebar__brand-icon">⏱</div>
        <div className="ad-sidebar__brand-info">
          <span className="ad-sidebar__brand-name">Time Stemple</span>
          <span className="ad-sidebar__brand-sub">Workforce Management</span>
        </div>
      </div>
      <nav className="ad-sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="ad-sidebar__group-label">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`ad-sidebar__item${active === item.id ? " ad-sidebar__item--active" : ""}`}
                onClick={() => onNav(item.id)}
                title={item.label}
              >
                <span className="ad-sidebar__icon">{Ico[item.icon]}</span>
                <span className="ad-sidebar__label">{item.label}</span>
                {item.id === "approvals" && pendingCount > 0 && (
                  <span className="ad-sidebar__badge">{pendingCount}</span>
                )}
                {item.id === "leaveRequests" && leavePendingCount > 0 && (
                  <span className="ad-sidebar__badge">{leavePendingCount}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="ad-sidebar__footer">
        <button className="ad-sidebar__logout" onClick={onLogout}>
          <span className="ad-sidebar__icon">{Ico.logout}</span>
          <span>Abmelden</span>
        </button>
      </div>
    </aside>
  );
}

// ── Topbar ──────────────────────────────────────────────────────────────────
function Topbar({ section, user, onRefresh, busy, pendingCount }) {
  const label = NAV_ITEMS.find((n) => n.id === section)?.label ?? "Dashboard";
  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return (
    <header className="ad-topbar">
      <div className="ad-topbar__left">
        <h1 className="ad-topbar__title">{label}</h1>
        <span className="ad-topbar__date">{dateStr}</span>
      </div>

      <div className="ad-topbar__search">
        <span className="ad-topbar__search-icon">{Ico.search}</span>
        <input
          className="ad-topbar__search-input"
          placeholder="Mitarbeiter suchen..."
          readOnly
          tabIndex={-1}
        />
        <kbd className="ad-topbar__search-kbd">⌘K</kbd>
      </div>

      <div className="ad-topbar__right">
        <button
          className={`ad-topbar__icon-btn${busy ? " ad-topbar__icon-btn--spin" : ""}`}
          onClick={onRefresh}
          title="Aktualisieren"
        >
          {Ico.refresh}
        </button>
        <div className="ad-topbar__notif-wrap">
          <button className="ad-topbar__icon-btn" title="Benachrichtigungen" onClick={() => {}}>
            {Ico.bell}
          </button>
          {pendingCount > 0 && (
            <span className="ad-topbar__notif-badge">{pendingCount}</span>
          )}
        </div>
        <button className="ad-topbar__icon-btn" title="Design">
          {Ico.sun}
        </button>
        <div className="ad-topbar__divider" />
        <div className="ad-topbar__user">
          <div className="ad-topbar__avatar-wrap">
            <span className="ad-topbar__avatar">{user?.name?.[0]?.toUpperCase() ?? "A"}</span>
            <span className="ad-topbar__online-dot" />
          </div>
          <div className="ad-topbar__user-info">
            <span className="ad-topbar__user-name">{user?.name ?? "Admin"}</span>
            <span className="ad-topbar__user-role">{user?.role ?? "admin"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ values = [40, 55, 45, 70, 60, 80, 75], color = "blue" }) {
  const max = Math.max(...values, 1);
  return (
    <div className={`ad-sparkline ad-sparkline--${color}`}>
      {values.map((v, i) => (
        <div
          key={i}
          className="ad-sparkline__bar"
          style={{ height: `${Math.max(15, Math.round((v / max) * 100))}%`, opacity: 0.15 + (i / values.length) * 0.65 }}
        />
      ))}
    </div>
  );
}

// ── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color, sub, trend, live, sparkValues }) {
  return (
    <div className={`ad-stat-card ad-stat-card--${color}`}>
      <div className="ad-stat-card__header">
        <span className="ad-stat-card__label">{label}</span>
        <div className="ad-stat-card__icon">{Ico[icon]}</div>
      </div>
      <div className="ad-stat-card__value">{value}</div>
      <div className="ad-stat-card__footer">
        {live && <span className="ad-live-dot">Live</span>}
        {trend != null && (
          <span className={`ad-stat-trend ${trend > 0 ? "ad-stat-trend--up" : trend < 0 ? "ad-stat-trend--down" : "ad-stat-trend--neutral"}`}>
            {trend > 0 ? "↑" : trend < 0 ? "↓" : "→"} {Math.abs(trend)}%
          </span>
        )}
        {sub && <span className="ad-stat-card__sub">{sub}</span>}
        {sparkValues && <Sparkline values={sparkValues} color={color} />}
      </div>
    </div>
  );
}

// ── Quick Actions ─────────────────────────────────────────────────────────────
function QuickActions({ onNav }) {
  const actions = [
    { icon: "users",    label: "Mitarbeiter", section: "employees", color: "blue"   },
    { icon: "location", label: "Standort",    section: "locations", color: "green"  },
    { icon: "calendar", label: "Schicht",     section: "planning",  color: "purple" },
    { icon: "check",    label: "Genehmigen",  section: "approvals", color: "orange" },
  ];
  return (
    <Card>
      <div className="ad-card-header">
        <h3>Schnellaktionen</h3>
      </div>
      <div className="ad-quick-actions-row">
        {actions.map((a) => (
          <button
            key={a.section}
            className={`ad-qa-item ad-qa-item--${a.color}`}
            onClick={() => onNav(a.section)}
          >
            <span className="ad-qa-item__icon">{Ico[a.icon]}</span>
            <span className="ad-qa-item__label">{a.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Next Shifts Widget ────────────────────────────────────────────────────────
function NextShiftsWidget({ shifts, onNav }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => {
    return shifts
      .filter((s) => s.shift_date >= todayStr)
      .sort((a, b) => {
        if (a.shift_date !== b.shift_date) return a.shift_date.localeCompare(b.shift_date);
        return a.start_time.localeCompare(b.start_time);
      })
      .slice(0, 5);
  }, [shifts, todayStr]);

  return (
    <Card>
      <div className="ad-card-header">
        <h3>Nächste Schichten</h3>
        <button className="ad-btn ad-btn--ghost ad-btn--sm" onClick={() => onNav("planning")}>
          Alle →
        </button>
      </div>
      {upcoming.length === 0 ? (
        <div className="ad-empty-state">
          <div className="ad-empty-state__icon">{Ico.calendar}</div>
          <p className="ad-empty-state__title">Keine Schichten</p>
          <p className="ad-empty-state__sub">Noch keine Schichten geplant</p>
        </div>
      ) : (
        <div className="ad-shifts-widget">
          {upcoming.map((shift) => {
            const isToday = shift.shift_date === todayStr;
            const d = new Date(shift.shift_date + "T00:00:00");
            return (
              <div key={shift.id} className={`ad-shift-row${isToday ? " ad-shift-row--today" : ""}`}>
                <div className="ad-shift-row__date">
                  <span className="ad-shift-row__day-num">{d.getDate()}</span>
                  <span className="ad-shift-row__day-name">
                    {d.toLocaleDateString("de-DE", { weekday: "short" })}
                  </span>
                </div>
                <div className="ad-shift-row__info">
                  <span className="ad-shift-row__name">
                    {shift.employee_name ?? `#${shift.employee_id}`}
                  </span>
                  <div className="ad-shift-row__meta">
                    <span className="ad-shift-row__time">
                      {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                      {shift.end_time.slice(0, 5) < shift.start_time.slice(0, 5) && (
                        <span style={{ marginLeft: "0.3rem", fontSize: "0.65rem", fontWeight: 700, color: "#7c3aed", background: "#ede9fe", borderRadius: "4px", padding: "1px 5px" }}>Nacht</span>
                      )}
                    </span>
                    {shift.location_name && (
                      <span style={{ color: "var(--text-4)" }}>· {shift.location_name}</span>
                    )}
                  </div>
                </div>
                {isToday && <span className="ad-badge ad-badge--blue">Heute</span>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Next Shifts Content (inner content only, no Card wrapper) ─────────────────
function NextShiftsContent({ shifts }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(() => {
    return shifts
      .filter((s) => s.shift_date >= todayStr)
      .sort((a, b) => {
        if (a.shift_date !== b.shift_date) return a.shift_date.localeCompare(b.shift_date);
        return a.start_time.localeCompare(b.start_time);
      })
      .slice(0, 5);
  }, [shifts, todayStr]);

  if (upcoming.length === 0) {
    return (
      <div className="ad-empty-state ad-empty-state--sm">
        <div className="ad-empty-state__icon">{Ico.calendar}</div>
        <p className="ad-empty-state__title">Keine Schichten</p>
        <p className="ad-empty-state__sub">Noch keine geplant</p>
      </div>
    );
  }
  return (
    <div className="ad-shifts-widget">
      {upcoming.map((shift) => {
        const isToday = shift.shift_date === todayStr;
        const d = new Date(shift.shift_date + "T00:00:00");
        return (
          <div key={shift.id} className={`ad-shift-row${isToday ? " ad-shift-row--today" : ""}`}>
            <div className="ad-shift-row__date">
              <span className="ad-shift-row__day-num">{d.getDate()}</span>
              <span className="ad-shift-row__day-name">
                {d.toLocaleDateString("de-DE", { weekday: "short" })}
              </span>
            </div>
            <div className="ad-shift-row__info">
              <span className="ad-shift-row__name">
                {shift.employee_name ?? `#${shift.employee_id}`}
              </span>
              <div className="ad-shift-row__meta">
                <span className="ad-shift-row__time">
                  {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                </span>
                {shift.location_name && (
                  <span style={{ color: "var(--text-4)" }}>· {shift.location_name}</span>
                )}
              </div>
            </div>
            {isToday && <span className="ad-badge ad-badge--blue">Heute</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Activity Feed ─────────────────────────────────────────────────────────────
function ActivityFeed({ attendance, approvals }) {
  const events = useMemo(() => {
    const attEvents = attendance.slice(0, 20).map((a) => ({
      key: `att-${a.id ?? Math.random()}`,
      icon: a.type === "checkin" ? "check" : "clock",
      color: a.type === "checkin" ? "green" : "orange",
      name: a.employee_name,
      sub: a.type === "checkin" ? "Check-in" : "Check-out",
      time: new Date(a.created_at),
    }));
    const approvalEvents = (approvals ?? []).filter((s) => s.status !== "pending").slice(0, 10).map((s) => ({
      key: `app-${s.id}`,
      icon: s.status === "approved" ? "check" : s.status === "rejected" ? "x" : "clock",
      color: s.status === "approved" ? "blue" : s.status === "rejected" ? "red" : "purple",
      name: s.employee_name ?? `#${s.employee_id}`,
      sub: s.status === "approved" ? "Genehmigt" : s.status === "rejected" ? "Abgelehnt" : "Korrigiert",
      time: new Date(s.checkin_time),
    }));
    return [...attEvents, ...approvalEvents]
      .sort((a, b) => b.time - a.time)
      .slice(0, 10);
  }, [attendance, approvals]);

  return (
    <div className="ad-activity-feed">
      {events.length === 0 ? (
        <p className="ad-empty">Keine aktuellen Aktivitäten.</p>
      ) : (
        events.map((ev) => (
          <div key={ev.key} className="ad-activity-item">
            <div className={`ad-activity-icon ad-activity-icon--${ev.color}`}>
              {Ico[ev.icon]}
            </div>
            <div className="ad-activity-content">
              <span className="ad-activity-name">{ev.name}</span>
              <span className="ad-activity-sub">{ev.sub}</span>
            </div>
            <span className="ad-activity-time">{relativeTime(ev.time)}</span>
          </div>
        ))
      )}
    </div>
  );
}

// ── Section Title ────────────────────────────────────────────────────────────
function SectionTitle({ title, action }) {
  return (
    <div className="ad-section-title">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

// ── Card wrapper ─────────────────────────────────────────────────────────────
function Card({ children, className = "", id }) {
  return <div id={id} className={`ad-card ${className}`}>{children}</div>;
}

// ── Badge ─────────────────────────────────────────────────────────────────────
function Badge({ type }) {
  const map = {
    active:   ["ad-badge--green",  "Aktiv"],
    inactive: ["ad-badge--red",    "Inaktiv"],
    admin:    ["ad-badge--purple", "admin"],
    employee: ["ad-badge--blue",   "employee"],
    checkin:  ["ad-badge--green",  "Check-in"],
    checkout: ["ad-badge--orange", "Check-out"],
    open:     ["ad-badge--green",  "offen"],
    closed:   ["ad-badge--gray",   "geschlossen"],
  };
  const [cls, label] = map[type] ?? ["ad-badge--gray", type];
  return <span className={`ad-badge ${cls}`}>{label}</span>;
}

function ApprovalBadge({ status }) {
  const map = {
    pending:   ["ad-badge--yellow", "Ausstehend"],
    approved:  ["ad-badge--green",  "Genehmigt"],
    rejected:  ["ad-badge--red",    "Abgelehnt"],
    corrected: ["ad-badge--blue",   "Korrigiert"],
  };
  const [cls, label] = map[status] ?? ["ad-badge--gray", status];
  return <span className={`ad-badge ${cls}`}>{label}</span>;
}

/** Tabellenzelle „Urlaub übrig“: noch buchbar / Soll + grüner Balken (Anteil genommen) */
function AdminEmployeeLeaveMeterCell({ row }) {
  const resolved = Number(row.leave_annual_resolved) || 0;
  const avail = Number(row.leave_available) || 0;
  const used = Number(row.leave_used_this_year) || 0;
  const pctUsed = resolved > 0 ? Math.min(100, Math.round((used / resolved) * 100)) : 0;
  const label = `${avail} / ${resolved} Tage`;
  return (
    <td className="ad-table__leave">
      <div className="ad-leave-meter__label">{label}</div>
      <div
        className="ad-leave-meter"
        role="progressbar"
        aria-valuenow={pctUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Urlaub im Jahr: ${pctUsed} Prozent bereits genommen`}
      >
        <div className="ad-leave-meter__fill" style={{ width: `${pctUsed}%` }} />
      </div>
    </td>
  );
}

/** Vier Kennzahlen-Karten im Urlaub-Modal (Vorlage „Urlaub Statistik“) */
function AdminLeaveModalStatCards({ emp }) {
  const annual = Number(emp.leave_annual_resolved) || 0;
  const used = Number(emp.leave_used_this_year) || 0;
  const remaining = Number(emp.leave_remaining) || 0;
  const pendingDays = Number(emp.leave_pending_days_this_year) || 0;
  const pendingCnt = Number(emp.leave_pending_count) || 0;
  const pctTaken = annual > 0 ? Math.min(100, Math.round((used / annual) * 100)) : 0;
  const pctRemain = annual > 0 ? Math.min(100, Math.round((remaining / annual) * 100)) : 0;
  return (
    <div className="ad-leave-stat-grid">
      <div className="ad-leave-stat-card ad-leave-stat-card--blue">
        <div className="ad-leave-stat-card__icon" aria-hidden>📅</div>
        <div className="ad-leave-stat-card__body">
          <span className="ad-leave-stat-card__label">Jährlicher Anspruch</span>
          <strong className="ad-leave-stat-card__value">{annual} Tage</strong>
          <span className="ad-leave-stat-card__hint">pro Kalenderjahr</span>
        </div>
      </div>
      <div className="ad-leave-stat-card ad-leave-stat-card--green">
        <div className="ad-leave-stat-card__icon" aria-hidden>✓</div>
        <div className="ad-leave-stat-card__body">
          <span className="ad-leave-stat-card__label">Genommener Urlaub</span>
          <strong className="ad-leave-stat-card__value">{used} Tage</strong>
          <span className="ad-leave-stat-card__hint">{pctTaken}% des Anspruchs</span>
        </div>
      </div>
      <div className="ad-leave-stat-card ad-leave-stat-card--sky">
        <div className="ad-leave-stat-card__icon" aria-hidden>✈</div>
        <div className="ad-leave-stat-card__body">
          <span className="ad-leave-stat-card__label">Verbleibender Urlaub</span>
          <strong className="ad-leave-stat-card__value">{remaining} Tage</strong>
          <span className="ad-leave-stat-card__hint">{pctRemain}% verfügbar</span>
        </div>
      </div>
      <div className="ad-leave-stat-card ad-leave-stat-card--violet">
        <div className="ad-leave-stat-card__icon" aria-hidden>📋</div>
        <div className="ad-leave-stat-card__body">
          <span className="ad-leave-stat-card__label">Geplante Anträge</span>
          <strong className="ad-leave-stat-card__value">{pendingDays} Tage ausstehend</strong>
          <span className="ad-leave-stat-card__hint">
            {pendingCnt} {pendingCnt === 1 ? "Antrag" : "Anträge"} offen
          </span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export function AdminDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("dashboard");

  // ── Data ───────────────────────────────────────────────────────────────────
  const [employees,  setEmployees]  = useState([]);
  const [locations,  setLocations]  = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [shifts,     setShifts]     = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loadError, setLoadError]   = useState(null);
  const [busy, setBusy]             = useState(true);

  // ── Shift form ────────────────────────────────────────────────────────────
  const [shiftEditId,     setShiftEditId]     = useState(null);
  const [shiftEmpId,      setShiftEmpId]      = useState("");
  const [shiftLocId,      setShiftLocId]      = useState("");
  const [shiftDate,       setShiftDate]       = useState("");
  const [shiftStart,      setShiftStart]      = useState("");
  const [shiftEnd,        setShiftEnd]        = useState("");
  const [shiftNote,       setShiftNote]       = useState("");
  const [shiftFormError,   setShiftFormError]   = useState(null);
  const [shiftFormSuccess, setShiftFormSuccess] = useState(null);
  const [shiftFormBusy,    setShiftFormBusy]    = useState(false);
  const [showShiftForm,    setShowShiftForm]    = useState(false);

  // ── Employee form ─────────────────────────────────────────────────────────
  const [newEmpName, setNewEmpName]         = useState("");
  const [newEmpEmail, setNewEmpEmail]       = useState("");
  const [newEmpPassword, setNewEmpPassword] = useState("");
  const [newEmpAnnual, setNewEmpAnnual]     = useState("");
  const [empFormError, setEmpFormError]     = useState(null);
  const [empFormBusy, setEmpFormBusy]       = useState(false);
  const [showNewEmpForm, setShowNewEmpForm] = useState(false);

  // ── Employee edit ─────────────────────────────────────────────────────────
  const [empEditId, setEmpEditId]       = useState(null);
  const [editName, setEditName]         = useState("");
  const [editEmail, setEditEmail]       = useState("");
  const [editPhone, setEditPhone]       = useState("");
  const [editRole, setEditRole]         = useState("employee");
  const [editLocationIds, setEditLocationIds] = useState([]);
  const [editMonthlySollHours, setEditMonthlySollHours] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editEmpError, setEditEmpError] = useState(null);
  const [editEmpBusy, setEditEmpBusy]   = useState(false);

  /** Stunden-Modal (WorkSessions laufender Monat) */
  const [hoursModalOpen, setHoursModalOpen] = useState(false);
  const [hoursModalRow, setHoursModalRow] = useState(null);
  const [hoursModalSessions, setHoursModalSessions] = useState([]);
  const [hoursModalLoading, setHoursModalLoading] = useState(false);
  const [hoursModalError, setHoursModalError] = useState(null);

  /** Urlaub nur im Modal (Button „Urlaub“ in der Tabelle) */
  const [leaveModalEmpId, setLeaveModalEmpId] = useState(null);
  const [leaveModalAnnual, setLeaveModalAnnual] = useState("");
  const [leaveModalError, setLeaveModalError] = useState(null);
  const [leaveModalBusy, setLeaveModalBusy] = useState(false);

  // ── Location form ─────────────────────────────────────────────────────────
  const [locEditId, setLocEditId]   = useState(null);
  const [locName, setLocName]       = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locLat, setLocLat]         = useState("");
  const [locLng, setLocLng]         = useState("");
  const [locRadius, setLocRadius]   = useState("200");
  const [locFormError, setLocFormError]       = useState(null);
  const [locFormBusy, setLocFormBusy]         = useState(false);
  const [mapPosition, setMapPosition]         = useState(null);
  const [mapFlyZoom,  setMapFlyZoom]          = useState(null);
  const [locSearchQuery,    setLocSearchQuery]    = useState("");
  const [locSearchBusy,     setLocSearchBusy]     = useState(false);
  const [locSearchError,    setLocSearchError]    = useState(null);
  const [locRevGeocodeBusy, setLocRevGeocodeBusy] = useState(false);

  // ── Reports ───────────────────────────────────────────────────────────────
  const [reportEmpId,       setReportEmpId]       = useState("");
  const [reportStart,       setReportStart]       = useState("");
  const [reportEnd,         setReportEnd]         = useState("");
  const [reportData,        setReportData]        = useState(null);
  const [reportBusy,        setReportBusy]        = useState(false);
  const [reportError,       setReportError]       = useState(null);
  const [reportQuickFilter, setReportQuickFilter] = useState("custom");
  const [reportDateError,   setReportDateError]   = useState(null);

  // ── Badge counts ─────────────────────────────────────────────────────────
  const [pendingCount,   setPendingCount]   = useState(0);
  const [correctedCount, setCorrectedCount] = useState(0);
  const [rejectedCount,  setRejectedCount]  = useState(0);
  const [leavePendingCount, setLeavePendingCount] = useState(0);

  // ── Urlaub (Admin) ───────────────────────────────────────────────────────
  const [leaveAdminList,    setLeaveAdminList]    = useState([]);
  const [leaveAdminLoading, setLeaveAdminLoading] = useState(false);
  const [leaveAdminError,   setLeaveAdminError]   = useState(null);
  const [leaveActionBusy,   setLeaveActionBusy]   = useState(false);
  const [leaveActionMsg,    setLeaveActionMsg]    = useState(null);
  const [leaveRejectingId,  setLeaveRejectingId]  = useState(null);
  const [leaveRejectReason, setLeaveRejectReason] = useState("");
  /** Nur in „Urlaubanträge“: API-Filter ?employee_id= */
  const [leaveAdminEmployeeFilter, setLeaveAdminEmployeeFilter] = useState(null);
  const [approvals,           setApprovals]           = useState([]);
  const [approvalsLoading,    setApprovalsLoading]    = useState(false);
  const [approvalsError,      setApprovalsError]      = useState(null);
  const [approvalFilterEmpId, setApprovalFilterEmpId] = useState("");
  const [approvalFilterStatus,setApprovalFilterStatus]= useState("");
  const [approvalFilterStart, setApprovalFilterStart] = useState("");
  const [approvalFilterEnd,   setApprovalFilterEnd]   = useState("");
  const [approvalBusy,        setApprovalBusy]        = useState(false);
  const [approvalError,       setApprovalError]       = useState(null);
  const [approvalSuccess,     setApprovalSuccess]     = useState(null);
  // Ablehnen
  const [rejectingId,   setRejectingId]   = useState(null);
  const [rejectReason,  setRejectReason]  = useState("");
  // Korrigieren
  const [correctingSession, setCorrectingSession] = useState(null);
  const [correctCheckin,    setCorrectCheckin]    = useState("");
  const [correctCheckout,   setCorrectCheckout]   = useState("");
  const [correctNote,       setCorrectNote]       = useState("");

  // ── Überfällige Checkouts ─────────────────────────────────────────────────
  const [overdueCheckouts,  setOverdueCheckouts]  = useState([]);
  const [overdueLoading,    setOverdueLoading]    = useState(false);
  const [overdueError,      setOverdueError]      = useState(null);
  const [ignoredOverdueIds, setIgnoredOverdueIds] = useState(new Set());
  const [approvalDateError, setApprovalDateError] = useState(null);

  // ── Attendance-Filter ────────────────────────────────────────────────────
  const [attendanceSearch,      setAttendanceSearch]      = useState("");
  const [attendanceTypeFilter,  setAttendanceTypeFilter]  = useState("all");
  const [attendanceDateFrom,    setAttendanceDateFrom]    = useState("");
  const [attendanceDateTo,      setAttendanceDateTo]      = useState("");
  const [attendanceSuggestOpen, setAttendanceSuggestOpen] = useState(false);
  const [attendanceDateError,   setAttendanceDateError]   = useState(null);
  const attSearchRef = useRef(null);

  // Eindeutige Mitarbeiter aus den Attendance-Logs ableiten
  const attendanceEmployees = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const row of attendance) {
      if (!seen.has(row.employee_email)) {
        seen.add(row.employee_email);
        result.push({ name: row.employee_name, email: row.employee_email });
      }
    }
    return result.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [attendance]);

  // Vorschläge filtern (max. 8)
  const attendanceSuggestions = useMemo(() => {
    const q = attendanceSearch.trim().toLowerCase();
    if (!q) return [];
    return attendanceEmployees
      .filter((e) =>
        e.name?.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [attendanceEmployees, attendanceSearch]);

  // Dropdown schließen wenn außerhalb geklickt wird
  useEffect(() => {
    function onClickOutside(e) {
      if (attSearchRef.current && !attSearchRef.current.contains(e.target)) {
        setAttendanceSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // ── Gefilterte Attendance-Logs (Frontend-seitig) ─────────────────────────
  const filteredAttendanceLogs = useMemo(() => {
    const search = attendanceSearch.trim().toLowerCase();
    const from   = attendanceDateFrom ? new Date(attendanceDateFrom) : null;
    const to     = attendanceDateTo   ? new Date(attendanceDateTo + "T23:59:59") : null;
    const dateRangeValid = !(from && to && from > to);

    return attendance.filter((row) => {
      if (search) {
        const nameMatch  = row.employee_name?.toLowerCase().includes(search);
        const emailMatch = row.employee_email?.toLowerCase().includes(search);
        if (!nameMatch && !emailMatch) return false;
      }
      if (attendanceTypeFilter !== "all" && row.type !== attendanceTypeFilter) return false;
      if (dateRangeValid && (from || to)) {
        const ts = new Date(row.created_at);
        if (from && ts < from) return false;
        if (to   && ts > to)   return false;
      }
      return true;
    });
  }, [attendance, attendanceSearch, attendanceTypeFilter, attendanceDateFrom, attendanceDateTo]);

  const visibleOverdueCheckouts = useMemo(
    () => overdueCheckouts.filter((o) => !ignoredOverdueIds.has(o.checkin_log_id)),
    [overdueCheckouts, ignoredOverdueIds],
  );

  // ── Central refresh after approve/reject/correct ─────────────────────────
  // Refreshes statistics (KPI cards) and badge counts without touching
  // the filtered approval list — fetchApprovals() handles that separately.
  const refreshAdminData = useCallback(async () => {
    setBusy(true);
    try {
      const [sRes, appRes] = await Promise.all([
        apiClient.get(STATISTICS_URL),
        apiClient.get("/admin/approvals/work-sessions"),
      ]);
      setStatistics(sRes.data ?? null);
      const allA = appRes.data ?? [];
      setPendingCount(allA.filter((a) => a.status === "pending").length);
      setCorrectedCount(allA.filter((a) => a.status === "corrected").length);
      setRejectedCount(allA.filter((a) => a.status === "rejected").length);
      try {
        const lr = await apiClient.get("/admin/leave-requests?status=pending");
        setLeavePendingCount((lr.data ?? []).length);
      } catch {
        setLeavePendingCount(0);
      }
    } catch {
      // Non-critical — badge counts stay at previous values
    } finally { setBusy(false); }
  }, []);

  // ── Load all data ─────────────────────────────────────────────────────────
  const refreshAll = useCallback(async () => {
    setLoadError(null); setBusy(true);
    try {
      const [eRes, lRes, aRes, sRes, shRes, meRes] = await Promise.all([
        apiClient.get(EMPLOYEES_URL),
        apiClient.get(LOCATIONS_URL),
        apiClient.get(ATTENDANCE_URL),
        apiClient.get(STATISTICS_URL),
        apiClient.get(SHIFTS_URL),
        apiClient.get("/auth/me"),
      ]);
      setEmployees(eRes.data ?? []);
      setLocations(lRes.data ?? []);
      setAttendance(aRes.data ?? []);
      setStatistics(sRes.data ?? null);
      setShifts(shRes.data ?? []);
      setCurrentUser(meRes.data ?? null);
      // Fetch approval counts for badge / dashboard widget
      try {
        const appRes = await apiClient.get("/admin/approvals/work-sessions");
        const allA = appRes.data ?? [];
        setPendingCount(allA.filter((a) => a.status === "pending").length);
        setCorrectedCount(allA.filter((a) => a.status === "corrected").length);
        setRejectedCount(allA.filter((a) => a.status === "rejected").length);
      } catch { /* counts stay at previous value */ }
      try {
        const lr = await apiClient.get("/admin/leave-requests?status=pending");
        setLeavePendingCount((lr.data ?? []).length);
      } catch {
        setLeavePendingCount(0);
      }
    } catch (err) {
      setLoadError(axios.isAxiosError(err) && err.response?.status === 403
        ? "Kein Zugriff (nur Administratoren)."
        : "Daten konnten nicht geladen werden.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const fetchApprovals = useCallback(async () => {
    if (approvalFilterStatus === "overdue") { setApprovals([]); return; }
    setApprovalsLoading(true);
    setApprovalsError(null);
    try {
      const p = new URLSearchParams();
      if (approvalFilterEmpId) p.append("employee_id", approvalFilterEmpId);
      if (approvalFilterStatus) p.append("status", approvalFilterStatus);
      if (approvalFilterStart) p.append("start_date", approvalFilterStart);
      if (approvalFilterEnd) p.append("end_date", approvalFilterEnd);
      const res = await apiClient.get(`/admin/approvals/work-sessions?${p}`);
      setApprovals(res.data ?? []);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setApprovalsError(typeof d === "string" ? d : "Genehmigungen konnten nicht geladen werden.");
    } finally {
      setApprovalsLoading(false);
    }
  }, [approvalFilterEmpId, approvalFilterStatus, approvalFilterStart, approvalFilterEnd]);

  const fetchOverdueCheckouts = useCallback(async () => {
    setOverdueLoading(true);
    setOverdueError(null);
    try {
      const res = await apiClient.get("/admin/approvals/overdue-checkouts");
      setOverdueCheckouts(res.data ?? []);
    } catch {
      setOverdueError("Ueberfaellige Checkouts konnten nicht geladen werden.");
    } finally {
      setOverdueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "approvals") {
      fetchApprovals();
      fetchOverdueCheckouts();
    }
  }, [activeSection, fetchApprovals, fetchOverdueCheckouts]);

  const fetchLeaveAdmin = useCallback(async () => {
    setLeaveAdminLoading(true);
    setLeaveAdminError(null);
    try {
      const p = new URLSearchParams();
      if (leaveAdminEmployeeFilter != null) {
        p.set("employee_id", String(leaveAdminEmployeeFilter));
      }
      const q = p.toString();
      const res = await apiClient.get(`/admin/leave-requests${q ? `?${q}` : ""}`);
      setLeaveAdminList(res.data ?? []);
    } catch {
      setLeaveAdminList([]);
      setLeaveAdminError("Urlaubanträge konnten nicht geladen werden.");
    } finally {
      setLeaveAdminLoading(false);
    }
  }, [leaveAdminEmployeeFilter]);

  useEffect(() => {
    if (activeSection === "leaveRequests") fetchLeaveAdmin();
  }, [activeSection, fetchLeaveAdmin]);
  async function handleCreateEmployee(e) {
    e.preventDefault(); setEmpFormError(null); setEmpFormBusy(true);
    try {
      const payload = { name: newEmpName.trim(), email: newEmpEmail.trim(), password: newEmpPassword };
      const a = newEmpAnnual.trim();
      if (a !== "") {
        const n = Number(a);
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          setEmpFormError("Urlaubstage/Jahr: ganze Zahl zwischen 0 und 365, oder leer lassen.");
          setEmpFormBusy(false);
          return;
        }
        payload.annual_leave_days = n;
      }
      await apiClient.post(EMPLOYEES_URL, payload);
      setNewEmpName(""); setNewEmpEmail(""); setNewEmpPassword(""); setNewEmpAnnual("");
      setShowNewEmpForm(false);
      await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setEmpFormError(typeof d === "string" ? d : "Anlegen fehlgeschlagen.");
    } finally { setEmpFormBusy(false); }
  }

  function handleEditEmployee(emp) {
    setEmpEditId(emp.id); setEditName(emp.name); setEditEmail(emp.email);
    setEditPhone(emp.phone || ""); setEditRole(emp.role);
    const locs = Array.isArray(emp.assigned_location_ids) && emp.assigned_location_ids.length
      ? emp.assigned_location_ids.map((x) => String(x))
      : (emp.assigned_location_id ? [String(emp.assigned_location_id)] : []);
    setEditLocationIds(locs);
    setEditMonthlySollHours(
      emp.target_hours_month != null && emp.target_hours_month > 0
        ? String(emp.target_hours_month)
        : "",
    );
    setEditIsActive(emp.is_active);
    setEditEmpError(null);
  }
  function handleCancelEmpEdit() {
    setEmpEditId(null);
    setEditLocationIds([]);
    setEditMonthlySollHours("");
    setEditEmpError(null);
  }

  function toggleEditLocation(locationId) {
    const s = String(locationId);
    setEditLocationIds((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function selectAllEditLocations() {
    setEditLocationIds(locations.map((l) => String(l.id)));
  }

  function clearAllEditLocations() {
    setEditLocationIds([]);
  }

  function openEmployeeLeaveModal(emp) {
    setLeaveModalError(null);
    setLeaveModalEmpId(emp.id);
    setLeaveModalAnnual(
      emp.annual_leave_days != null && emp.annual_leave_days !== undefined
        ? String(emp.annual_leave_days)
        : "",
    );
  }

  function openLeaveHistoryForEmployee(empId) {
    setLeaveAdminEmployeeFilter(empId);
    closeEmployeeLeaveModal();
    setActiveSection("leaveRequests");
  }

  function closeEmployeeLeaveModal() {
    setLeaveModalEmpId(null);
    setLeaveModalAnnual("");
    setLeaveModalError(null);
  }

  async function handleSaveEmployeeLeaveModal(e) {
    e.preventDefault();
    const src = employees.find((x) => x.id === leaveModalEmpId);
    if (!src) return;

    let annual_leave_days = null;
    const a = leaveModalAnnual.trim();
    if (a !== "") {
      const n = Number(a);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        setLeaveModalError("Urlaubstage/Jahr: ganze Zahl zwischen 0 und 365, oder leer für System-Standard.");
        return;
      }
      annual_leave_days = n;
    }

    setLeaveModalBusy(true);
    setLeaveModalError(null);
    try {
      await apiClient.put(`${EMPLOYEES_URL}/${leaveModalEmpId}`, {
        name: src.name,
        email: src.email,
        role: src.role,
        phone: (src.phone && String(src.phone).trim()) || null,
        assigned_location_ids: Array.isArray(src.assigned_location_ids) ? src.assigned_location_ids : [],
        employment_type: src.employment_type || "full_time",
        target_hours_month: src.target_hours_month ?? null,
        is_active: src.is_active,
        annual_leave_days,
      });
      closeEmployeeLeaveModal();
      await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setLeaveModalError(typeof d === "string" ? d : "Speichern fehlgeschlagen.");
    } finally {
      setLeaveModalBusy(false);
    }
  }

  function closeHoursModal() {
    setHoursModalOpen(false);
    setHoursModalRow(null);
    setHoursModalSessions([]);
    setHoursModalError(null);
  }

  function calendarMonthRangeIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const pad = (n) => String(n).padStart(2, "0");
    const lastDay = new Date(y, m, 0).getDate();
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
  }

  async function openHoursModal(emp) {
    setHoursModalRow(emp);
    setHoursModalOpen(true);
    setHoursModalLoading(true);
    setHoursModalError(null);
    setHoursModalSessions([]);
    try {
      const { start, end } = calendarMonthRangeIso();
      const res = await apiClient.get(
        `/admin/approvals/work-sessions?employee_id=${emp.id}&start_date=${start}&end_date=${end}`,
      );
      setHoursModalSessions(res.data ?? []);
    } catch {
      setHoursModalError("Arbeitszeiten konnten nicht geladen werden.");
    } finally {
      setHoursModalLoading(false);
    }
  }

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      if (empEditId != null && !editEmpBusy) handleCancelEmpEdit();
      if (leaveModalEmpId != null && !leaveModalBusy) closeEmployeeLeaveModal();
      if (hoursModalOpen && !hoursModalLoading) closeHoursModal();
    };
    if (empEditId == null && leaveModalEmpId == null && !hoursModalOpen) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [empEditId, editEmpBusy, leaveModalEmpId, leaveModalBusy, hoursModalOpen, hoursModalLoading]);

  async function handleUpdateEmployee(e) {
    e.preventDefault(); setEditEmpError(null); setEditEmpBusy(true);
    try {
      const profileSource = employees.find((x) => x.id === empEditId);
      const annualPreserved = profileSource?.annual_leave_days ?? null;
      const employment_type = profileSource?.employment_type || "full_time";
      let target_hours_month = null;
      const t = editMonthlySollHours.trim();
      if (t !== "") {
        const n = Number(t);
        if (!Number.isInteger(n) || n < 1 || n > 200) {
          setEditEmpError("Soll-Stunden / Monat: ganze Zahl zwischen 1 und 200, oder leer für automatisches Standard-Soll.");
          setEditEmpBusy(false);
          return;
        }
        target_hours_month = n;
      }
      const assigned_location_ids = editLocationIds
        .map((x) => Number(x))
        .filter((n) => !Number.isNaN(n) && n > 0);
      await apiClient.put(`${EMPLOYEES_URL}/${empEditId}`, {
        name: editName.trim(), email: editEmail.trim(), role: editRole,
        phone: editPhone.trim() || null,
        assigned_location_ids,
        employment_type,
        target_hours_month,
        is_active: editIsActive,
        annual_leave_days: annualPreserved,
      });
      handleCancelEmpEdit(); await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setEditEmpError(typeof d === "string" ? d : "Speichern fehlgeschlagen.");
    } finally { setEditEmpBusy(false); }
  }

  async function handleToggleActive(emp) {
    const action = emp.is_active ? "deactivate" : "activate";
    if (!confirm(`Mitarbeiter „${emp.name}" wirklich ${emp.is_active ? "deaktivieren" : "aktivieren"}?`)) return;
    try {
      await apiClient.patch(`${EMPLOYEES_URL}/${emp.id}/${action}`);
      await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      alert(typeof d === "string" ? d : "Aktion fehlgeschlagen.");
    }
  }

  // ── Location handlers ─────────────────────────────────────────────────────
  async function handleMapClick(lat, lng) {
    setLocLat(lat.toFixed(6));
    setLocLng(lng.toFixed(6));
    setMapPosition([lat, lng]);
    setMapFlyZoom(null);
    setLocSearchError(null);

    // Reverse Geocoding: Koordinaten → Adresse
    setLocRevGeocodeBusy(true);
    try {
      const res = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=de`,
        { headers: { "User-Agent": "TimeStemple/1.0" } },
      );
      if (res.data?.display_name) {
        setLocAddress(res.data.display_name);
      }
    } catch {
      // Reverse Geocoding ist optional — kein Fehler anzeigen
    } finally {
      setLocRevGeocodeBusy(false);
    }
  }

  async function handleSearchAddress(e) {
    e.preventDefault();
    const q = locSearchQuery.trim();
    if (!q) return;

    setLocSearchError(null);
    setLocSearchBusy(true);
    try {
      const res = await axios.get(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&accept-language=de`,
        { headers: { "User-Agent": "TimeStemple/1.0" } },
      );
      const results = res.data;
      if (!results || results.length === 0) {
        setLocSearchError("Keine Adresse gefunden. Bitte präzisere Eingabe versuchen.");
        return;
      }
      const { lat, lon, display_name } = results[0];
      const latN = parseFloat(lat);
      const lngN = parseFloat(lon);
      setLocLat(latN.toFixed(6));
      setLocLng(lngN.toFixed(6));
      setMapPosition([latN, lngN]);
      setMapFlyZoom(16);
      setLocAddress(display_name);
    } catch (err) {
      setLocSearchError(
        axios.isAxiosError(err) && !err.response
          ? "Adresssuche aktuell nicht verfügbar (Netzwerkfehler)."
          : "Adresssuche fehlgeschlagen.",
      );
    } finally {
      setLocSearchBusy(false);
    }
  }

  function handleEditLocation(loc) {
    setLocEditId(loc.id); setLocName(loc.name); setLocAddress(loc.address || "");
    setLocLat(String(loc.lat)); setLocLng(String(loc.lng));
    setLocRadius(String(loc.radius_meters)); setMapPosition([loc.lat, loc.lng]);
    setMapFlyZoom(15);
    setLocFormError(null); setLocSearchError(null);
  }
  function handleCancelLocEdit() {
    setLocEditId(null); setLocName(""); setLocAddress("");
    setLocLat(""); setLocLng(""); setLocRadius("200");
    setMapPosition(null); setMapFlyZoom(null);
    setLocFormError(null); setLocSearchError(null);
  }
  async function handleSaveLocation(e) {
    e.preventDefault(); setLocFormError(null); setLocFormBusy(true);
    const lat = Number(locLat), lng = Number(locLng), radius = Number(locRadius);
    if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
      setLocFormError("Ungültige Koordinaten oder Radius."); setLocFormBusy(false); return;
    }
    try {
      const payload = { name: locName.trim(), address: locAddress.trim(), lat, lng, radius_meters: radius };
      locEditId !== null
        ? await apiClient.put(`${LOCATIONS_URL}/${locEditId}`, payload)
        : await apiClient.post(LOCATIONS_URL, payload);
      handleCancelLocEdit(); await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setLocFormError(typeof d === "string" ? d : "Speichern fehlgeschlagen.");
    } finally { setLocFormBusy(false); }
  }
  async function handleDeleteLocation(id, name) {
    if (!confirm(`Standort „${name}" wirklich löschen?`)) return;
    try {
      await apiClient.delete(`${LOCATIONS_URL}/${id}`);
      if (locEditId === id) handleCancelLocEdit();
      await refreshAll();
    } catch { alert("Löschen fehlgeschlagen."); }
  }

  // ── Report handlers ───────────────────────────────────────────────────────
  function handleReportQuickFilter(filter) {
    setReportQuickFilter(filter);
    setReportDateError(null);
    const today = new Date();
    const pad   = (n) => String(n).padStart(2, "0");
    const fmt   = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (filter === "today") {
      const t = fmt(today);
      setReportStart(t); setReportEnd(t);
    } else if (filter === "week") {
      const mon = new Date(today);
      mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      setReportStart(fmt(mon)); setReportEnd(fmt(today));
    } else if (filter === "month") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      setReportStart(fmt(first)); setReportEnd(fmt(today));
    } else if (filter === "lastMonth") {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last  = new Date(today.getFullYear(), today.getMonth(), 0);
      setReportStart(fmt(first)); setReportEnd(fmt(last));
    }
  }

  async function handleLoadReport(e) {
    e.preventDefault(); setReportError(null); setReportDateError(null); setReportBusy(true);
    try {
      const p = new URLSearchParams();
      if (reportEmpId) p.append("employee_id", reportEmpId);
      if (reportStart) p.append("start_date",  reportStart);
      if (reportEnd)   p.append("end_date",    reportEnd);
      const res = await apiClient.get(`${REPORTS_URL}?${p}`);
      setReportData(res.data);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setReportError(typeof d === "string" ? d : "Report fehlgeschlagen.");
    } finally { setReportBusy(false); }
  }
  async function handleDownloadCsv() {
    try {
      const p = new URLSearchParams();
      if (reportEmpId) p.append("employee_id", reportEmpId);
      if (reportStart) p.append("start_date",  reportStart);
      if (reportEnd)   p.append("end_date",    reportEnd);
      const res = await apiClient.get(`/admin/reports/attendance.csv?${p}`, { responseType: "blob" });
      const disposition = res.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "report.csv";
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("CSV-Export fehlgeschlagen."); }
  }

  // ── Shift handlers ────────────────────────────────────────────────────────
  function resetShiftForm() {
    setShiftEditId(null); setShiftEmpId(""); setShiftLocId("");
    setShiftDate(""); setShiftStart(""); setShiftEnd("");
    setShiftNote(""); setShiftFormError(null); setShiftFormSuccess(null);
  }

  function handleEditShift(shift) {
    setShiftEditId(shift.id);
    setShiftEmpId(String(shift.employee_id));
    setShiftLocId(shift.location_id ? String(shift.location_id) : "");
    setShiftDate(shift.shift_date);
    setShiftStart(shift.start_time.slice(0, 5));
    setShiftEnd(shift.end_time.slice(0, 5));
    setShiftNote(shift.note ?? "");
    setShiftFormError(null);
    setShowShiftForm(true);
    setTimeout(() => document.getElementById("shift-form-anchor")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function handleSaveShift(e) {
    e.preventDefault();
    setShiftFormError(null);
    setShiftFormSuccess(null);

    // Nur identische Zeiten blockieren. end < start = Nachtschicht (erlaubt).
    if (shiftStart && shiftEnd && shiftStart === shiftEnd) {
      setShiftFormError("Start- und Endzeit dürfen nicht identisch sein.");
      return;
    }

    setShiftFormBusy(true);

    const payload = {
      employee_id: Number(shiftEmpId),
      location_id: shiftLocId ? Number(shiftLocId) : null,
      shift_date: shiftDate,           // input[type=date] liefert bereits YYYY-MM-DD
      start_time: shiftStart + ":00",  // HH:MM → HH:MM:SS
      end_time:   shiftEnd   + ":00",
      note: shiftNote.trim() || null,
    };

    const url = shiftEditId !== null ? `${SHIFTS_URL}/${shiftEditId}` : SHIFTS_URL;
    const method = shiftEditId !== null ? "PUT" : "POST";
    console.log(`[Shift] ${method} ${url}`);
    console.log("[Shift] Payload:", payload);

    try {
      const res = shiftEditId !== null
        ? await apiClient.put(url, payload)
        : await apiClient.post(url, payload);

      console.log("[Shift] Response:", res.data);
      resetShiftForm();
      setShowShiftForm(false);
      setShiftFormSuccess(shiftEditId !== null ? "Schicht erfolgreich aktualisiert." : "Schicht erfolgreich angelegt.");
      await refreshAll();
    } catch (err) {
      console.error("[Shift] Error:", err.response ?? err);
      const httpStatus = axios.isAxiosError(err) ? err.response?.status : null;
      const detail     = axios.isAxiosError(err) ? err.response?.data?.detail : null;

      if (httpStatus === 401 || httpStatus === 403) {
        setShiftFormError("Nicht autorisiert oder keine Admin-Rechte.");
      } else if (typeof detail === "string") {
        setShiftFormError(detail);
      } else if (Array.isArray(detail)) {
        // Pydantic-422: detail ist ein Array von Fehlerobjekten
        const msgs = detail.map((e) => e.msg ?? JSON.stringify(e)).join(" • ");
        setShiftFormError(msgs);
      } else if (detail) {
        setShiftFormError(JSON.stringify(detail));
      } else {
        setShiftFormError("Speichern fehlgeschlagen.");
      }
    } finally {
      setShiftFormBusy(false);
    }
  }

  async function handleDeleteShift(id) {
    if (!confirm("Schicht wirklich löschen?")) return;
    try {
      await apiClient.delete(`${SHIFTS_URL}/${id}`);
      await refreshAll();
    } catch { alert("Löschen fehlgeschlagen."); }
  }

  // ── Approval handlers ─────────────────────────────────────────────────────
  async function handleApproveSession(id) {
    setApprovalBusy(true); setApprovalError(null); setApprovalSuccess(null);
    try {
      await apiClient.patch(`/admin/approvals/work-sessions/${id}/approve`);
      setApprovalSuccess("Schicht genehmigt.");
      await Promise.all([refreshAdminData(), fetchApprovals()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setApprovalError(typeof d === "string" ? d : "Genehmigung fehlgeschlagen.");
    } finally { setApprovalBusy(false); }
  }

  function startCorrect(session) {
    const pad = (n) => String(n).padStart(2, "0");
    const toLocal = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setCorrectingSession(session);
    setCorrectCheckin(toLocal(session.checkin_time));
    setCorrectCheckout(toLocal(session.checkout_time));
    setCorrectNote(session.admin_note ?? "");
    setApprovalError(null); setApprovalSuccess(null);
    setTimeout(() => document.getElementById("correct-form-anchor")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function handleRejectSession(e) {
    e.preventDefault();
    if (!rejectingId) return;
    setApprovalBusy(true); setApprovalError(null); setApprovalSuccess(null);
    try {
      await apiClient.patch(`/admin/approvals/work-sessions/${rejectingId}/reject`, {
        rejection_reason: rejectReason.trim(),
      });
      setApprovalSuccess("Schicht abgelehnt.");
      setRejectingId(null); setRejectReason("");
      await Promise.all([refreshAdminData(), fetchApprovals()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setApprovalError(typeof d === "string" ? d : "Ablehnen fehlgeschlagen.");
    } finally { setApprovalBusy(false); }
  }

  async function handleCorrectSession(e) {
    e.preventDefault();
    if (!correctingSession) return;
    if (correctCheckin >= correctCheckout) {
      setApprovalError("Check-out muss nach Check-in liegen.");
      return;
    }
    setApprovalBusy(true); setApprovalError(null); setApprovalSuccess(null);
    try {
      await apiClient.patch(`/admin/approvals/work-sessions/${correctingSession.id}/correct`, {
        checkin_time:  new Date(correctCheckin).toISOString(),
        checkout_time: new Date(correctCheckout).toISOString(),
        admin_note:    correctNote.trim() || null,
      });
      setApprovalSuccess("Schicht korrigiert und genehmigt.");
      setCorrectingSession(null);
      setCorrectCheckin(""); setCorrectCheckout(""); setCorrectNote("");
      await Promise.all([refreshAdminData(), fetchApprovals()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setApprovalError(typeof d === "string" ? d : "Korrektur fehlgeschlagen.");
    } finally { setApprovalBusy(false); }
  }

  async function handleDeleteSession(id, employeeLabel) {
    if (
      !confirm(
        `Arbeitssession für „${employeeLabel}“ wirklich löschen?\nDie Roh-Stempel (Check-in / Check-out) bleiben in der Zeiterfassung erhalten.`,
      )
    ) {
      return;
    }
    setApprovalBusy(true);
    setApprovalError(null);
    setApprovalSuccess(null);
    try {
      await apiClient.delete(`/admin/approvals/work-sessions/${id}`);
      if (correctingSession?.id === id) {
        setCorrectingSession(null);
        setCorrectCheckin("");
        setCorrectCheckout("");
        setCorrectNote("");
      }
      setApprovalSuccess("Session gelöscht.");
      await Promise.all([refreshAdminData(), fetchApprovals()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setApprovalError(typeof d === "string" ? d : "Löschen fehlgeschlagen.");
    } finally {
      setApprovalBusy(false);
    }
  }

  // ── Overdue-checkout handlers ─────────────────────────────────────────────
  async function handleForceCheckout(checkinLogId) {
    setApprovalBusy(true); setApprovalError(null); setApprovalSuccess(null);
    try {
      await apiClient.post(`/admin/approvals/overdue-checkouts/${checkinLogId}/force-checkout`);
      setApprovalSuccess("Manueller Checkout wurde durchgeführt. Schicht ist jetzt ausstehend.");
      await Promise.all([fetchOverdueCheckouts(), refreshAdminData()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setApprovalError(typeof d === "string" ? d : "Manueller Checkout fehlgeschlagen.");
    } finally { setApprovalBusy(false); }
  }

  async function handleRemindEmployee(checkinLogId) {
    try {
      await apiClient.post(`/admin/approvals/overdue-checkouts/${checkinLogId}/remind`);
      setApprovalSuccess("Erinnerung wurde vermerkt.");
    } catch {
      setApprovalError("Erinnerung fehlgeschlagen.");
    }
  }

  function handleIgnoreOverdue(checkinLogId) {
    setIgnoredOverdueIds((prev) => new Set([...prev, checkinLogId]));
  }

  async function handleApproveLeave(id) {
    setLeaveActionBusy(true);
    setLeaveActionMsg(null);
    setLeaveAdminError(null);
    try {
      await apiClient.patch(`/admin/leave-requests/${id}/approve`);
      setLeaveActionMsg("Urlaub genehmigt.");
      setLeaveRejectingId(null);
      setLeaveRejectReason("");
      await Promise.all([refreshAdminData(), fetchLeaveAdmin()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setLeaveAdminError(typeof d === "string" ? d : "Genehmigung fehlgeschlagen.");
    } finally {
      setLeaveActionBusy(false);
    }
  }

  async function handleRejectLeaveSubmit(e) {
    e.preventDefault();
    if (!leaveRejectingId) return;
    setLeaveActionBusy(true);
    setLeaveActionMsg(null);
    setLeaveAdminError(null);
    try {
      await apiClient.patch(`/admin/leave-requests/${leaveRejectingId}/reject`, {
        rejection_reason: leaveRejectReason.trim(),
      });
      setLeaveActionMsg("Antrag abgelehnt.");
      setLeaveRejectingId(null);
      setLeaveRejectReason("");
      await Promise.all([refreshAdminData(), fetchLeaveAdmin()]);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setLeaveAdminError(typeof d === "string" ? d : "Ablehnen fehlgeschlagen.");
    } finally {
      setLeaveActionBusy(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function locationName(id) {
    if (!id) return "—";
    return locations.find((l) => l.id === id)?.name ?? `#${id}`;
  }
  function locationNames(ids) {
    if (!ids || !ids.length) return "—";
    return ids.map((id) => locationName(id)).join(", ");
  }
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
      const locIds = employee?.assigned_location_ids?.length
        ? employee.assigned_location_ids
        : (employee?.assigned_location_id ? [employee.assigned_location_id] : []);
      const locId = locIds[0];
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


  // ── Guards ────────────────────────────────────────────────────────────────
  if (busy && !statistics && !loadError) {
    return (
      <div className="ad-loading">
        <div className="ad-loading__spinner" />
        <p>Wird geladen…</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="ad-error">
        <p>{loadError}</p>
        <Link to="/employee/dashboard">Zum Mitarbeiter-Dashboard</Link>
      </div>
    );
  }

  const handleLogout = () => { clearToken(); navigate("/login"); };

  const leaveModalEmp =
    leaveModalEmpId != null ? employees.find((e) => e.id === leaveModalEmpId) ?? null : null;

  const empEditEmp =
    empEditId != null ? employees.find((e) => e.id === empEditId) ?? null : null;

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="ad-shell">
      <Sidebar
        active={activeSection}
        onNav={setActiveSection}
        onLogout={handleLogout}
        pendingCount={pendingCount}
        leavePendingCount={leavePendingCount}
      />

      <div className="ad-main">
        <Topbar section={activeSection} user={currentUser} onRefresh={refreshAll} busy={busy} pendingCount={pendingCount} />

        <main className="ad-content">

          {/* ═══════════ DASHBOARD OVERVIEW ═══════════════════════════════ */}
          {activeSection === "dashboard" && (
            <div className="ad-dash-grid">

              {/* ── Row 1: KPI Cards ─────────────────────────────────────── */}
              <div className="ad-kpi-row">
                <StatCard
                  icon="users"
                  label="Mitarbeiter"
                  value={statistics?.total_employees ?? 0}
                  color="blue"
                  sub="Aktive Mitarbeiter"
                  trend={12}
                  sparkValues={[30, 45, 38, 55, 50, 65, statistics?.total_employees ?? 0]}
                />
                <StatCard
                  icon="check"
                  label="Heute eingestempelt"
                  value={statistics?.checked_in_today ?? 0}
                  color="green"
                  sub={statistics?.total_employees
                    ? `${statistics?.active_now ?? 0} aktuell eingestempelt · ${Math.round(((statistics.checked_in_today ?? 0) / statistics.total_employees) * 100)}% mit Stempel heute`
                    : "0% der Belegschaft"}
                  trend={8}
                  sparkValues={[20, 35, 42, 38, 55, 48, statistics?.checked_in_today ?? 0]}
                />
                <StatCard
                  icon="clock"
                  label="Offizielle Arbeitszeit"
                  value={statistics?.official_hours != null
                    ? formatSeconds(statistics.official_hours * 3600)
                    : "0h 00m"}
                  color="purple"
                  sub="Genehmigt + Korrigiert"
                  sparkValues={[10, 25, 40, 35, 55, 60, Math.round((statistics?.official_hours ?? 0) * 10)]}
                />
                <StatCard
                  icon="chart"
                  label="Ausstehende Stunden"
                  value={statistics?.pending_count != null
                    ? `${statistics.pending_count} Session${statistics.pending_count !== 1 ? "s" : ""}`
                    : "0 Sessions"}
                  color="orange"
                  sub={statistics?.pending_hours != null
                    ? `${formatSeconds(statistics.pending_hours * 3600)} warten`
                    : "Keine ausstehenden"}
                  sparkValues={[5, 12, 8, 18, 14, 20, statistics?.pending_count ?? 0]}
                />
              </div>

              {/* ── Row 2: Employee Table (left) + Activity Feed (right) ─── */}
              <div className="ad-dash-main-row">

                {/* Left: Today's employee attendance table */}
                <Card className="ad-card--flex">
                  <div className="ad-card-header">
                    <h3>Aktuelle Mitarbeiter (heute)</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span className="ad-live-dot">Live</span>
                      <button className="ad-show-all-link" onClick={() => setActiveSection("attendance")}>
                        Alle anzeigen →
                      </button>
                    </div>
                  </div>
                  {todayEmployees.length === 0 ? (
                    <div className="ad-empty-state" style={{ flex: 1, justifyContent: "center" }}>
                      <div className="ad-empty-state__icon">{Ico.users}</div>
                      <p className="ad-empty-state__title">Niemand eingestempelt</p>
                      <p className="ad-empty-state__sub">Heute noch keine Anwesenheit erfasst</p>
                    </div>
                  ) : (
                    <div className="ad-table-scroll">
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
                          {todayEmployees.map((row, i) => (
                            <tr key={i}>
                              <td>
                                <div className="ad-user-cell">
                                  <span className="ad-user-cell__avatar" style={row.active ? {} : { background: "#94a3b8", boxShadow: "none" }}>
                                    {row.name[0]?.toUpperCase()}
                                  </span>
                                  <strong>{row.name}</strong>
                                </div>
                              </td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.checkIn ?? "—"}</td>
                              <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.checkOut ?? "—"}</td>
                              <td><strong style={{ fontVariantNumeric: "tabular-nums" }}>{row.workSecs != null ? formatSeconds(row.workSecs) : "—"}</strong></td>
                              <td>
                                <span className={`ad-badge ${row.active ? "ad-badge--green" : "ad-badge--gray"}`}>
                                  {row.active ? "Eingestempelt" : "Ausgestempelt"}
                                </span>
                              </td>
                              <td>
                                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
                                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: row.active ? "#22c55e" : "#94a3b8", flexShrink: 0 }} />
                                  {row.location}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* Right: Activity Feed */}
                <Card className="ad-card--flex">
                  <div className="ad-card-header">
                    <h3>Aktivitäten</h3>
                    <button className="ad-show-all-link" onClick={() => setActiveSection("attendance")}>
                      Alle anzeigen →
                    </button>
                  </div>
                  <div className="ad-activity-scroll">
                    <ActivityFeed attendance={attendance} approvals={approvals} />
                  </div>
                </Card>
              </div>

              {/* ── Row 3: Genehmigungen + Map (left) | Nächste Schichten (right) */}
              <div className="ad-dash-bottom-row">

                {/* Left sub-grid: Genehmigungen + Standorte Live */}
                <div className="ad-dash-bottom-left">

                  {/* Genehmigungen */}
                  <Card className="ad-card--flex">
                    <div className="ad-card-header">
                      <h3>Genehmigungen</h3>
                      {pendingCount > 0 && <span className="ad-badge ad-badge--red">{pendingCount}</span>}
                    </div>
                    <div className="ad-genhm-summary" style={{ flex: 1 }}>
                      <div className="ad-genhm-row">
                        <div className="ad-genhm-icon ad-genhm-icon--orange">⏳</div>
                        <div className="ad-genhm-info">
                          <div className="ad-genhm-label">Ausstehende</div>
                          <div className="ad-genhm-sub">Warten auf Prüfung</div>
                        </div>
                        <span className="ad-genhm-count">{pendingCount}</span>
                      </div>
                      <div className="ad-genhm-row">
                        <div className="ad-genhm-icon ad-genhm-icon--blue">✎</div>
                        <div className="ad-genhm-info">
                          <div className="ad-genhm-label">Korrigierte</div>
                          <div className="ad-genhm-sub">Warten auf Prüfung</div>
                        </div>
                        <span className="ad-genhm-count">{correctedCount}</span>
                      </div>
                      <div className="ad-genhm-row">
                        <div className="ad-genhm-icon ad-genhm-icon--red">✗</div>
                        <div className="ad-genhm-info">
                          <div className="ad-genhm-label">Abgelehnte</div>
                          <div className="ad-genhm-sub">Letzte 7 Tage</div>
                        </div>
                        <span className="ad-genhm-count">{rejectedCount}</span>
                      </div>
                    </div>
                    <button
                      className="ad-btn ad-btn--primary"
                      style={{ width: "100%", marginTop: "auto" }}
                      onClick={() => setActiveSection("approvals")}
                    >
                      Genehmigungen prüfen →
                    </button>
                  </Card>

                  {/* Standorte Live */}
                  <Card className="ad-card--flex">
                    <div className="ad-card-header">
                      <h3>Standorte Live</h3>
                      <button className="ad-show-all-link" onClick={() => setActiveSection("locations")}>
                        Karte öffnen
                      </button>
                    </div>
                    {locations.length > 0 ? (
                      <>
                        <div style={{ borderRadius: "var(--r-md)", overflow: "hidden", flex: 1, minHeight: 0 }}>
                          <MapContainer
                            center={[locations[0].lat, locations[0].lng]}
                            zoom={13}
                            className="ad-dash-map ad-dash-map--sm"
                            style={{ height: "100%", minHeight: "140px" }}
                          >
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                            {locations.map((loc) => (
                              <React.Fragment key={loc.id}>
                                <Marker position={[loc.lat, loc.lng]} />
                                <Circle
                                  center={[loc.lat, loc.lng]}
                                  radius={loc.radius_meters}
                                  pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.15, weight: 2 }}
                                />
                              </React.Fragment>
                            ))}
                          </MapContainer>
                        </div>
                        <div className="ad-map-legend">
                          <div className="ad-map-legend-item"><span className="ad-map-legend-dot ad-map-legend-dot--green" /> Aktiv</div>
                          <div className="ad-map-legend-item"><span className="ad-map-legend-dot ad-map-legend-dot--gray" /> Inaktiv</div>
                          <div className="ad-map-legend-item"><span className="ad-map-legend-dot ad-map-legend-dot--blue" /> Standort</div>
                        </div>
                      </>
                    ) : (
                      <div className="ad-empty-state ad-empty-state--sm" style={{ flex: 1, justifyContent: "center" }}>
                        <div className="ad-empty-state__icon">{Ico.map}</div>
                        <p className="ad-empty-state__title">Keine Standorte</p>
                        <button className="ad-btn ad-btn--primary ad-btn--sm" onClick={() => setActiveSection("locations")}>
                          Standort hinzufügen
                        </button>
                      </div>
                    )}
                  </Card>
                </div>

                {/* Right: Nächste Schichten */}
                <Card className="ad-card--flex">
                  <div className="ad-card-header">
                    <h3>Nächste Schichten</h3>
                    <button className="ad-btn ad-btn--ghost ad-btn--sm" onClick={() => setActiveSection("planning")}>
                      Alle →
                    </button>
                  </div>
                  <div className="ad-shifts-scroll">
                    <NextShiftsContent shifts={shifts} onNav={setActiveSection} />
                  </div>
                </Card>
              </div>

            </div>
          )}

          {activeSection === "employees" && (
            <div className="ad-section">
              <SectionTitle
                title="Mitarbeiter"
                action={
                  <button className="ad-btn ad-btn--primary" onClick={() => setShowNewEmpForm(!showNewEmpForm)}>
                    <span className="ad-btn__icon">{Ico.plus}</span> Neuer Mitarbeiter
                  </button>
                }
              />

              {/* Create form */}
              {showNewEmpForm && (
                <Card>
                  <h3 className="ad-form-title">Neuen Mitarbeiter anlegen</h3>
                  <form className="ad-form-grid" onSubmit={handleCreateEmployee}>
                    <div className="ad-field">
                      <label>Name *</label>
                      <input className="ad-input" placeholder="Vollständiger Name" value={newEmpName}
                        onChange={(e) => setNewEmpName(e.target.value)} disabled={empFormBusy} required />
                    </div>
                    <div className="ad-field">
                      <label>E-Mail *</label>
                      <input className="ad-input" type="email" placeholder="name@firma.de" value={newEmpEmail}
                        onChange={(e) => setNewEmpEmail(e.target.value)} disabled={empFormBusy} required />
                    </div>
                    <div className="ad-field">
                      <label>Passwort *</label>
                      <input className="ad-input" type="password" placeholder="mind. 8 Zeichen" value={newEmpPassword}
                        onChange={(e) => setNewEmpPassword(e.target.value)} disabled={empFormBusy} minLength={8} required />
                    </div>
                    <div className="ad-field">
                      <label>Urlaubstage / Jahr</label>
                      <input
                        className="ad-input"
                        type="text"
                        inputMode="numeric"
                        placeholder="Leer = System-Standard (siehe .env DEFAULT_ANNUAL_LEAVE_DAYS)"
                        value={newEmpAnnual}
                        onChange={(e) => setNewEmpAnnual(e.target.value)}
                        disabled={empFormBusy}
                      />
                    </div>
                    <div className="ad-field ad-field--actions">
                      <button type="submit" className="ad-btn ad-btn--primary" disabled={empFormBusy}>
                        {empFormBusy ? "Wird angelegt…" : "Anlegen"}
                      </button>
                      <button type="button" className="ad-btn ad-btn--ghost" onClick={() => setShowNewEmpForm(false)}>
                        Abbrechen
                      </button>
                    </div>
                  </form>
                  {empFormError && <p className="ad-alert">{empFormError}</p>}
                </Card>
              )}

              {/* Table */}
              <Card>
                <div className="ad-table-wrap">
                  <table className="ad-table">
                    <thead>
                      <tr>
                        <th>Mitarbeiter</th>
                        <th>Telefon</th>
                        <th>Rolle</th>
                        <th>Standort</th>
                        <th>Status</th>
                        <th>Urlaub übrig</th>
                        <th>Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.length === 0
                        ? <tr><td colSpan={7} className="ad-empty">Keine Mitarbeiter.</td></tr>
                        : employees.map((row) => (
                          <tr key={row.id} className={!row.is_active ? "ad-table__row--muted" : ""}>
                            <td>
                              <div className="ad-user-cell">
                                <span className="ad-user-cell__avatar">{row.name[0].toUpperCase()}</span>
                                <div>
                                  <strong>{row.name}</strong>
                                  <br /><small>{row.email}</small>
                                </div>
                              </div>
                            </td>
                            <td>{row.phone || "—"}</td>
                            <td><Badge type={row.role} /></td>
                            <td>{locationNames(row.assigned_location_ids)}</td>
                            <td><Badge type={row.is_active ? "active" : "inactive"} /></td>
                            <AdminEmployeeLeaveMeterCell row={row} />
                            <td>
                              <div className="ad-actions ad-actions--emp">
                                <button
                                  type="button"
                                  className="ad-btn ad-btn--sm ad-btn--hours"
                                  onClick={() => openHoursModal(row)}
                                  title="Arbeitszeit diesen Monat"
                                >
                                  {(row.hours_official_month ?? 0).toFixed(1).replace(/\.0$/, "")}/{row.hours_target_month ?? 160}
                                </button>
                                <button type="button" className="ad-btn ad-btn--sm ad-btn--ghost" onClick={() => handleEditEmployee(row)}>Bearbeiten</button>
                                <button
                                  type="button"
                                  className="ad-btn ad-btn--sm ad-btn--urlaub"
                                  onClick={() => openEmployeeLeaveModal(row)}
                                  title="Urlaubstage und Kontingent"
                                >
                                  Urlaub
                                </button>
                                <button className={`ad-btn ad-btn--sm ${row.is_active ? "ad-btn--danger" : "ad-btn--success"}`}
                                  onClick={() => handleToggleActive(row)}>
                                  {row.is_active ? "Deaktivieren" : "Aktivieren"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ═══════════ ATTENDANCE ═══════════════════════════════════════ */}
          {activeSection === "attendance" && (
            <div className="ad-section">
              <SectionTitle title="Zeiterfassung" />

              {/* ── Filterleiste ── */}
              <Card>
                <div className="ad-att-filters">
                  <div className="ad-att-filters__row">
                    {/* Autocomplete-Suche */}
                    <div
                      className="ad-att-filters__field ad-att-filters__field--search ad-att-ac"
                      ref={attSearchRef}
                    >
                      <label className="ad-att-filters__label">Name / E-Mail</label>
                      <div className="ad-att-filters__input-wrap">
                        <span className="ad-att-filters__icon">{Ico.search}</span>
                        <input
                          className="ad-input ad-att-filters__input"
                          type="text"
                          placeholder="Mitarbeiter suchen…"
                          value={attendanceSearch}
                          autoComplete="off"
                          onChange={(e) => {
                            setAttendanceSearch(e.target.value);
                            setAttendanceSuggestOpen(true);
                          }}
                          onFocus={() => {
                            if (attendanceSearch.trim()) setAttendanceSuggestOpen(true);
                          }}
                        />
                        {attendanceSearch && (
                          <button
                            type="button"
                            className="ad-att-ac__clear"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setAttendanceSearch("");
                              setAttendanceSuggestOpen(false);
                            }}
                          >
                            {Ico.x}
                          </button>
                        )}
                      </div>

                      {/* Vorschlagsliste */}
                      {attendanceSuggestOpen && attendanceSuggestions.length > 0 && (
                        <ul className="ad-att-ac__list">
                          {attendanceSuggestions.map((emp, i) => (
                            <li
                              key={i}
                              className="ad-att-ac__item"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setAttendanceSearch(emp.name);
                                setAttendanceSuggestOpen(false);
                              }}
                            >
                              <span className="ad-att-ac__name">{emp.name}</span>
                              <span className="ad-att-ac__email">{emp.email}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Typ */}
                    <div className="ad-att-filters__field">
                      <label className="ad-att-filters__label">Typ</label>
                      <select
                        className="ad-input ad-att-filters__select"
                        value={attendanceTypeFilter}
                        onChange={(e) => setAttendanceTypeFilter(e.target.value)}
                      >
                        <option value="all">Alle</option>
                        <option value="checkin">Check-In</option>
                        <option value="checkout">Check-Out</option>
                      </select>
                    </div>

                    {/* Datum von */}
                    <div className="ad-att-filters__field">
                      <label className="ad-att-filters__label">Datum von</label>
                      <input
                        className="ad-input ad-att-filters__input"
                        type="date"
                        value={attendanceDateFrom}
                        onChange={(e) => {
                          const newFrom = e.target.value;
                          setAttendanceDateFrom(newFrom);
                          // "bis" liegt vor neuem "von" → automatisch leeren
                          if (newFrom && attendanceDateTo && attendanceDateTo < newFrom) {
                            setAttendanceDateTo("");
                          }
                          setAttendanceDateError(null);
                        }}
                      />
                    </div>

                    {/* Datum bis */}
                    <div className="ad-att-filters__field">
                      <label className="ad-att-filters__label">Datum bis</label>
                      <input
                        className={`ad-input ad-att-filters__input${attendanceDateError ? " ad-input--error" : ""}`}
                        type="date"
                        value={attendanceDateTo}
                        min={attendanceDateFrom || undefined}
                        onChange={(e) => {
                          const newTo = e.target.value;
                          if (attendanceDateFrom && newTo && newTo < attendanceDateFrom) {
                            setAttendanceDateError("Das Bis-Datum darf nicht vor dem Von-Datum liegen.");
                          } else {
                            setAttendanceDateError(null);
                          }
                          setAttendanceDateTo(newTo);
                        }}
                      />
                    </div>

                    {/* Zurücksetzen */}
                    <div className="ad-att-filters__field ad-att-filters__field--reset">
                      <label className="ad-att-filters__label">&nbsp;</label>
                      <button
                        className="ad-btn ad-btn--ghost ad-att-filters__reset"
                        onClick={() => {
                          setAttendanceSearch("");
                          setAttendanceTypeFilter("all");
                          setAttendanceDateFrom("");
                          setAttendanceDateTo("");
                          setAttendanceDateError(null);
                          setAttendanceSuggestOpen(false);
                        }}
                      >
                        {Ico.refresh} Zurücksetzen
                      </button>
                    </div>
                  </div>

                  {/* Fehlermeldung Datumsbereich */}
                  {attendanceDateError && (
                    <p className="ad-att-filters__date-error">{attendanceDateError}</p>
                  )}

                  {/* Zähler */}
                  <p className="ad-att-filters__count">
                    Zeige <strong>{filteredAttendanceLogs.length}</strong> von <strong>{attendance.length}</strong> Stempelungen
                  </p>
                </div>
              </Card>

              {/* ── Tabelle ── */}
              <Card>
                <div className="ad-table-wrap ad-table-wrap--scroll">
                  <table className="ad-table">
                    <thead>
                      <tr>
                        <th>Mitarbeiter</th>
                        <th>E-Mail</th>
                        <th>Typ</th>
                        <th>Zeit</th>
                        <th>GPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAttendanceLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="ad-empty">
                            {attendance.length === 0
                              ? "Keine Daten vorhanden."
                              : "Keine Stempelungen für die ausgewählten Filter gefunden."}
                          </td>
                        </tr>
                      ) : (
                        filteredAttendanceLogs.map((row, i) => (
                          <tr key={i}>
                            <td><strong>{row.employee_name}</strong></td>
                            <td>{row.employee_email}</td>
                            <td><Badge type={row.type} /></td>
                            <td>{formatTime(row.created_at)}</td>
                            <td className="ad-mono">{row.lat?.toFixed(5)}, {row.lng?.toFixed(5)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ═══════════ LOCATIONS ════════════════════════════════════════ */}
          {activeSection === "locations" && (
            <div className="ad-section">
              <SectionTitle title="Standorte (Geofencing)" />

              {/* ── Adresssuche ── */}
              <form className="ad-loc-search" onSubmit={handleSearchAddress}>
                <span className="ad-loc-search__icon">{Ico.pin}</span>
                <input
                  className="ad-input ad-loc-search__input"
                  placeholder="Adresse oder Standort suchen… z. B. Hauptstraße 15, Köln"
                  value={locSearchQuery}
                  onChange={(e) => { setLocSearchQuery(e.target.value); setLocSearchError(null); }}
                  disabled={locSearchBusy}
                />
                <button
                  type="submit"
                  className="ad-btn ad-btn--primary ad-loc-search__btn"
                  disabled={locSearchBusy || !locSearchQuery.trim()}
                >
                  {locSearchBusy ? "Suche…" : "Suchen"}
                </button>
              </form>
              {locSearchError && (
                <p className="ad-alert ad-loc-search__error">{locSearchError}</p>
              )}

              <p className="ad-hint">
                Adresse suchen → Karte springt automatisch · oder direkt auf die Karte klicken
                {locRevGeocodeBusy && " · Adresse wird ermittelt…"}
              </p>

              <div className="ad-loc-layout">
                {/* Map */}
                <Card>
                  <MapContainer center={DEFAULT_CENTER} zoom={13} className="ad-loc-map">
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                    <MapClickHandler onMapClick={handleMapClick} />
                    {mapPosition && (<>
                      <MapFlyTo position={mapPosition} zoom={mapFlyZoom} />
                      <Marker position={mapPosition} />
                      <Circle center={mapPosition} radius={Number(locRadius)||200}
                        pathOptions={{color:"#2563eb",fillColor:"#2563eb",fillOpacity:0.12}} />
                    </>)}
                    {locations.map((loc) => locEditId===loc.id ? null : (
                      <Circle key={loc.id} center={[loc.lat,loc.lng]} radius={loc.radius_meters}
                        pathOptions={{color:"#94a3b8",fillColor:"#94a3b8",fillOpacity:0.1}} />
                    ))}
                  </MapContainer>
                  <p className="ad-map-hint">
                    Karte anklicken → Koordinaten &amp; Adresse werden automatisch gesetzt
                  </p>
                </Card>

                {/* Form */}
                <Card>
                  <h3 className="ad-form-title">{locEditId !== null ? "Standort bearbeiten" : "Neuer Standort"}</h3>
                  <form className="ad-loc-form" onSubmit={handleSaveLocation}>
                    <div className="ad-field"><label>Name *</label>
                      <input className="ad-input" placeholder="z. B. Hauptsitz" value={locName}
                        onChange={(e) => setLocName(e.target.value)} disabled={locFormBusy} required /></div>
                    <div className="ad-field">
                      <label>
                        Adresse
                        {locRevGeocodeBusy && (
                          <span className="ad-field__hint"> · wird ermittelt…</span>
                        )}
                      </label>
                      <input
                        className="ad-input"
                        placeholder="Wird bei Suche / Kartenklick automatisch gesetzt"
                        value={locAddress}
                        onChange={(e) => setLocAddress(e.target.value)}
                        disabled={locFormBusy}
                      />
                    </div>
                    <div className="ad-form-row">
                      <div className="ad-field"><label>Breitengrad *</label>
                        <input className="ad-input" placeholder="52.5200" value={locLat}
                          onChange={(e) => { setLocLat(e.target.value); const v=parseFloat(e.target.value); if(!isNaN(v)&&locLng) { setMapPosition([v,parseFloat(locLng)]); setMapFlyZoom(null); } }}
                          disabled={locFormBusy} required /></div>
                      <div className="ad-field"><label>Längengrad *</label>
                        <input className="ad-input" placeholder="13.4050" value={locLng}
                          onChange={(e) => { setLocLng(e.target.value); const v=parseFloat(e.target.value); if(!isNaN(v)&&locLat) { setMapPosition([parseFloat(locLat),v]); setMapFlyZoom(null); } }}
                          disabled={locFormBusy} required /></div>
                    </div>
                    <div className="ad-field"><label>Radius (Meter) *</label>
                      <input className="ad-input" placeholder="200" value={locRadius}
                        onChange={(e) => setLocRadius(e.target.value)} disabled={locFormBusy} min="1" max="50000" required /></div>
                    {locFormError && <p className="ad-alert">{locFormError}</p>}
                    <div className="ad-actions" style={{marginTop:"0.5rem"}}>
                      <button type="submit" className="ad-btn ad-btn--primary" disabled={locFormBusy}>
                        {locFormBusy ? "…" : locEditId !== null ? "Speichern" : "Anlegen"}
                      </button>
                      {locEditId !== null && (
                        <button type="button" className="ad-btn ad-btn--ghost" onClick={handleCancelLocEdit}>Abbrechen</button>
                      )}
                    </div>
                  </form>
                </Card>
              </div>

              {/* Locations table */}
              <Card style={{marginTop:"1.25rem"}}>
                <div className="ad-table-wrap">
                  <table className="ad-table">
                    <thead><tr><th>Name</th><th>Adresse</th><th>Koordinaten</th><th>Radius</th><th>Aktionen</th></tr></thead>
                    <tbody>
                      {locations.length === 0
                        ? <tr><td colSpan={5} className="ad-empty">Keine Standorte.</td></tr>
                        : locations.map((row) => (
                          <tr key={row.id} className={locEditId===row.id?"ad-table__row--active":""}>
                            <td><strong>{row.name}</strong></td>
                            <td>{row.address||"—"}</td>
                            <td className="ad-mono">{row.lat.toFixed(5)}, {row.lng.toFixed(5)}</td>
                            <td>{row.radius_meters}m</td>
                            <td>
                              <div className="ad-actions">
                                <button className="ad-btn ad-btn--sm ad-btn--ghost" onClick={() => handleEditLocation(row)}>Bearbeiten</button>
                                <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={() => handleDeleteLocation(row.id,row.name)}>Löschen</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ═══════════ REPORTS ══════════════════════════════════════════ */}
          {activeSection === "reports" && (
            <div className="ad-section">
              <SectionTitle title="Report Center" />

              {/* Quick filters */}
              <div className="ad-report-quick">
                {[
                  { key: "today",     label: "Heute" },
                  { key: "week",      label: "Diese Woche" },
                  { key: "month",     label: "Dieser Monat" },
                  { key: "lastMonth", label: "Letzter Monat" },
                  { key: "custom",    label: "Benutzerdefiniert" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`ad-report-quick__btn${reportQuickFilter === key ? " ad-report-quick__btn--active" : ""}`}
                    onClick={() => handleReportQuickFilter(key)}
                    disabled={reportBusy}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* KPI cards */}
              <div className="ad-report-kpi-grid">
                <div className="ad-report-kpi ad-report-kpi--blue">
                  <span className="ad-report-kpi__icon">{Ico.clock}</span>
                  <div>
                    <div className="ad-report-kpi__value">{reportData ? `${reportData.total_hours}h` : "—"}</div>
                    <div className="ad-report-kpi__label">Gesamtstunden</div>
                  </div>
                </div>
                <div className="ad-report-kpi ad-report-kpi--green">
                  <span className="ad-report-kpi__icon">{Ico.check}</span>
                  <div>
                    <div className="ad-report-kpi__value">{reportData ? `${reportData.approved_total_hours}h` : "—"}</div>
                    <div className="ad-report-kpi__label">Genehmigte Stunden</div>
                  </div>
                </div>
                <div className="ad-report-kpi ad-report-kpi--orange">
                  <span className="ad-report-kpi__icon">{Ico.bell}</span>
                  <div>
                    <div className="ad-report-kpi__value">
                      {reportData
                        ? reportData.employees.flatMap((e) => e.sessions).filter((s) => s.work_session_status === "pending").length
                        : "—"}
                    </div>
                    <div className="ad-report-kpi__label">Ausstehende Sitzungen</div>
                  </div>
                </div>
                <div className="ad-report-kpi ad-report-kpi--purple">
                  <span className="ad-report-kpi__icon">{Ico.users}</span>
                  <div>
                    <div className="ad-report-kpi__value">{reportData ? reportData.employees.length : "—"}</div>
                    <div className="ad-report-kpi__label">Mitarbeiter mit Einträgen</div>
                  </div>
                </div>
              </div>

              {/* Filter form */}
              <Card>
                <form className="ad-report-form" onSubmit={handleLoadReport}>
                  <div className="ad-field">
                    <label>Mitarbeiter</label>
                    <select className="ad-input ad-select" value={reportEmpId} onChange={(e) => setReportEmpId(e.target.value)} disabled={reportBusy}>
                      <option value="">— Alle Mitarbeiter —</option>
                      {employees.map((e) => <option key={e.id} value={String(e.id)}>{e.name} ({e.email})</option>)}
                    </select>
                  </div>
                  <div className="ad-field">
                    <label>Von</label>
                    <input
                      className={`ad-input${reportDateError ? " ad-input--error" : ""}`}
                      type="date"
                      value={reportStart}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReportStart(val);
                        setReportQuickFilter("custom");
                        if (reportEnd && val > reportEnd) {
                          setReportEnd("");
                          setReportDateError(null);
                        } else {
                          setReportDateError(null);
                        }
                      }}
                      disabled={reportBusy}
                    />
                  </div>
                  <div className="ad-field">
                    <label>Bis</label>
                    <input
                      className={`ad-input${reportDateError ? " ad-input--error" : ""}`}
                      type="date"
                      value={reportEnd}
                      min={reportStart || undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReportEnd(val);
                        setReportQuickFilter("custom");
                        if (reportStart && val < reportStart) {
                          setReportDateError("Das Enddatum darf nicht vor dem Startdatum liegen.");
                        } else {
                          setReportDateError(null);
                        }
                      }}
                      disabled={reportBusy}
                    />
                  </div>
                  <div className="ad-field ad-field--actions">
                    <button type="submit" className="ad-btn ad-btn--primary" disabled={reportBusy || !!reportDateError}>
                      {reportBusy ? "Lädt…" : "Anzeigen"}
                    </button>
                    <button
                      type="button"
                      className="ad-btn ad-btn--ghost"
                      onClick={handleDownloadCsv}
                      disabled={reportBusy || !!reportDateError || !reportData}
                      title={!reportData ? "Zuerst Bericht laden" : "CSV herunterladen"}
                    >
                      <span className="ad-btn__icon">{Ico.download}</span> CSV
                    </button>
                  </div>
                </form>
                {reportDateError && (
                  <p className="ad-report-date-error">{reportDateError}</p>
                )}
              </Card>

              {reportError && <p className="ad-alert" style={{marginTop:"1rem"}}>{reportError}</p>}

              {reportData && (
                <Card style={{marginTop:"1.25rem"}}>
                  <div className="ad-table-wrap ad-table-wrap--scroll">
                    <table className="ad-table">
                      <thead>
                        <tr>
                          <th>Mitarbeiter</th>
                          <th>E-Mail</th>
                          <th>Check-in</th>
                          <th>Check-out</th>
                          <th>Dauer</th>
                          <th>Schicht-Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.employees.every((e) => e.sessions.length === 0) ? (
                          <tr><td colSpan={6} className="ad-empty">Keine Berichtsdaten für diesen Zeitraum gefunden.</td></tr>
                        ) : (
                          reportData.employees.flatMap((emp) =>
                            emp.sessions.map((s, i) => (
                              <tr key={`${emp.employee_id}-${i}`}>
                                <td><strong>{emp.employee_name}</strong></td>
                                <td className="ad-muted">{emp.employee_email}</td>
                                <td className="ad-mono">{formatTime(s.checkin)}</td>
                                <td className="ad-mono">{s.checkout ? formatTime(s.checkout) : "—"}</td>
                                <td>
                                  <strong>{s.duration_hours}h</strong>{" "}
                                  <small className="ad-muted">({formatSeconds(s.duration_seconds)})</small>
                                </td>
                                <td>
                                  <span className={`ad-report-status ad-report-status--${s.work_session_status ?? s.status}`}>
                                    {{
                                      pending:   "Ausstehend",
                                      approved:  "Genehmigt",
                                      rejected:  "Abgelehnt",
                                      corrected: "Korrigiert",
                                      open:      "Offen",
                                      closed:    "Geschlossen",
                                    }[s.work_session_status ?? s.status] ?? (s.work_session_status ?? s.status)}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ═══════════ PLANNING ═════════════════════════════════════════ */}
          {activeSection === "planning" && (
            <div className="ad-section">
              <SectionTitle
                title="Schichtplanung"
                action={
                  <button
                    className="ad-btn ad-btn--primary"
                    onClick={() => {
                      resetShiftForm();
                      setShowShiftForm((v) => !v);
                    }}
                  >
                    <span className="ad-btn__icon">{Ico.plus}</span>
                    Neue Schicht
                  </button>
                }
              />

              {/* ── Erfolgsmeldung ── */}
              {shiftFormSuccess && (
                <p className="ad-success" style={{ marginBottom: "1rem" }}>{shiftFormSuccess}</p>
              )}

              {/* ── Shift form ── */}
              {showShiftForm && (
                <Card id="shift-form-anchor" className="ad-card--highlight">
                  <h3 className="ad-form-title">
                    {shiftEditId !== null ? "Schicht bearbeiten" : "Neue Schicht anlegen"}
                  </h3>
                  <form onSubmit={handleSaveShift}>
                    <div className="ad-form-grid">
                      {/* Mitarbeiter */}
                      <div className="ad-field">
                        <label>Mitarbeiter *</label>
                        <select
                          className="ad-input ad-select"
                          value={shiftEmpId}
                          onChange={(e) => setShiftEmpId(e.target.value)}
                          disabled={shiftFormBusy}
                          required
                        >
                          <option value="">— Mitarbeiter wählen —</option>
                          {employees
                            .filter((emp) => emp.is_active)
                            .map((emp) => (
                              <option key={emp.id} value={String(emp.id)}>
                                {emp.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Standort */}
                      <div className="ad-field">
                        <label>Standort</label>
                        <select
                          className="ad-input ad-select"
                          value={shiftLocId}
                          onChange={(e) => setShiftLocId(e.target.value)}
                          disabled={shiftFormBusy}
                        >
                          <option value="">— kein Standort —</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={String(loc.id)}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Datum */}
                      <div className="ad-field">
                        <label>Datum *</label>
                        <input
                          className="ad-input"
                          type="date"
                          value={shiftDate}
                          onChange={(e) => setShiftDate(e.target.value)}
                          disabled={shiftFormBusy}
                          required
                        />
                      </div>

                      {/* Startzeit */}
                      <div className="ad-field">
                        <label>Startzeit *</label>
                        <input
                          className="ad-input"
                          type="time"
                          value={shiftStart}
                          onChange={(e) => setShiftStart(e.target.value)}
                          disabled={shiftFormBusy}
                          required
                        />
                      </div>

                      {/* Endzeit */}
                      <div className="ad-field">
                        <label>Endzeit *</label>
                        <input
                          className="ad-input"
                          type="time"
                          value={shiftEnd}
                          onChange={(e) => setShiftEnd(e.target.value)}
                          disabled={shiftFormBusy}
                          required
                        />
                      </div>

                      {/* Notiz */}
                      <div className="ad-field">
                        <label>Notiz</label>
                        <input
                          className="ad-input"
                          type="text"
                          placeholder="Optional…"
                          value={shiftNote}
                          onChange={(e) => setShiftNote(e.target.value)}
                          disabled={shiftFormBusy}
                          maxLength={500}
                        />
                      </div>

                      {/* Buttons */}
                      <div className="ad-field ad-field--actions" style={{ gridColumn: "1/-1" }}>
                        <button type="submit" className="ad-btn ad-btn--primary" disabled={shiftFormBusy}>
                          {shiftFormBusy ? "Wird gespeichert…" : shiftEditId !== null ? "Speichern" : "Anlegen"}
                        </button>
                        <button
                          type="button"
                          className="ad-btn ad-btn--ghost"
                          onClick={() => { resetShiftForm(); setShowShiftForm(false); }}
                          disabled={shiftFormBusy}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                    {shiftFormError && <p className="ad-alert">{shiftFormError}</p>}
                  </form>
                </Card>
              )}

              {/* ── Shift table ── */}
              <Card>
                {shifts.length === 0 ? (
                  <p className="ad-empty">Noch keine Schichten angelegt.</p>
                ) : (
                  <div className="ad-table-wrap">
                    <table className="ad-table">
                      <thead>
                        <tr>
                          <th>Mitarbeiter</th>
                          <th>Datum</th>
                          <th>Uhrzeit</th>
                          <th>Standort</th>
                          <th>Notiz</th>
                          <th>Status</th>
                          <th>Aktionen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shifts.map((shift) => {
                          const isToday = shift.shift_date === new Date().toISOString().slice(0, 10);
                          const isPast  = shift.shift_date < new Date().toISOString().slice(0, 10);
                          return (
                            <tr key={shift.id} className={isPast ? "ad-table__row--muted" : ""}>
                              <td>
                                <div className="ad-user-cell">
                                  <span className="ad-user-cell__avatar" style={isPast ? { background: "#94a3b8" } : {}}>
                                    {(shift.employee_name ?? "?")[0].toUpperCase()}
                                  </span>
                                  <strong>{shift.employee_name ?? `#${shift.employee_id}`}</strong>
                                </div>
                              </td>
                              <td>
                                {new Date(shift.shift_date + "T00:00:00").toLocaleDateString("de-DE", {
                                  weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
                                })}
                              </td>
                              <td className="ad-mono ad-shift-time">
                                {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                                {shift.end_time.slice(0, 5) < shift.start_time.slice(0, 5) && (
                                  <span className="ad-badge ad-badge--purple" style={{ marginLeft: "0.4rem" }}>Nacht</span>
                                )}
                              </td>
                              <td>{shift.location_name ?? <span className="ad-muted">—</span>}</td>
                              <td>{shift.note ?? <span className="ad-muted">—</span>}</td>
                              <td>
                                {isToday ? (
                                  <span className="ad-badge ad-badge--green">Heute</span>
                                ) : isPast ? (
                                  <span className="ad-badge ad-badge--gray">Vergangen</span>
                                ) : (
                                  <span className="ad-badge ad-badge--blue">Geplant</span>
                                )}
                              </td>
                              <td>
                                <div className="ad-actions">
                                  <button
                                    className="ad-btn ad-btn--sm ad-btn--ghost"
                                    onClick={() => handleEditShift(shift)}
                                  >
                                    Bearbeiten
                                  </button>
                                  <button
                                    className="ad-btn ad-btn--sm ad-btn--danger"
                                    onClick={() => handleDeleteShift(shift.id)}
                                  >
                                    Löschen
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ═══════════ APPROVALS ════════════════════════════════════════ */}
          {activeSection === "approvals" && (
            <div className="ad-section">
              <SectionTitle title="Genehmigungen" />

              {/* Overdue warning banner */}
              {visibleOverdueCheckouts.length > 0 && approvalFilterStatus !== "overdue" && (
                <div className="ad-overdue-banner">
                  <span className="ad-overdue-banner__icon">{Ico.warning}</span>
                  <span className="ad-overdue-banner__text">
                    <strong>{visibleOverdueCheckouts.length}</strong>{" "}
                    {visibleOverdueCheckouts.length === 1
                      ? "Mitarbeiter hat"
                      : "Mitarbeiter haben"}{" "}
                    nach Schichtende noch nicht ausgecheckt.
                  </span>
                  <button
                    type="button"
                    className="ad-btn ad-btn--sm ad-btn--warning"
                    onClick={() => setApprovalFilterStatus("overdue")}
                  >
                    Anzeigen
                  </button>
                </div>
              )}

              {/* Filter */}
              <Card>
                <form
                  className="ad-report-filter"
                  onSubmit={(e) => { e.preventDefault(); if (!approvalDateError) fetchApprovals(); }}
                >
                  <div className="ad-field">
                    <label>Mitarbeiter</label>
                    <select className="ad-input ad-select" value={approvalFilterEmpId}
                      onChange={(e) => setApprovalFilterEmpId(e.target.value)} disabled={approvalsLoading}>
                      <option value="">— Alle —</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={String(emp.id)}>{emp.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ad-field">
                    <label>Status</label>
                    <select className="ad-input ad-select" value={approvalFilterStatus}
                      onChange={(e) => setApprovalFilterStatus(e.target.value)} disabled={approvalsLoading}>
                      <option value="">— Alle —</option>
                      <option value="pending">Offen / Ausstehend</option>
                      <option value="approved">Genehmigt</option>
                      <option value="corrected">Korrigiert</option>
                      <option value="rejected">Abgelehnt</option>
                      <option value="overdue">Überfälliger Checkout</option>
                    </select>
                  </div>
                  <div className="ad-field">
                    <label>Von</label>
                    <input
                      className={`ad-input${approvalDateError ? " ad-input--error" : ""}`}
                      type="date"
                      value={approvalFilterStart}
                      onChange={(e) => {
                        const val = e.target.value;
                        setApprovalFilterStart(val);
                        if (approvalFilterEnd && val > approvalFilterEnd) {
                          setApprovalFilterEnd("");
                          setApprovalDateError(null);
                        } else {
                          setApprovalDateError(null);
                        }
                      }}
                      disabled={approvalsLoading}
                    />
                  </div>
                  <div className="ad-field">
                    <label>Bis</label>
                    <input
                      className={`ad-input${approvalDateError ? " ad-input--error" : ""}`}
                      type="date"
                      value={approvalFilterEnd}
                      min={approvalFilterStart || undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        setApprovalFilterEnd(val);
                        if (approvalFilterStart && val < approvalFilterStart) {
                          setApprovalDateError("Das Bis-Datum darf nicht vor dem Von-Datum liegen.");
                        } else {
                          setApprovalDateError(null);
                        }
                      }}
                      disabled={approvalsLoading}
                    />
                  </div>
                  <div className="ad-field ad-field--actions">
                    <button
                      type="submit"
                      className="ad-btn ad-btn--primary"
                      disabled={approvalsLoading || !!approvalDateError}
                    >
                      {approvalsLoading ? "Lädt…" : "Filtern"}
                    </button>
                  </div>
                </form>
                {approvalDateError && (
                  <p className="ad-report-date-error">{approvalDateError}</p>
                )}
              </Card>

              {approvalSuccess && <p className="ad-success" style={{ marginTop: "1rem" }}>{approvalSuccess}</p>}
              {approvalError   && <p className="ad-alert"   style={{ marginTop: "1rem" }}>{approvalError}</p>}

              {/* Overdue checkouts table */}
              {approvalFilterStatus === "overdue" ? (
                <Card style={{ marginTop: "1.25rem" }}>
                  {overdueLoading ? (
                    <p className="ad-hint" style={{ padding: "2rem", textAlign: "center" }}>Wird geladen…</p>
                  ) : overdueError ? (
                    <p className="ad-alert">{overdueError}</p>
                  ) : visibleOverdueCheckouts.length === 0 ? (
                    <p className="ad-empty">Keine überfälligen Checkouts gefunden.</p>
                  ) : (
                    <div className="ad-table-wrap ad-table-wrap--scroll">
                      <table className="ad-table">
                        <thead>
                          <tr>
                            <th>Mitarbeiter</th>
                            <th>Check-in</th>
                            <th>Schichtende</th>
                            <th>Überfällig seit</th>
                            <th>Standort</th>
                            <th>Aktionen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleOverdueCheckouts.map((item) => (
                            <tr key={item.checkin_log_id} className="ad-overdue-row">
                              <td><strong>{item.employee_name ?? `#${item.employee_id}`}</strong></td>
                              <td className="ad-mono">{formatTime(item.checkin_time)}</td>
                              <td className="ad-mono">{formatTime(item.shift_end)}</td>
                              <td>
                                <span className="ad-overdue-badge">
                                  {overdueFor(item.shift_end)}
                                </span>
                              </td>
                              <td>{item.location_name ?? "—"}</td>
                              <td>
                                <div className="ad-actions">
                                  <button
                                    className="ad-btn ad-btn--sm ad-btn--ghost"
                                    onClick={() => handleRemindEmployee(item.checkin_log_id)}
                                    disabled={approvalBusy}
                                  >
                                    Erinnern
                                  </button>
                                  <button
                                    className="ad-btn ad-btn--sm ad-btn--warning"
                                    onClick={() => handleForceCheckout(item.checkin_log_id)}
                                    disabled={approvalBusy}
                                  >
                                    Manuell auschecken
                                  </button>
                                  <button
                                    className="ad-btn ad-btn--sm ad-btn--danger"
                                    onClick={() => handleIgnoreOverdue(item.checkin_log_id)}
                                    disabled={approvalBusy}
                                  >
                                    Ignorieren
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ) : (
                /* Work sessions table */
                <Card style={{ marginTop: "1.25rem" }}>
                  {approvalsLoading ? (
                    <p className="ad-hint" style={{ padding: "2rem", textAlign: "center" }}>Wird geladen…</p>
                  ) : approvals.length === 0 ? (
                    <p className="ad-empty">Keine Einträge gefunden.</p>
                  ) : (
                    <div className="ad-table-wrap ad-table-wrap--scroll">
                      <table className="ad-table">
                        <thead>
                          <tr>
                            <th>Mitarbeiter</th>
                            <th>Check-in</th>
                            <th>Check-out</th>
                            <th>Dauer</th>
                            <th>Status</th>
                            <th>Aktionen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {approvals.map((session) => (
                            <tr key={session.id}>
                              <td><strong>{session.employee_name ?? `#${session.employee_id}`}</strong></td>
                              <td className="ad-mono">{formatTime(session.checkin_time)}</td>
                              <td className="ad-mono">{session.checkout_time ? formatTime(session.checkout_time) : "—"}</td>
                              <td>
                                <strong>{(session.duration_seconds / 3600).toFixed(2)}h</strong>
                                {" "}<small className="ad-muted">({formatSeconds(session.duration_seconds)})</small>
                              </td>
                              <td><ApprovalBadge status={session.status} /></td>
                              <td>
                                <div className="ad-actions">
                                  {session.status === "pending" && (
                                    <>
                                      <button className="ad-btn ad-btn--sm ad-btn--success"
                                        onClick={() => handleApproveSession(session.id)} disabled={approvalBusy}>
                                        Genehmigen
                                      </button>
                                      <button className="ad-btn ad-btn--sm ad-btn--danger"
                                        onClick={() => { setRejectingId(session.id); setRejectReason(""); setApprovalError(null); setApprovalSuccess(null); }}
                                        disabled={approvalBusy}>
                                        Ablehnen
                                      </button>
                                    </>
                                  )}
                                  <button className="ad-btn ad-btn--sm ad-btn--ghost"
                                    onClick={() => startCorrect(session)} disabled={approvalBusy}>
                                    Korrigieren
                                  </button>
                                  <button
                                    type="button"
                                    className="ad-btn ad-btn--sm ad-btn--danger"
                                    onClick={() =>
                                      handleDeleteSession(session.id, session.employee_name ?? `#${session.employee_id}`)
                                    }
                                    disabled={approvalBusy}
                                  >
                                    Löschen
                                  </button>
                                </div>
                                {rejectingId === session.id && (
                                  <form className="ad-inline-form" onSubmit={handleRejectSession}>
                                    <input className="ad-input" placeholder="Ablehnungsgrund *"
                                      value={rejectReason}
                                      onChange={(e) => setRejectReason(e.target.value)}
                                      required disabled={approvalBusy} />
                                    <div className="ad-actions">
                                      <button type="submit" className="ad-btn ad-btn--sm ad-btn--danger"
                                        disabled={approvalBusy || !rejectReason.trim()}>
                                        {approvalBusy ? "…" : "Bestätigen"}
                                      </button>
                                      <button type="button" className="ad-btn ad-btn--sm ad-btn--ghost"
                                        onClick={() => { setRejectingId(null); setRejectReason(""); }}>
                                        Abbrechen
                                      </button>
                                    </div>
                                  </form>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {/* Correction form */}
              {correctingSession && (
                <Card id="correct-form-anchor" className="ad-card--highlight" style={{ marginTop: "1.25rem" }}>
                  <h3 className="ad-form-title">
                    Schicht korrigieren — <em>{correctingSession.employee_name}</em>
                  </h3>
                  <form className="ad-form-grid" onSubmit={handleCorrectSession}>
                    <div className="ad-field">
                      <label>Neuer Check-in *</label>
                      <input className="ad-input" type="datetime-local" value={correctCheckin}
                        onChange={(e) => setCorrectCheckin(e.target.value)} disabled={approvalBusy} required />
                    </div>
                    <div className="ad-field">
                      <label>Neuer Check-out *</label>
                      <input className="ad-input" type="datetime-local" value={correctCheckout}
                        onChange={(e) => setCorrectCheckout(e.target.value)} disabled={approvalBusy} required />
                    </div>
                    <div className="ad-field" style={{ gridColumn: "1/-1" }}>
                      <label>Admin-Notiz</label>
                      <input className="ad-input" placeholder="Optional: Begründung für die Korrektur"
                        value={correctNote} onChange={(e) => setCorrectNote(e.target.value)} disabled={approvalBusy} />
                    </div>
                    <div className="ad-field ad-field--actions" style={{ gridColumn: "1/-1" }}>
                      <button type="submit" className="ad-btn ad-btn--primary" disabled={approvalBusy}>
                        {approvalBusy ? "Wird gespeichert…" : "Korrektur speichern"}
                      </button>
                      <button type="button" className="ad-btn ad-btn--ghost"
                        onClick={() => { setCorrectingSession(null); setCorrectCheckin(""); setCorrectCheckout(""); setCorrectNote(""); setApprovalError(null); }}
                        disabled={approvalBusy}>
                        Abbrechen
                      </button>
                    </div>
                  </form>
                </Card>
              )}
            </div>
          )}

          {/* ═══════════ URLAUBSANTRÄGE ════════════════════════════════════ */}
          {activeSection === "leaveRequests" && (
            <div className="ad-section">
              <SectionTitle title="Urlaubanträge" />
              <Card>
                {leaveAdminEmployeeFilter != null && (
                  <div className="ad-leave-filter-banner">
                    <span>
                      Anzeige gefiltert:{" "}
                      <strong>
                        {employees.find((e) => e.id === leaveAdminEmployeeFilter)?.name
                          ?? `ID ${leaveAdminEmployeeFilter}`}
                      </strong>
                    </span>
                    <button
                      type="button"
                      className="ad-btn ad-btn--sm ad-btn--ghost"
                      onClick={() => setLeaveAdminEmployeeFilter(null)}
                    >
                      Alle Mitarbeiter
                    </button>
                  </div>
                )}
                <p className="ad-hint" style={{ marginBottom: "1rem" }}>
                  Mitarbeiter stellen hier Urlaubs- oder Abwesenheitswünsche. Genehmigte Tage werden in deren
                  Urlaubs-Karte (Resttage) berücksichtigt.
                </p>
                {leaveActionMsg && <p className="ad-success" style={{ marginBottom: "0.75rem" }}>{leaveActionMsg}</p>}
                {leaveAdminError && <p className="ad-alert" role="alert" style={{ marginBottom: "0.75rem" }}>{leaveAdminError}</p>}
                {leaveAdminLoading ? (
                  <p className="ad-hint" style={{ padding: "2rem", textAlign: "center" }}>Wird geladen…</p>
                ) : leaveAdminList.length === 0 ? (
                  <p className="ad-empty">Keine Urlaubsanträge vorhanden.</p>
                ) : (
                  <div className="ad-table-wrap ad-table-wrap--scroll">
                    <table className="ad-table">
                      <thead>
                        <tr>
                          <th>Mitarbeiter</th>
                          <th>Von</th>
                          <th>Bis</th>
                          <th>Tage</th>
                          <th>Notiz</th>
                          <th>Status</th>
                          <th>Aktionen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaveAdminList.map((row) => {
                          const d0 = new Date(row.start_date + "T12:00:00");
                          const d1 = new Date(row.end_date + "T12:00:00");
                          const days = Math.round((d1 - d0) / 86400000) + 1;
                          return (
                            <tr key={row.id}>
                              <td><strong>{row.employee_name ?? `#${row.employee_id}`}</strong></td>
                              <td className="ad-mono">{d0.toLocaleDateString("de-DE")}</td>
                              <td className="ad-mono">{d1.toLocaleDateString("de-DE")}</td>
                              <td>{days}</td>
                              <td>{row.note ?? "—"}</td>
                              <td><ApprovalBadge status={row.status} /></td>
                              <td>
                                <div className="ad-actions">
                                  {row.status === "pending" && (
                                    <>
                                      <button
                                        type="button"
                                        className="ad-btn ad-btn--sm ad-btn--success"
                                        onClick={() => handleApproveLeave(row.id)}
                                        disabled={leaveActionBusy}
                                      >
                                        Annehmen
                                      </button>
                                      <button
                                        type="button"
                                        className="ad-btn ad-btn--sm ad-btn--danger"
                                        onClick={() => {
                                          setLeaveRejectingId(row.id);
                                          setLeaveRejectReason("");
                                          setLeaveAdminError(null);
                                          setLeaveActionMsg(null);
                                        }}
                                        disabled={leaveActionBusy}
                                      >
                                        Ablehnen
                                      </button>
                                    </>
                                  )}
                                </div>
                                {leaveRejectingId === row.id && (
                                  <form className="ad-inline-form" onSubmit={handleRejectLeaveSubmit}>
                                    <input
                                      className="ad-input"
                                      placeholder="Ablehnungsgrund *"
                                      value={leaveRejectReason}
                                      onChange={(e) => setLeaveRejectReason(e.target.value)}
                                      required
                                      disabled={leaveActionBusy}
                                    />
                                    <div className="ad-actions">
                                      <button type="submit" className="ad-btn ad-btn--sm ad-btn--danger"
                                        disabled={leaveActionBusy || !leaveRejectReason.trim()}>
                                        {leaveActionBusy ? "…" : "Bestätigen"}
                                      </button>
                                      <button type="button" className="ad-btn ad-btn--sm ad-btn--ghost"
                                        onClick={() => { setLeaveRejectingId(null); setLeaveRejectReason(""); }}>
                                        Abbrechen
                                      </button>
                                    </div>
                                  </form>
                                )}
                                {row.status === "rejected" && row.rejection_reason && (
                                  <p className="ad-muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
                                    Grund: {row.rejection_reason}
                                  </p>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ═══════════ WISSENSDATENBANK ════════════════════════════════ */}
          {activeSection === "knowledge" && (
            <div className="ad-section">
              <SectionTitle title="Wissensdatenbank" />
              <div style={{ maxWidth: 520, margin: "0 auto" }}>
                <Card className="ad-ki-widget">
                  <div style={{ textAlign: "center", padding: "1rem 0 0.5rem" }}>
                    <div className="ad-ki-widget__icon" style={{ margin: "0 auto 1rem" }}>🤖</div>
                    <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.1rem", fontWeight: 700, color: "var(--text)" }}>
                      KI Assistant <span className="ad-ki-widget__beta">Beta</span>
                    </h3>
                    <p className="ad-ki-widget__text" style={{ marginBottom: "1.25rem" }}>
                      Stelle Fragen zu Arbeitsanleitungen, Prozessen oder Richtlinien.<br />
                      Diese Funktion ist in Entwicklung und wird bald verfügbar sein.
                    </p>
                    <button className="ad-btn ad-btn--primary" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
                      Chat bald verfügbar
                    </button>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ═══════════ SETTINGS ═════════════════════════════════════════ */}
          {activeSection === "settings" && (
            <div className="ad-section">
              <SectionTitle title="Einstellungen" />
              <Card>
                <div className="ad-settings-placeholder">
                  {Ico.gear}
                  <p style={{ fontWeight: 600, fontSize: "1rem", color: "#334155", margin: 0 }}>
                    Einstellungen
                  </p>
                  <p>Konfigurationsoptionen werden in einer zukünftigen Version verfügbar sein.</p>
                </div>
              </Card>
            </div>
          )}

        </main>
      </div>

      {hoursModalOpen && hoursModalRow && (
        <div
          className="ad-modal-backdrop"
          role="presentation"
          onClick={(ev) => { if (ev.target === ev.currentTarget && !hoursModalLoading) closeHoursModal(); }}
        >
          <div
            className="ad-modal ad-modal--hours ad-modal--uniform"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ad-hours-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ad-modal__header ad-modal__header--leave">
              <div>
                <h2 id="ad-hours-modal-title" className="ad-modal__title">Arbeitszeit — {hoursModalRow.name}</h2>
                <p className="ad-modal__subtitle">
                  Kalendermonat {new Date().toLocaleString("de-DE", { month: "long", year: "numeric" })} · genehmigte Sessions
                </p>
              </div>
              <button
                type="button"
                className="ad-modal__close ad-modal__close--primary"
                onClick={() => { if (!hoursModalLoading) closeHoursModal(); }}
                aria-label="Schließen"
              >
                ×
              </button>
            </div>
            <div className="ad-modal__body ad-modal__body--leave ad-modal__body--fill">
              <div className="ad-modal__stack-grow">
                <div className="ad-hours-kpi-row">
                <div className="ad-hours-kpi">
                  <span className="ad-hours-kpi__label">Soll (Monat)</span>
                  <strong className="ad-hours-kpi__val">{hoursModalRow.hours_target_month ?? 160} h</strong>
                </div>
                <div className="ad-hours-kpi">
                  <span className="ad-hours-kpi__label">Genehmigt + korrigiert</span>
                  <strong className="ad-hours-kpi__val">{(hoursModalRow.hours_official_month ?? 0).toFixed(2)} h</strong>
                </div>
                <div className="ad-hours-kpi">
                  <span className="ad-hours-kpi__label">Ausstehend (Monat)</span>
                  <strong className="ad-hours-kpi__val">{(hoursModalRow.hours_pending_month ?? 0).toFixed(2)} h</strong>
                </div>
                <div className={`ad-hours-kpi ad-hours-kpi--${(hoursModalRow.hours_diff_month ?? 0) > 0 ? "over" : (hoursModalRow.hours_diff_month ?? 0) < 0 ? "under" : "ok"}`}>
                  <span className="ad-hours-kpi__label">Abweichung</span>
                  <strong className="ad-hours-kpi__val">
                    {(hoursModalRow.hours_diff_month ?? 0) > 0
                      ? `+${(hoursModalRow.hours_diff_month ?? 0).toFixed(2)} h über Soll`
                      : (hoursModalRow.hours_diff_month ?? 0) < 0
                        ? `${(hoursModalRow.hours_diff_month ?? 0).toFixed(2)} h unter Soll`
                        : "0 h — im Soll"}
                  </strong>
                </div>
              </div>
              <p className="ad-hint" style={{ marginBottom: "0.75rem" }}>
                Beschäftigung: <strong>{hoursModalRow.employment_type || "full_time"}</strong>
                {hoursModalRow.target_hours_month != null && hoursModalRow.target_hours_month > 0
                  ? ` · konfiguriert ${hoursModalRow.target_hours_month} Std./Mon.`
                  : null}
              </p>
              {hoursModalError && <p className="ad-alert" role="alert">{hoursModalError}</p>}
              {hoursModalLoading ? (
                <p className="ad-hint">Lade Schichten…</p>
              ) : hoursModalSessions.length === 0 ? (
                <p className="ad-empty">Keine Work-Sessions in diesem Monat.</p>
              ) : (
                <div className="ad-table-wrap ad-table-wrap--scroll ad-hours-modal__table-zone">
                  <table className="ad-table ad-table--compact">
                    <thead>
                      <tr>
                        <th>Check-in</th>
                        <th>Check-out</th>
                        <th>Stunden</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoursModalSessions.map((s) => (
                        <tr key={s.id}>
                          <td className="ad-mono">{formatTime(s.checkin_time)}</td>
                          <td className="ad-mono">{s.checkout_time ? formatTime(s.checkout_time) : "—"}</td>
                          <td>{(s.duration_seconds / 3600).toFixed(2)}</td>
                          <td><ApprovalBadge status={s.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
              <div className="ad-modal__footer ad-modal__footer--modal-end">
                <button type="button" className="ad-btn ad-btn--ghost" onClick={closeHoursModal} disabled={hoursModalLoading}>
                  Schließen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {leaveModalEmpId != null && leaveModalEmp && (
        <div
          className="ad-modal-backdrop"
          role="presentation"
          onClick={(ev) => { if (ev.target === ev.currentTarget && !leaveModalBusy) closeEmployeeLeaveModal(); }}
        >
          <div
            className="ad-modal ad-modal--leave ad-modal--uniform"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ad-leave-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ad-modal__header ad-modal__header--leave">
              <div>
                <h2 id="ad-leave-modal-title" className="ad-modal__title">Urlaub — {leaveModalEmp.name}</h2>
                <p className="ad-modal__subtitle">
                  Kalenderjahr {new Date().getFullYear()} · Zeitzone Europe/Berlin
                </p>
              </div>
              <button
                type="button"
                className="ad-modal__close ad-modal__close--primary"
                onClick={() => { if (!leaveModalBusy) closeEmployeeLeaveModal(); }}
                aria-label="Schließen"
              >
                ×
              </button>
            </div>
            <form className="ad-modal__body ad-modal__body--leave ad-modal__body--fill" onSubmit={handleSaveEmployeeLeaveModal}>
              <div className="ad-modal__stack-grow">
                <AdminLeaveModalStatCards emp={leaveModalEmp} />
                <p className="ad-modal__summary-line">
                  <strong>Kurzüberblick:</strong> noch buchbar <strong>{leaveModalEmp.leave_available ?? 0}</strong> von{" "}
                  <strong>{leaveModalEmp.leave_annual_resolved ?? 0}</strong> Tagen · ausstehend reserviert{" "}
                  <strong>{leaveModalEmp.leave_pending_days_this_year ?? 0}</strong> (
                  {leaveModalEmp.leave_pending_count ?? 0} Anträge)
                </p>
                <div className="ad-field ad-field--leave-annual">
                  <label htmlFor="ad-leave-modal-annual">Urlaubstage / Jahr (Soll)</label>
                  <input
                    id="ad-leave-modal-annual"
                    className="ad-input ad-input--emph"
                    type="text"
                    inputMode="numeric"
                    placeholder="Leer = System-Standard"
                    value={leaveModalAnnual}
                    onChange={(e) => setLeaveModalAnnual(e.target.value)}
                    disabled={leaveModalBusy}
                  />
                </div>
                <button
                  type="button"
                  className="ad-leave-history-link"
                  onClick={() => openLeaveHistoryForEmployee(leaveModalEmp.id)}
                  disabled={leaveModalBusy}
                >
                  <span aria-hidden>🔍</span> Urlaubsverlauf anzeigen
                </button>
                {leaveModalError && <p className="ad-alert" role="alert">{leaveModalError}</p>}
              </div>
              <div className="ad-modal__footer ad-modal__footer--modal-end">
                <button type="submit" className="ad-btn ad-btn--primary" disabled={leaveModalBusy}>
                  {leaveModalBusy ? "…" : "Speichern"}
                </button>
                <button type="button" className="ad-btn ad-btn--ghost" onClick={closeEmployeeLeaveModal} disabled={leaveModalBusy}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {empEditId != null && empEditEmp && (
        <div
          className="ad-modal-backdrop"
          role="presentation"
          onClick={(ev) => { if (ev.target === ev.currentTarget && !editEmpBusy) handleCancelEmpEdit(); }}
        >
          <div
            className="ad-modal ad-modal--emp-edit ad-modal--uniform"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ad-emp-edit-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ad-emp-edit__hero">
              <button
                type="button"
                className="ad-emp-edit__dismiss"
                onClick={() => { if (!editEmpBusy) handleCancelEmpEdit(); }}
                disabled={editEmpBusy}
                aria-label="Schließen"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="ad-emp-edit__hero-inner">
                <div className="ad-emp-edit__avatar" aria-hidden>
                  {empEditEmp.name?.[0] ? empEditEmp.name[0].toUpperCase() : "?"}
                </div>
                <div className="ad-emp-edit__hero-text">
                  <p className="ad-emp-edit__kicker">Mitarbeiter</p>
                  <h2 id="ad-emp-edit-modal-title" className="ad-emp-edit__title">
                    {empEditEmp.name}
                  </h2>
                  <p className="ad-emp-edit__lede">
                    Urlaub über <strong>Urlaub</strong>
                    <span className="ad-emp-edit__lede-dot" aria-hidden> · </span>
                    Arbeitszeit über den <strong>Stunden</strong>-Button
                  </p>
                </div>
              </div>
            </header>

            <form className="ad-emp-edit__form ad-modal__body--fill" onSubmit={handleUpdateEmployee}>
              <div className="ad-modal__stack-grow ad-emp-edit__stack">
              <section className="ad-emp-edit__block" aria-labelledby="ad-emp-edit-sec-stamm">
                <h3 id="ad-emp-edit-sec-stamm" className="ad-emp-edit__block-title">Stammdaten</h3>
                <div className="ad-emp-edit__grid">
                  <div className="ad-emp-edit__field">
                    <label className="ad-emp-edit__label" htmlFor="ad-emp-edit-name">Name</label>
                    <input
                      id="ad-emp-edit-name"
                      className="ad-emp-edit__control"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      disabled={editEmpBusy}
                      required
                      autoComplete="name"
                    />
                  </div>
                  <div className="ad-emp-edit__field">
                    <label className="ad-emp-edit__label" htmlFor="ad-emp-edit-email">E-Mail</label>
                    <input
                      id="ad-emp-edit-email"
                      className="ad-emp-edit__control"
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      disabled={editEmpBusy}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="ad-emp-edit__field ad-emp-edit__field--span2">
                    <label className="ad-emp-edit__label" htmlFor="ad-emp-edit-phone">Telefon</label>
                    <input
                      id="ad-emp-edit-phone"
                      className="ad-emp-edit__control"
                      placeholder="+49 …"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      disabled={editEmpBusy}
                      autoComplete="tel"
                    />
                  </div>
                </div>
              </section>

              <section className="ad-emp-edit__block" aria-labelledby="ad-emp-edit-sec-soll">
                <h3 id="ad-emp-edit-sec-soll" className="ad-emp-edit__block-title">Monatssoll</h3>
                <div className="ad-emp-edit__field">
                  <label className="ad-emp-edit__label" htmlFor="ad-emp-edit-soll">Soll-Stunden / Monat <span className="ad-emp-edit__optional">optional</span></label>
                  <input
                    id="ad-emp-edit-soll"
                    className="ad-emp-edit__control ad-emp-edit__control--mono"
                    type="text"
                    inputMode="numeric"
                    placeholder="Leer lassen oder z. B. 120"
                    value={editMonthlySollHours}
                    onChange={(e) => setEditMonthlySollHours(e.target.value)}
                    disabled={editEmpBusy}
                  />
                  <p className="ad-emp-edit__hint">
                    Nur ausfüllen, wenn das Soll von den Standardwerten abweichen soll (1–200). Leer = automatisches Standard-Soll.
                  </p>
                </div>
              </section>

              <section className="ad-emp-edit__block" aria-labelledby="ad-emp-edit-sec-zugriff">
                <h3 id="ad-emp-edit-sec-zugriff" className="ad-emp-edit__block-title">Zugriff &amp; Status</h3>
                <div className="ad-emp-edit__row">
                  <div className="ad-emp-edit__field ad-emp-edit__field--grow">
                    <span className="ad-emp-edit__label" id="ad-emp-edit-role-lbl">Rolle</span>
                    <div className="ad-emp-edit__segment" role="group" aria-labelledby="ad-emp-edit-role-lbl">
                      <button
                        type="button"
                        className={`ad-emp-edit__segment-btn${editRole === "employee" ? " ad-emp-edit__segment-btn--active" : ""}`}
                        aria-pressed={editRole === "employee"}
                        disabled={editEmpBusy}
                        onClick={() => setEditRole("employee")}
                      >
                        Mitarbeiter
                      </button>
                      <button
                        type="button"
                        className={`ad-emp-edit__segment-btn${editRole === "admin" ? " ad-emp-edit__segment-btn--active" : ""}`}
                        aria-pressed={editRole === "admin"}
                        disabled={editEmpBusy}
                        onClick={() => setEditRole("admin")}
                      >
                        Admin
                      </button>
                    </div>
                  </div>
                  <label className="ad-emp-edit__switch-card">
                    <input
                      type="checkbox"
                      checked={editIsActive}
                      onChange={(e) => setEditIsActive(e.target.checked)}
                      disabled={editEmpBusy}
                    />
                    <span className="ad-emp-edit__switch-card-body">
                      <span className="ad-emp-edit__switch-card-title">Konto aktiv</span>
                      <span className="ad-emp-edit__switch-card-desc">Login und App-Zugang</span>
                    </span>
                  </label>
                </div>
              </section>

              <section className="ad-emp-edit__block" aria-labelledby="ad-emp-edit-sec-orte">
                <h3 id="ad-emp-edit-sec-orte" className="ad-emp-edit__block-title">Standorte</h3>
                <p className="ad-emp-edit__hint ad-emp-edit__hint--tight">Standort antippen, um zu- oder abzuwählen.</p>
                {locations.length > 0 && (
                  <div className="ad-emp-edit__loc-bulk">
                    <button
                      type="button"
                      className="ad-emp-edit__bulk-btn"
                      onClick={selectAllEditLocations}
                      disabled={editEmpBusy}
                    >
                      Alle auswählen
                    </button>
                    <button
                      type="button"
                      className="ad-emp-edit__bulk-btn"
                      onClick={clearAllEditLocations}
                      disabled={editEmpBusy}
                    >
                      Alle abwählen
                    </button>
                  </div>
                )}
                {locations.length === 0 ? (
                  <p className="ad-emp-edit__empty">Zuerst unter „Standorte“ anlegen.</p>
                ) : (
                  <div className="ad-location-pick-grid ad-location-pick-grid--emp-edit" role="group" aria-label="Standorte auswählen">
                    {locations.map((l) => {
                      const idStr = String(l.id);
                      const on = editLocationIds.includes(idStr);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          className={`ad-location-pick${on ? " ad-location-pick--on" : ""}`}
                          aria-pressed={on}
                          disabled={editEmpBusy}
                          onClick={() => toggleEditLocation(l.id)}
                        >
                          <span className="ad-location-pick__check" aria-hidden>{on ? "✓" : ""}</span>
                          <span className="ad-location-pick__name">{l.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {editEmpError && <p className="ad-alert ad-emp-edit__alert" role="alert">{editEmpError}</p>}
              </div>

              <div className="ad-emp-edit__footer">
                <button type="button" className="ad-emp-edit__btn ad-emp-edit__btn--ghost" onClick={handleCancelEmpEdit} disabled={editEmpBusy}>
                  Abbrechen
                </button>
                <button type="submit" className="ad-emp-edit__btn ad-emp-edit__btn--primary" disabled={editEmpBusy}>
                  {editEmpBusy ? "Speichern …" : "Änderungen speichern"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formatters ───────────────────────────────────────────────────────────────
function formatSeconds(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("de-DE");
}
function relativeTime(date) {
  const diff = (Date.now() - date) / 1000;
  if (diff < 60)    return "Gerade eben";
  if (diff < 3600)  return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  return date.toLocaleDateString("de-DE");
}
function overdueFor(shiftEnd) {
  const diffMs = Date.now() - new Date(shiftEnd).getTime();
  if (diffMs < 0) return "—";
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
