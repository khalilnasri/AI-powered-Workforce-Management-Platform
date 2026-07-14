import L from "leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link, useNavigate } from "react-router-dom";
import { apiClient, clearToken } from "../apiClient";
import "./AdminDashboard.css";
import "./emp-layout.css";

// ── Leaflet icon fix ────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── API URLs ────────────────────────────────────────────────────────────────
const EMPLOYEES_URL  = "/admin/employees";
const INVITE_CODES_URL = "/admin/invite-codes";
const LOCATIONS_URL  = "/admin/locations";
const ATTENDANCE_URL = "/admin/attendance";
const STATISTICS_URL = "/admin/statistics";
const SHIFTS_URL     = "/planning/shifts";
const SHIFTS_BULK_URL = "/planning/shifts/bulk";
const REPORTS_URL         = "/admin/reports/attendance";
const REPORTS_SUMMARY_URL = "/admin/reports/summary";
const REPORTS_EXCEL_URL   = "/admin/reports/excel";
const REPORTS_V2_URL        = "/admin/reports/v2/summary";
const REPORTS_V2_EXCEL_URL  = "/admin/reports/v2/excel";
const NOTIF_SETTINGS_URL    = "/admin/notifications/settings";
const NOTIF_CHECK_URL       = "/admin/notifications/check";
const DEFAULT_CENTER = [52.4006, 9.6656];

// ── Report V2 constants ─────────────────────────────────────────────────────
const RC_PIE_COLORS = ["#2563eb","#16a34a","#f59e0b","#dc2626","#7c3aed","#0891b2","#db2777"];
const V2_PAGE_SIZE  = 20;

// ── Mitarbeiter-Avatare: deterministische Farbe pro Name ────────────────────
const AVATAR_PALETTE = ["#1d4ed8","#0f766e","#7c3aed","#c2410c","#0891b2","#be123c","#4338ca","#15803d"];
function avatarColorForName(name) {
  const s = String(name || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// ── Datum-Helfer für die Planungs-Kalenderansicht ────────────────────────────
const PLAN_WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Montag = 0
  x.setDate(x.getDate() - dow);
  return x;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
/** Alle ISO-Datumswerte von fromIso bis toIso (inklusive). */
function datesBetween(fromIso, toIso) {
  if (!fromIso || !toIso || fromIso > toIso) return [];
  const out = [];
  let cur = new Date(fromIso + "T12:00:00");
  const end = new Date(toIso + "T12:00:00");
  while (cur <= end) {
    out.push(toIsoDate(cur));
    cur = addDays(cur, 1);
  }
  return out;
}
function isNightShift(startHHMM, endHHMM) {
  return endHHMM <= startHHMM;
}
function minutesOfDay(hhmmss) {
  const [h, m] = hhmmss.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}
function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6);
  const monthFmt = (d) => d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  if (weekStart.getMonth() === end.getMonth() && weekStart.getFullYear() === end.getFullYear()) {
    return `${weekStart.getDate()}. – ${end.getDate()}. ${monthFmt(end)}`;
  }
  const startFmt = weekStart.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
  return `${startFmt} – ${end.getDate()}. ${monthFmt(end)}`;
}
function formatEmpRole(role) {
  if (!role) return "";
  const r = String(role).toLowerCase();
  if (r === "admin") return "Admin";
  if (r === "employee") return "Mitarbeiter";
  return String(role);
}
function getISOWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day + 3);
  const firstThu = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - firstDay + 3);
  return 1 + Math.round((date.getTime() - firstThu.getTime()) / 604800000);
}
function shiftDurationMinutes(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return endMin - startMin;
}
function shiftDurationLabel(startHHMM, endHHMM) {
  const mins = shiftDurationMinutes(startHHMM, endHHMM);
  const h = mins / 60;
  if (Math.abs(h - Math.round(h)) < 0.05) return `${Math.round(h)} h`;
  return `${h.toFixed(1).replace(".", ",")} h`;
}
function formatWeekHours(totalMinutes) {
  const h = totalMinutes / 60;
  if (Math.abs(h - Math.round(h)) < 0.05) return `${Math.round(h)} h`;
  return `${h.toFixed(1).replace(".", ",")} h`;
}
function employeeMatchesSearch(emp, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (emp.name || "").toLowerCase().includes(q)
    || (emp.email || "").toLowerCase().includes(q);
}
function defaultEmpLocationId(emp) {
  if (!emp) return "";
  if (Array.isArray(emp.assigned_location_ids) && emp.assigned_location_ids.length) {
    return String(emp.assigned_location_ids[0]);
  }
  if (emp.assigned_location_id) return String(emp.assigned_location_id);
  return "";
}

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
function Topbar({ section, user, onRefresh, busy, pendingCount, onNav }) {
  const label = NAV_ITEMS.find((n) => n.id === section)?.label ?? "Dashboard";
  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return (
    <header className="ad-topbar">
      <div className="ad-topbar__left">
        <h1 className="ad-topbar__title">{label}</h1>
        <span className="ad-topbar__date">{dateStr}</span>
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
          <button
            className="ad-topbar__icon-btn"
            title={pendingCount > 0 ? `${pendingCount} Genehmigung${pendingCount > 1 ? "en" : ""} ausstehend` : "Benachrichtigungen"}
            onClick={() => onNav("approvals")}
          >
            {Ico.bell}
          </button>
          {pendingCount > 0 && (
            <span className="ad-topbar__notif-badge">{pendingCount}</span>
          )}
        </div>
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

// ── Planungs-Kalender: Schicht-Block (Wochenraster) ───────────────────────────
function PlanningShiftBlock({ shift, todayIso, onClick }) {
  const start  = shift.start_time.slice(0, 5);
  const end    = shift.end_time.slice(0, 5);
  const night  = isNightShift(start, end);
  const status = shift.shift_date === todayIso ? "today" : shift.shift_date < todayIso ? "past" : "planned";
  const typeLabel = night ? "Nacht" : "Tag";
  return (
    <button
      type="button"
      className={`ad-plan-block ad-plan-block--${night ? "night" : "day"} ad-plan-block--${status}`}
      onClick={onClick}
      title={`${start}–${end}${shift.location_name ? " · " + shift.location_name : ""}`}
    >
      <div className="ad-plan-block__header">
        <span className="ad-plan-block__time ad-mono">{start}–{end}</span>
        <span className="ad-plan-block__dur">{shiftDurationLabel(start, end)}</span>
      </div>
      <span className="ad-plan-block__type">{typeLabel}</span>
      {shift.location_name && (
        <span className="ad-plan-block__loc">{shift.location_name}</span>
      )}
      {shift.note && (
        <span className="ad-plan-block__note">{shift.note}</span>
      )}
    </button>
  );
}

// ── Planungs-Kalender: Wochenraster (Mitarbeiter × Wochentage) ─────────────────
function PlanningWeekGrid({ employees, weekDays, shifts, todayIso, onSlotClick, onShiftClick, emptyMessage }) {
  const shiftsByEmpDate = useMemo(() => {
    const map = new Map();
    for (const s of shifts) {
      const key = `${s.employee_id}|${s.shift_date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [shifts]);

  const weekStatsByEmp = useMemo(() => {
    const weekIsos = new Set(weekDays.map((d) => toIsoDate(d)));
    const map = new Map();
    for (const s of shifts) {
      if (!weekIsos.has(s.shift_date)) continue;
      const key = s.employee_id;
      if (!map.has(key)) map.set(key, { count: 0, minutes: 0 });
      const st = map.get(key);
      st.count += 1;
      st.minutes += shiftDurationMinutes(s.start_time.slice(0, 5), s.end_time.slice(0, 5));
    }
    return map;
  }, [shifts, weekDays]);

  if (employees.length === 0) {
    return <p className="ad-empty">{emptyMessage ?? "Keine aktiven Mitarbeiter für die Planung."}</p>;
  }

  return (
    <div className="ad-plan-grid-wrap">
      <div className="ad-plan-grid">
        <div className="ad-plan-grid__corner">Mitarbeiter</div>
        {weekDays.map((d) => {
          const iso = toIsoDate(d);
          return (
            <div key={iso} className={`ad-plan-grid__head${iso === todayIso ? " ad-plan-grid__head--today" : ""}`}>
              <span className="ad-plan-grid__head-day">{PLAN_WEEKDAY_LABELS[(d.getDay() + 6) % 7]}</span>
              <span className="ad-plan-grid__head-date">
                {d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
              </span>
            </div>
          );
        })}
        <div className="ad-plan-grid__head ad-plan-grid__head--std">Std</div>

        {employees.map((emp) => {
          const stats = weekStatsByEmp.get(emp.id) ?? { count: 0, minutes: 0 };
          return (
            <React.Fragment key={emp.id}>
              <div className="ad-plan-grid__emp">
                <span className="ad-user-cell__avatar" style={{ background: avatarColorForName(emp.name) }}>
                  {(emp.name ?? "?")[0].toUpperCase()}
                </span>
                <span className="ad-plan-grid__emp-info">
                  <span className="ad-plan-grid__emp-name">{emp.name}</span>
                  {emp.role && (
                    <span className="ad-plan-grid__emp-role">{formatEmpRole(emp.role)}</span>
                  )}
                </span>
              </div>
              {weekDays.map((d) => {
                const iso = toIsoDate(d);
                const dayShifts = shiftsByEmpDate.get(`${emp.id}|${iso}`) ?? [];
                return (
                  <div
                    key={iso}
                    className={`ad-plan-cell${iso === todayIso ? " ad-plan-cell--today" : ""}`}
                    onClick={() => onSlotClick(iso, emp.id)}
                  >
                    {dayShifts.map((s) => (
                      <PlanningShiftBlock
                        key={s.id}
                        shift={s}
                        todayIso={todayIso}
                        onClick={(e) => { e.stopPropagation(); onShiftClick(s); }}
                      />
                    ))}
                    <button
                      type="button"
                      className="ad-plan-cell__add"
                      onClick={(e) => { e.stopPropagation(); onSlotClick(iso, emp.id); }}
                      aria-label="Schicht hinzufügen"
                    >
                      {Ico.plus}
                    </button>
                  </div>
                );
              })}
              <div className="ad-plan-grid__std">
                <span className="ad-plan-grid__std-hours">{formatWeekHours(stats.minutes)}</span>
                <span className="ad-plan-grid__std-count">
                  {stats.count} {stats.count === 1 ? "Schicht" : "Schichten"}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── Planungs-Kalender: Tages-Timeline (0–24 Uhr, Nachtschichten über Mitternacht) ─
function PlanningDayTimeline({ employees, shifts, day, onSlotClick, onShiftClick, todayIso, emptyMessage }) {
  const dayIso     = toIsoDate(day);
  const prevDayIso = toIsoDate(addDays(day, -1));

  const rows = useMemo(() => {
    return employees.map((emp) => {
      const bars = [];
      for (const s of shifts) {
        if (s.employee_id !== emp.id) continue;
        const night = isNightShift(s.start_time.slice(0, 5), s.end_time.slice(0, 5));
        if (s.shift_date === dayIso) {
          bars.push({
            shift: s,
            fromMin: minutesOfDay(s.start_time),
            toMin: night ? 24 * 60 : minutesOfDay(s.end_time),
            continuesNextDay: night,
          });
        } else if (night && s.shift_date === prevDayIso) {
          bars.push({
            shift: s,
            fromMin: 0,
            toMin: minutesOfDay(s.end_time),
            continuesFromPrevDay: true,
          });
        }
      }
      bars.sort((a, b) => a.fromMin - b.fromMin);
      return { emp, bars };
    });
  }, [employees, shifts, dayIso, prevDayIso]);

  if (employees.length === 0) {
    return <p className="ad-empty">{emptyMessage ?? "Keine aktiven Mitarbeiter für die Planung."}</p>;
  }

  return (
    <div className="ad-plan-timeline">
      <div className="ad-plan-timeline__head">
        <div className="ad-plan-grid__emp ad-plan-timeline__emp ad-plan-timeline__emp--head">Mitarbeiter</div>
        <div className="ad-plan-timeline__ruler">
          {Array.from({ length: 13 }, (_, i) => i * 2).map((h) => (
            <span key={h} className="ad-plan-timeline__tick" style={{ left: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>
      {rows.map(({ emp, bars }) => (
        <div key={emp.id} className="ad-plan-timeline__row">
          <div className="ad-plan-grid__emp ad-plan-timeline__emp">
            <span className="ad-user-cell__avatar" style={{ background: avatarColorForName(emp.name) }}>
              {(emp.name ?? "?")[0].toUpperCase()}
            </span>
            <span className="ad-plan-grid__emp-name">{emp.name}</span>
          </div>
          <div className="ad-plan-timeline__track" onClick={() => onSlotClick(dayIso, emp.id)}>
            {bars.map(({ shift, fromMin, toMin, continuesNextDay, continuesFromPrevDay }) => {
              const status = shift.shift_date === todayIso ? "today" : shift.shift_date < todayIso ? "past" : "planned";
              return (
                <button
                  type="button"
                  key={shift.id}
                  className={`ad-plan-timeline__bar ad-plan-timeline__bar--${status}${continuesNextDay ? " ad-plan-timeline__bar--night-out" : ""}${continuesFromPrevDay ? " ad-plan-timeline__bar--night-in" : ""}`}
                  style={{ left: `${(fromMin / 1440) * 100}%`, width: `${Math.max(((toMin - fromMin) / 1440) * 100, 2)}%` }}
                  onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}
                  title={`${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}${shift.location_name ? " · " + shift.location_name : ""}`}
                >
                  <span className="ad-mono">{shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
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
function Card({ children, className = "", id, style }) {
  return <div id={id} style={style} className={`ad-card ${className}`}>{children}</div>;
}

// ── MultiSelect ───────────────────────────────────────────────────────────────
function MultiSelect({ options, value, onChange, placeholder = "Auswählen" }) {
  const [open, setOpen] = React.useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function outside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  const toggle = (id) => {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  };
  const allSelected = value.length === 0;
  const label = allSelected
    ? `Alle (${options.length})`
    : value.length === 1
      ? (options.find(o => o.value === value[0])?.label ?? "1 ausgewählt")
      : `${value.length} ausgewählt`;

  return (
    <div className="ad-multiselect" ref={ref}>
      <button type="button" className="ad-multiselect__trigger" onClick={() => setOpen(o => !o)}>
        <span className="ad-multiselect__label">{label}</span>
        <span className="ad-multiselect__arrow">▼</span>
      </button>
      {open && (
        <div className="ad-multiselect__dropdown">
          <div className="ad-multiselect__option ad-multiselect__all" onClick={() => { onChange([]); setOpen(false); }}>
            <input type="checkbox" readOnly checked={allSelected} /> Alle {placeholder}
          </div>
          <div className="ad-multiselect__divider" />
          {options.map(opt => (
            <div key={opt.value} className="ad-multiselect__option" onClick={() => toggle(opt.value)}>
              <input type="checkbox" readOnly checked={value.includes(opt.value)} />
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const [shiftEmpIds,     setShiftEmpIds]     = useState([]);
  const [shiftEmpLocMap,  setShiftEmpLocMap]  = useState({});
  const [shiftEmpSearch,  setShiftEmpSearch]  = useState("");
  const [shiftLocId,      setShiftLocId]      = useState("");
  const [shiftDate,       setShiftDate]       = useState("");
  const [shiftDateTo,     setShiftDateTo]     = useState("");
  const [shiftFormMode,   setShiftFormMode]   = useState("single"); // "single" | "range"
  const [shiftStart,      setShiftStart]      = useState("");
  const [shiftEnd,        setShiftEnd]        = useState("");
  const [shiftNote,       setShiftNote]       = useState("");
  const [shiftFormError,   setShiftFormError]   = useState(null);
  const [shiftFormSuccess, setShiftFormSuccess] = useState(null);
  const [shiftFormBusy,    setShiftFormBusy]    = useState(false);
  const [showShiftForm,    setShowShiftForm]    = useState(false);

  // ── Planungs-Kalender (Woche/Tag) ────────────────────────────────────────
  const [planView,      setPlanView]      = useState("week"); // "week" | "day"
  const [planEmpFilter, setPlanEmpFilter] = useState("");
  const [planWeekStart, setPlanWeekStart] = useState(() => startOfWeek(new Date()));
  const [planDay,       setPlanDay]       = useState(() => new Date());

  // ── Employee form ─────────────────────────────────────────────────────────
  const [newEmpName, setNewEmpName]         = useState("");
  const [newEmpEmail, setNewEmpEmail]       = useState("");
  const [newEmpPassword, setNewEmpPassword] = useState("");
  const [newEmpAnnual, setNewEmpAnnual]     = useState("");
  const [empFormError, setEmpFormError]     = useState(null);
  const [empFormBusy, setEmpFormBusy]       = useState(false);
  // Purely visual: which row is highlighted in the employee list panel
  const [selectedEmpId, setSelectedEmpId]   = useState(null);
  const [empListSearch, setEmpListSearch]   = useState("");
  // Mitarbeiter-Seite: Tab-Leiste (verwalten / anlegen / Einladungscodes)
  const [empTab, setEmpTab] = useState("manage");

  // ── Einladungscodes ───────────────────────────────────────────────────────
  const [inviteCode, setInviteCode]           = useState(null);
  const [inviteCodeBusy, setInviteCodeBusy]   = useState(false);
  const [inviteCodeError, setInviteCodeError] = useState(null);
  const [inviteCodeCopied, setInviteCodeCopied] = useState(false);

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

  /** Bestätigung vor endgültigem Löschen eines Mitarbeiters */
  const [empDeactivateModal, setEmpDeactivateModal] = useState(null);
  const [empDeactivateBusy, setEmpDeactivateBusy] = useState(false);

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

  // ── Chart-Filter ──────────────────────────────────────────────────────────
  const _now = new Date();
  const [chartMonth,      setChartMonth]      = useState(String(_now.getMonth() + 1));
  const [chartYear,       setChartYear]       = useState(String(_now.getFullYear()));
  const [chartLocationId, setChartLocationId] = useState("");
  const [chartEmpId,      setChartEmpId]      = useState("");
  const [chartData,       setChartData]       = useState(null);
  const [chartLoading,    setChartLoading]    = useState(false);
  const [chartError,      setChartError]      = useState(null);

  // ── Report V2 ────────────────────────────────────────────────────────────
  const _nowV2    = new Date();
  const _isoMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const _isoEnd   = (d) => {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  };
  const [v2EmpIds,   setV2EmpIds]   = useState([]);
  const [v2LocIds,   setV2LocIds]   = useState([]);
  const [v2FromDate, setV2FromDate] = useState(_isoMonth(_nowV2));
  const [v2ToDate,   setV2ToDate]   = useState(_isoEnd(_nowV2));
  const [v2Grouping, setV2Grouping] = useState("daily");
  const [v2Report,   setV2Report]   = useState(null);
  const [v2Loading,  setV2Loading]  = useState(false);
  const [v2Error,    setV2Error]    = useState(null);
  const [v2Page,     setV2Page]     = useState(1);

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

  // ── Notification Settings ─────────────────────────────────────────────────
  const [notifEnabled,     setNotifEnabled]     = useState(false);
  const [notifHours,       setNotifHours]       = useState(12);
  const [notifEmail,       setNotifEmail]       = useState("");
  const [notifSaving,      setNotifSaving]      = useState(false);
  const [notifSaveOk,      setNotifSaveOk]      = useState(false);
  const [notifSaveErr,     setNotifSaveErr]     = useState(null);
  const [notifChecking,    setNotifChecking]    = useState(false);
  const [notifCheckResult, setNotifCheckResult] = useState(null);
  const [notifCheckErr,    setNotifCheckErr]    = useState(null);
  const [notifSmtpReady,   setNotifSmtpReady]   = useState(null);

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

  // ── Planungs-Kalender: abgeleitete Daten ─────────────────────────────────
  const planEmployees = useMemo(
    () => [...employees]
      .filter((e) => e.is_active)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de")),
    [employees],
  );
  const planEmployeesFiltered = useMemo(
    () => planEmployees.filter((e) => employeeMatchesSearch(e, planEmpFilter)),
    [planEmployees, planEmpFilter],
  );
  const shiftEmpPickerList = useMemo(
    () => planEmployees.filter((e) => employeeMatchesSearch(e, shiftEmpSearch)),
    [planEmployees, shiftEmpSearch],
  );
  const shiftSelectedEmployees = useMemo(
    () => planEmployees.filter((e) => shiftEmpIds.includes(String(e.id))),
    [planEmployees, shiftEmpIds],
  );
  const planWeekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(planWeekStart, i)),
    [planWeekStart],
  );
  const planTodayIso = toIsoDate(new Date());
  const planRangeDayCount = useMemo(
    () => (shiftDate && shiftDateTo && shiftDate <= shiftDateTo ? datesBetween(shiftDate, shiftDateTo).length : 0),
    [shiftDate, shiftDateTo],
  );
  const planRangeShiftCount = planRangeDayCount * shiftEmpIds.length;

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
  // Promise.allSettled statt Promise.all: ein einzelner fehlschlagender Endpunkt
  // (z. B. Statistik) darf die anderen State-Updates (z. B. Schichten) nicht
  // verwerfen — sonst wirkt eine neu angelegte Schicht "nicht gespeichert",
  // obwohl sie in der DB längst existiert und erst nach F5 sichtbar wird.
  const refreshAll = useCallback(async () => {
    setLoadError(null); setBusy(true);
    const [eRes, lRes, aRes, sRes, shRes, meRes] = await Promise.allSettled([
      apiClient.get(EMPLOYEES_URL),
      apiClient.get(LOCATIONS_URL),
      apiClient.get(ATTENDANCE_URL),
      apiClient.get(STATISTICS_URL),
      apiClient.get(SHIFTS_URL),
      apiClient.get("/auth/me"),
    ]);

    if (eRes.status === "fulfilled") setEmployees(eRes.value.data ?? []);
    if (lRes.status === "fulfilled") setLocations(lRes.value.data ?? []);
    if (aRes.status === "fulfilled") setAttendance(aRes.value.data ?? []);
    if (sRes.status === "fulfilled") setStatistics(sRes.value.data ?? null);
    if (shRes.status === "fulfilled") setShifts(shRes.value.data ?? []);
    if (meRes.status === "fulfilled") setCurrentUser(meRes.value.data ?? null);

    const failures = [eRes, lRes, aRes, sRes, shRes, meRes].filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0].reason;
      setLoadError(axios.isAxiosError(first) && first.response?.status === 403
        ? "Kein Zugriff (nur Administratoren)."
        : "Einige Daten konnten nicht geladen werden.");
    }

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
    setBusy(false);
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Auto-Poll: pending count alle 30s aktualisieren (Mitarbeiter checkt aus → Bell zeigt sofort Zahl)
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await apiClient.get("/admin/approvals/work-sessions");
        const all = res.data ?? [];
        setPendingCount(all.filter((a) => a.status === "pending").length);
        setCorrectedCount(all.filter((a) => a.status === "corrected").length);
        setRejectedCount(all.filter((a) => a.status === "rejected").length);
      } catch { /* noop */ }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (activeSection === "reports") {
      setV2Page(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

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

  useEffect(() => {
    if (activeSection !== "settings") return;
    apiClient.get(NOTIF_SETTINGS_URL).then((res) => {
      setNotifEnabled(res.data.enabled ?? false);
      setNotifHours(res.data.hours ?? 12);
      setNotifEmail(res.data.email ?? "");
    }).catch(() => {});
  }, [activeSection]);

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
      await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setEmpFormError(typeof d === "string" ? d : "Anlegen fehlgeschlagen.");
    } finally { setEmpFormBusy(false); }
  }

  function handleCancelCreateEmployee() {
    setNewEmpName(""); setNewEmpEmail(""); setNewEmpPassword(""); setNewEmpAnnual("");
    setEmpFormError(null);
  }

  async function handleGenerateInviteCode() {
    setInviteCodeBusy(true); setInviteCodeError(null); setInviteCodeCopied(false);
    try {
      const res = await apiClient.post(INVITE_CODES_URL);
      setInviteCode(res.data.code);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setInviteCodeError(typeof d === "string" ? d : "Code konnte nicht erstellt werden.");
    } finally { setInviteCodeBusy(false); }
  }

  async function handleCopyInviteCode() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setInviteCodeCopied(true);
      setTimeout(() => setInviteCodeCopied(false), 1600);
    } catch {
      setInviteCodeError("Kopieren fehlgeschlagen.");
    }
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

  async function handleActivateEmployee(emp) {
    if (!confirm(`Mitarbeiter „${emp.name}" wirklich wieder aktivieren?`)) return;
    try {
      await apiClient.patch(`${EMPLOYEES_URL}/${emp.id}/activate`);
      await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      alert(typeof d === "string" ? d : "Aktion fehlgeschlagen.");
    }
  }

  async function confirmEmpDeactivate() {
    if (!empDeactivateModal) return;
    setEmpDeactivateBusy(true);
    try {
      await apiClient.delete(`${EMPLOYEES_URL}/${empDeactivateModal.id}`);
      if (selectedEmpId === empDeactivateModal.id) setSelectedEmpId(null);
      setEmpDeactivateModal(null);
      await refreshAll();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      alert(typeof d === "string" ? d : "Löschen fehlgeschlagen.");
    } finally {
      setEmpDeactivateBusy(false);
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

  const fetchChartData = useCallback(async (month, year, locId, empId) => {
    setChartLoading(true);
    setChartError(null);
    try {
      const p = new URLSearchParams();
      if (month)  p.append("month",       month);
      if (year)   p.append("year",        year);
      if (locId)  p.append("location_id", locId);
      if (empId)  p.append("employee_id", empId);
      const res = await apiClient.get(`${REPORTS_SUMMARY_URL}?${p}`);
      setChartData(res.data);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setChartError(typeof d === "string" ? d : "Chart-Daten konnten nicht geladen werden.");
    } finally {
      setChartLoading(false);
    }
  }, []);

  async function handleDownloadExcel() {
    try {
      const p = new URLSearchParams();
      if (chartMonth)      p.append("month",       chartMonth);
      if (chartYear)       p.append("year",        chartYear);
      if (chartLocationId) p.append("location_id", chartLocationId);
      if (chartEmpId)      p.append("employee_id", chartEmpId);
      const res = await apiClient.get(`${REPORTS_EXCEL_URL}?${p}`, { responseType: "blob" });
      const disposition = res.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "report.xlsx";
      const url = URL.createObjectURL(
        new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Excel-Export fehlgeschlagen."); }
  }

  // ── Report V2 helpers ─────────────────────────────────────────────────────
  function fmtHours(h) {
    if (h == null) return "—";
    const sign = h < 0 ? "-" : "";
    const totalSecs = Math.round(Math.abs(h) * 3600);
    const hrs  = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${sign}${hrs} h : ${String(mins).padStart(2, "0")} m : ${String(secs).padStart(2, "0")} s`;
  }
  function fmtMinutes(m) {
    if (m == null) return "—";
    const sign = m < 0 ? "-" : "";
    const abs  = Math.abs(m);
    const h    = Math.floor(abs / 60);
    const min  = Math.floor(abs % 60);
    return `${sign}${h} h : ${String(min).padStart(2, "0")} m : 00 s`;
  }
  function fmtTimeBerlin(isoStr) {
    if (!isoStr) return "—";
    return new Date(isoStr).toLocaleTimeString("de-DE", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
    });
  }

  const fetchV2Report = useCallback(async () => {
    if (!v2FromDate || !v2ToDate) return;
    setV2Loading(true);
    setV2Error(null);
    setV2Page(1);
    try {
      const p = new URLSearchParams({ from_date: v2FromDate, to_date: v2ToDate, grouping: v2Grouping });
      v2EmpIds.forEach(id => p.append("employee_ids", id));
      v2LocIds.forEach(id => p.append("location_ids", id));
      const res = await apiClient.get(`${REPORTS_V2_URL}?${p}`);
      setV2Report(res.data);
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setV2Error(typeof d === "string" ? d : "Bericht konnte nicht geladen werden.");
    } finally {
      setV2Loading(false);
    }
  }, [v2FromDate, v2ToDate, v2Grouping, v2EmpIds, v2LocIds]);

  async function handleDownloadV2Excel() {
    if (!v2FromDate || !v2ToDate) return;
    try {
      const p = new URLSearchParams({ from_date: v2FromDate, to_date: v2ToDate, grouping: v2Grouping });
      v2EmpIds.forEach(id => p.append("employee_ids", id));
      v2LocIds.forEach(id => p.append("location_ids", id));
      const res = await apiClient.get(`${REPORTS_V2_EXCEL_URL}?${p}`, { responseType: "blob" });
      const disp = res.headers["content-disposition"] || "";
      const match = disp.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "Arbeitszeitbericht.xlsx";
      const url = URL.createObjectURL(
        new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("Excel-Export fehlgeschlagen."); }
  }

  // ── Shift handlers ────────────────────────────────────────────────────────
  function resetShiftForm() {
    setShiftEditId(null); setShiftEmpId(""); setShiftEmpIds([]); setShiftEmpLocMap({});
    setShiftEmpSearch("");
    setShiftLocId("");
    setShiftDate(""); setShiftDateTo(""); setShiftFormMode("single");
    setShiftStart(""); setShiftEnd("");
    setShiftNote(""); setShiftFormError(null); setShiftFormSuccess(null);
  }

  function toggleShiftEmpId(id) {
    const sid = String(id);
    if (shiftEmpIds.includes(sid)) {
      setShiftEmpIds((prev) => prev.filter((x) => x !== sid));
      setShiftEmpLocMap((m) => {
        const next = { ...m };
        delete next[sid];
        return next;
      });
      return;
    }
    const emp = employees.find((e) => String(e.id) === sid);
    setShiftEmpIds((prev) => [...prev, sid]);
    setShiftEmpLocMap((m) => ({
      ...m,
      [sid]: m[sid] || defaultEmpLocationId(emp),
    }));
  }

  function selectAllShiftEmps() {
    const list = shiftEmpSearch.trim() ? shiftEmpPickerList : planEmployees;
    setShiftEmpIds((prev) => {
      const ids = new Set(prev);
      list.forEach((emp) => ids.add(String(emp.id)));
      return [...ids];
    });
    setShiftEmpLocMap((prev) => {
      const next = { ...prev };
      list.forEach((emp) => {
        const sid = String(emp.id);
        if (!next[sid]) next[sid] = defaultEmpLocationId(emp);
      });
      return next;
    });
  }

  function openRangePlanning(dateFrom, dateTo) {
    resetShiftForm();
    setShiftFormMode("range");
    if (dateFrom) setShiftDate(dateFrom);
    setShiftDateTo(dateTo || dateFrom || "");
    setShowShiftForm(true);
  }

  function applyPlanMonthPreset(monthOffset = 0) {
    const base = addMonths(new Date(), monthOffset);
    setShiftDate(toIsoDate(startOfMonth(base)));
    setShiftDateTo(toIsoDate(endOfMonth(base)));
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
  }

  /** Klick auf einen leeren Kalender-Slot: Panel mit Datum + Mitarbeiter vorausgefüllt öffnen. */
  function handlePlanSlotClick(dateIso, employeeId) {
    resetShiftForm();
    setShiftEmpId(String(employeeId));
    setShiftDate(dateIso);
    setShowShiftForm(true);
  }

  /** "Heute"-Button der Kalender-Toolbar: Woche + Tag synchron auf heute zurücksetzen. */
  function goToPlanToday() {
    const t = new Date();
    setPlanWeekStart(startOfWeek(t));
    setPlanDay(t);
  }

  async function handleSaveShift(e) {
    e.preventDefault();
    setShiftFormError(null);
    setShiftFormSuccess(null);

    if (shiftStart && shiftEnd && shiftStart === shiftEnd) {
      setShiftFormError("Start- und Endzeit dürfen nicht identisch sein.");
      return;
    }

    const isRange = shiftFormMode === "range" && shiftEditId === null;
    if (isRange) {
      if (!shiftDate || !shiftDateTo) {
        setShiftFormError("Bitte Von- und Bis-Datum angeben.");
        return;
      }
      if (shiftDate > shiftDateTo) {
        setShiftFormError("„Von“-Datum darf nicht nach „Bis“-Datum liegen.");
        return;
      }
      if (shiftEmpIds.length === 0) {
        setShiftFormError("Bitte mindestens einen Mitarbeiter auswählen.");
        return;
      }
    }

    setShiftFormBusy(true);

    try {
      if (isRange) {
        const payload = {
          employees: shiftEmpIds.map((id) => ({
            employee_id: Number(id),
            location_id: shiftEmpLocMap[id] ? Number(shiftEmpLocMap[id]) : null,
          })),
          date_from: shiftDate,
          date_to: shiftDateTo,
          start_time: shiftStart + ":00",
          end_time: shiftEnd + ":00",
          note: shiftNote.trim() || null,
        };
        const res = await apiClient.post(SHIFTS_BULK_URL, payload);
        const { created_count, skipped } = res.data ?? {};
        resetShiftForm();
        setShowShiftForm(false);
        let msg = `${created_count} Schicht${created_count === 1 ? "" : "en"} erfolgreich angelegt.`;
        if (skipped?.length) {
          msg += ` ${skipped.length} übersprungen (z. B. Urlaub).`;
        }
        setShiftFormSuccess(msg);
      } else {
        const payload = {
          employee_id: Number(shiftEmpId),
          location_id: shiftLocId ? Number(shiftLocId) : null,
          shift_date: shiftDate,
          start_time: shiftStart + ":00",
          end_time: shiftEnd + ":00",
          note: shiftNote.trim() || null,
        };

        const url = shiftEditId !== null ? `${SHIFTS_URL}/${shiftEditId}` : SHIFTS_URL;
        if (shiftEditId !== null) {
          await apiClient.put(url, payload);
        } else {
          await apiClient.post(url, payload);
        }
        resetShiftForm();
        setShowShiftForm(false);
        setShiftFormSuccess(shiftEditId !== null ? "Schicht erfolgreich aktualisiert." : "Schicht erfolgreich angelegt.");
      }
      await refreshAll();
    } catch (err) {
      const httpStatus = axios.isAxiosError(err) ? err.response?.status : null;
      const detail     = axios.isAxiosError(err) ? err.response?.data?.detail : null;

      if (httpStatus === 401 || httpStatus === 403) {
        setShiftFormError("Nicht autorisiert oder keine Admin-Rechte.");
      } else if (typeof detail === "string") {
        setShiftFormError(detail);
      } else if (Array.isArray(detail)) {
        const msgs = detail.map((item) => item.msg ?? JSON.stringify(item)).join(" • ");
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

  /** @returns {Promise<boolean>} true nur, wenn tatsächlich gelöscht wurde (nicht bei Abbruch/Fehler). */
  async function handleDeleteShift(id) {
    if (!confirm("Schicht wirklich löschen?")) return false;
    try {
      await apiClient.delete(`${SHIFTS_URL}/${id}`);
      await refreshAll();
      return true;
    } catch {
      alert("Löschen fehlgeschlagen.");
      return false;
    }
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
  function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Standortname aus GPS (wie in reports.py) — sonst Koordinaten oder Zuweisung. */
  function resolveAttendanceLocation(lat, lng, employee) {
    if (lat != null && lng != null && locations.length > 0) {
      for (const loc of locations) {
        if (haversineMeters(lat, lng, loc.lat, loc.lng) <= (loc.radius_meters ?? 200)) {
          return loc.name;
        }
      }
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    const locIds = employee?.assigned_location_ids?.length
      ? employee.assigned_location_ids
      : (employee?.assigned_location_id ? [employee.assigned_location_id] : []);
    const assigned = locIds[0] ? locations.find((l) => l.id === locIds[0]) : null;
    return assigned?.name ?? "—";
  }

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
      if (!byKey[key]) {
        byKey[key] = { name: rec.employee_name, email: rec.employee_email, checkIns: [], checkOuts: [], lastGps: null };
      }
      if (rec.type === "checkin") byKey[key].checkIns.push(d);
      else if (rec.type === "checkout") byKey[key].checkOuts.push(d);
      if (rec.lat != null && rec.lng != null && (!byKey[key].lastGps || d >= byKey[key].lastGps.time)) {
        byKey[key].lastGps = { time: d, lat: rec.lat, lng: rec.lng };
      }
    }
    return Object.values(byKey).map((emp) => {
      const lastIn  = emp.checkIns.length  > 0 ? new Date(Math.max(...emp.checkIns.map(Number)))  : null;
      const lastOut = emp.checkOuts.length > 0 ? new Date(Math.max(...emp.checkOuts.map(Number))) : null;
      const active = lastIn != null && (lastOut == null || lastIn > lastOut);
      let workSecs = null;
      if (lastIn && lastOut && lastOut > lastIn) workSecs = (lastOut - lastIn) / 1000;
      else if (lastIn && active) workSecs = (Date.now() - lastIn) / 1000;
      const employee = employees.find((e) => e.email === emp.email);
      const gps = emp.lastGps;
      return {
        name: emp.name,
        checkIn:  lastIn  ? lastIn.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : null,
        checkOut: !active && lastOut ? lastOut.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : null,
        workSecs,
        active,
        location: resolveAttendanceLocation(gps?.lat, gps?.lng, employee),
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
        <Topbar section={activeSection} user={currentUser} onRefresh={refreshAll} busy={busy} pendingCount={pendingCount} onNav={setActiveSection} />

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

          {activeSection === "employees" && (() => {
            const empListFiltered = employees.filter((e) =>
              !empListSearch ||
              e.name.toLowerCase().includes(empListSearch.toLowerCase()) ||
              e.email.toLowerCase().includes(empListSearch.toLowerCase())
            );
            const selectedEmp = employees.find((e) => e.id === selectedEmpId) ?? null;
            const selPct = selectedEmp
              ? Math.min(100, ((selectedEmp.hours_official_month ?? 0) / (selectedEmp.hours_target_month ?? 160)) * 100)
              : 0;
            const totalCount = employees.length;
            const activeCount = employees.filter((e) => e.is_active).length;
            const inactiveCount = totalCount - activeCount;
            return (
              <div className="emp-page">
                <div className="emp-tabs" role="tablist">
                  <button
                    type="button" role="tab" aria-selected={empTab === "manage"}
                    className={`emp-tabs__btn${empTab === "manage" ? " emp-tabs__btn--active" : ""}`}
                    onClick={() => setEmpTab("manage")}
                  >
                    Mitarbeiter verwalten
                  </button>
                  <button
                    type="button" role="tab" aria-selected={empTab === "create"}
                    className={`emp-tabs__btn${empTab === "create" ? " emp-tabs__btn--active" : ""}`}
                    onClick={() => setEmpTab("create")}
                  >
                    Mitarbeiter anlegen
                  </button>
                  <button
                    type="button" role="tab" aria-selected={empTab === "invites"}
                    className={`emp-tabs__btn${empTab === "invites" ? " emp-tabs__btn--active" : ""}`}
                    onClick={() => setEmpTab("invites")}
                  >
                    Einladungscodes
                  </button>
                </div>

                {empTab === "manage" && (
                  <div className="emp-layout">
                    {/* ── LEFT: 380px list ─────────────────────────────────── */}
                    <div className="emp-list-panel">
                      <div className="emp-stats-row">
                        <div className="emp-stat-card emp-stat-card--dark">
                          <div className="emp-stat-card__value">{totalCount}</div>
                          <div className="emp-stat-card__label">Gesamt</div>
                        </div>
                        <div className="emp-stat-card">
                          <div className="emp-stat-card__value emp-stat-card__value--active">{activeCount}</div>
                          <div className="emp-stat-card__label">Aktiv</div>
                        </div>
                        <div className="emp-stat-card">
                          <div className="emp-stat-card__value emp-stat-card__value--inactive">{inactiveCount}</div>
                          <div className="emp-stat-card__label">Inaktiv</div>
                        </div>
                      </div>

                      <div className="emp-list-panel__top">
                        <div className="emp-list-panel__search-wrap">
                          <svg className="emp-list-panel__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                          <input
                            className="emp-list-panel__search"
                            placeholder="Suche…"
                            value={empListSearch}
                            onChange={(e) => setEmpListSearch(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="emp-list-card">
                        <div className="emp-list-card__header">
                          <span className="emp-list-card__title">ALLE MITARBEITER</span>
                          <span className="emp-list-card__count-badge">{empListFiltered.length}</span>
                        </div>
                        <div className="emp-list-panel__list">
                          {empListFiltered.length === 0 && (
                            <div className="emp-list-panel__empty">Keine Mitarbeiter gefunden.</div>
                          )}
                          {empListFiltered.map((row) => (
                            <div
                              key={row.id}
                              className={`emp-list-row${selectedEmpId === row.id ? " emp-list-row--active" : ""}${!row.is_active ? " emp-list-row--muted" : ""}`}
                              onClick={() => setSelectedEmpId(row.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === "Enter" && setSelectedEmpId(row.id)}
                            >
                              <div className="emp-list-row__avatar" style={{ background: avatarColorForName(row.name) }}>
                                {row.name?.[0]?.toUpperCase() ?? "?"}
                              </div>
                              <div className="emp-list-row__info">
                                <div className="emp-list-row__name">{row.name}</div>
                                <div className="emp-list-row__email">{row.email}</div>
                              </div>
                              <span
                                className={`emp-list-row__status-dot${row.is_active ? " emp-list-row__status-dot--active" : " emp-list-row__status-dot--inactive"}`}
                                title={row.is_active ? "Aktiv" : "Inaktiv"}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── RIGHT: Side panel ─────────────────────────────────── */}
                    <div className="emp-side-panel">
                      {!selectedEmp ? (
                        <div className="emp-side-panel__empty">
                          <svg className="emp-side-panel__empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          <div className="emp-side-panel__empty-text">Mitarbeiter auswählen</div>
                        </div>
                      ) : (
                        <>
                          <div className="emp-side-panel__header">
                            <div className="emp-side-panel__header-top">
                              <span className="emp-side-panel__kicker">MITARBEITER-PROFIL</span>
                              <span className={`emp-side-panel__badge${selectedEmp.is_active ? " emp-side-panel__badge--active" : " emp-side-panel__badge--inactive"}`}>
                                {selectedEmp.is_active ? "Aktiv" : "Inaktiv"}
                              </span>
                            </div>
                            <div className="emp-side-panel__name">{selectedEmp.name}</div>
                            <div className="emp-side-panel__sub">{selectedEmp.role === "admin" ? "Administrator" : "Mitarbeiter"} · {selectedEmp.email}</div>
                          </div>
                          <div className="emp-side-panel__avatar" style={{ background: avatarColorForName(selectedEmp.name) }}>
                            {selectedEmp.name?.[0]?.toUpperCase() ?? "?"}
                          </div>

                          <div className="emp-side-panel__body">
                            <div className="emp-side-panel__section-title">ÜBERSICHT</div>
                            <div className="emp-side-panel__info-grid">
                              <div className="emp-side-panel__info-card">
                                <div className="emp-side-panel__info-label">Telefon</div>
                                <div className="emp-side-panel__info-value">{selectedEmp.phone || "—"}</div>
                              </div>
                              <div className="emp-side-panel__info-card">
                                <div className="emp-side-panel__info-label">Rolle</div>
                                <div className="emp-side-panel__info-value">{selectedEmp.role === "admin" ? "Administrator" : "Mitarbeiter"}</div>
                              </div>
                              <div className="emp-side-panel__info-card emp-side-panel__info-card--wide">
                                <div className="emp-side-panel__info-label">Monatsstunden (Ist / Soll)</div>
                                <div className="emp-side-panel__info-value">
                                  {fmtHours(selectedEmp.hours_official_month ?? 0)}
                                  <span className="emp-side-panel__info-target"> / {selectedEmp.hours_target_month ?? 160} h</span>
                                </div>
                                <div className="emp-side-panel__progress">
                                  <div className="emp-side-panel__progress-fill" style={{ width: `${selPct}%` }} />
                                </div>
                              </div>
                              <div className="emp-side-panel__info-card">
                                <div className="emp-side-panel__info-label">Urlaub übrig</div>
                                <div className="emp-side-panel__info-value">{selectedEmp.leave_remaining ?? "—"} Tage</div>
                              </div>
                            </div>

                            <div className="emp-side-panel__section-title">STANDORTE</div>
                            <div className="emp-side-panel__loc-tags">
                              {(selectedEmp.assigned_location_ids?.length > 0)
                                ? selectedEmp.assigned_location_ids.map((lid) => {
                                    const loc = locations.find((l) => l.id === lid);
                                    return loc
                                      ? <span key={lid} className="emp-side-panel__loc-tag">{loc.name}</span>
                                      : null;
                                  })
                                : <span className="emp-side-panel__loc-none">Kein Standort zugewiesen</span>
                              }
                            </div>
                          </div>

                          <div className="emp-side-panel__footer">
                            <button
                              type="button"
                              className="emp-side-panel__action-btn"
                              onClick={() => handleEditEmployee(selectedEmp)}
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              className="emp-side-panel__action-btn"
                              onClick={() => openHoursModal(selectedEmp)}
                            >
                              Zeiten
                            </button>
                            <button
                              type="button"
                              className="emp-side-panel__action-btn"
                              onClick={() => openEmployeeLeaveModal(selectedEmp)}
                            >
                              Urlaub
                            </button>
                            {selectedEmp.is_active ? (
                              <button
                                type="button"
                                className="emp-side-panel__action-btn emp-side-panel__action-btn--danger"
                                onClick={() => setEmpDeactivateModal(selectedEmp)}
                              >
                                Löschen
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="emp-side-panel__action-btn emp-side-panel__action-btn--success"
                                  onClick={() => handleActivateEmployee(selectedEmp)}
                                >
                                  Aktivieren
                                </button>
                                <button
                                  type="button"
                                  className="emp-side-panel__action-btn emp-side-panel__action-btn--danger"
                                  onClick={() => setEmpDeactivateModal(selectedEmp)}
                                >
                                  Endgültig löschen
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {empTab === "create" && (
                  <div className="emp-create-tab">
                    <div className="emp-create-tab__card">
                      <h3 className="emp-create-tab__title">
                        <span className="emp-create-tab__accent">Neuen</span> Mitarbeiter anlegen
                      </h3>
                      <form onSubmit={handleCreateEmployee}>
                        <div className="emp-create-form__field">
                          <label className="emp-create-form__label">Name *</label>
                          <input className="emp-create-form__input" placeholder="Vollständiger Name" value={newEmpName}
                            onChange={(e) => setNewEmpName(e.target.value)} disabled={empFormBusy} required />
                        </div>
                        <div className="emp-create-form__field">
                          <label className="emp-create-form__label">E-Mail *</label>
                          <input className="emp-create-form__input" type="email" placeholder="name@firma.de" value={newEmpEmail}
                            onChange={(e) => setNewEmpEmail(e.target.value)} disabled={empFormBusy} required />
                        </div>
                        <div className="emp-create-form__field">
                          <label className="emp-create-form__label">Passwort *</label>
                          <input className="emp-create-form__input" type="password" placeholder="mind. 8 Zeichen" value={newEmpPassword}
                            onChange={(e) => setNewEmpPassword(e.target.value)} disabled={empFormBusy} minLength={8} required />
                        </div>
                        <div className="emp-create-form__field">
                          <label className="emp-create-form__label">Urlaubstage / Jahr</label>
                          <input className="emp-create-form__input" type="text" inputMode="numeric"
                            placeholder="Leer = Standard" value={newEmpAnnual}
                            onChange={(e) => setNewEmpAnnual(e.target.value)} disabled={empFormBusy} />
                        </div>
                        <div className="emp-create-form__actions">
                          <button type="submit" className="emp-create-form__btn emp-create-form__btn--primary" disabled={empFormBusy}>
                            {empFormBusy ? "Wird angelegt…" : "Anlegen"}
                          </button>
                          <button type="button" className="emp-create-form__btn emp-create-form__btn--ghost" onClick={handleCancelCreateEmployee}>
                            Abbrechen
                          </button>
                        </div>
                      </form>
                      {empFormError && <p className="emp-create-form__error">{empFormError}</p>}
                    </div>
                  </div>
                )}

                {empTab === "invites" && (
                  <div className="emp-invite-tab">
                    <div className="emp-invite-tab__card">
                      <div className="emp-invite-tab__icon-box">🔑</div>
                      <h3 className="emp-invite-tab__title">Einladungscode erstellen</h3>
                      <p className="emp-invite-tab__lede">
                        Generiere einen einmaligen Code und gib ihn an einen neuen
                        Mitarbeiter weiter, damit dieser sich selbst registrieren kann.
                      </p>

                      {!inviteCode ? (
                        <button
                          type="button"
                          className="emp-invite-tab__btn emp-invite-tab__btn--primary"
                          onClick={handleGenerateInviteCode}
                          disabled={inviteCodeBusy}
                        >
                          {inviteCodeBusy ? "Wird erstellt…" : "+ Code generieren"}
                        </button>
                      ) : (
                        <>
                          <div className="emp-invite-tab__code-box">{inviteCode}</div>
                          <div className="emp-invite-tab__actions">
                            <button
                              type="button"
                              className={`emp-invite-tab__btn emp-invite-tab__btn--copy${inviteCodeCopied ? " emp-invite-tab__btn--copied" : ""}`}
                              onClick={handleCopyInviteCode}
                            >
                              {inviteCodeCopied ? "✓ Kopiert" : "Code kopieren"}
                            </button>
                            <button
                              type="button"
                              className="emp-invite-tab__btn emp-invite-tab__btn--ghost"
                              onClick={handleGenerateInviteCode}
                              disabled={inviteCodeBusy}
                            >
                              Neuer Code
                            </button>
                          </div>
                        </>
                      )}
                      {inviteCodeError && <p className="emp-invite-tab__error">{inviteCodeError}</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

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
              <SectionTitle title="Report Center" action={
                <button className="ad-btn ad-btn--excel" onClick={handleDownloadV2Excel} disabled={v2Loading || !v2Report}>
                  <span className="ad-btn__icon">{Ico.download}</span> Excel exportieren
                </button>
              } />

              {/* ── Filter Bar ── */}
              <Card className="ad-rc-filters-card">
                <div className="ad-rc-filters-grid">
                  <div className="ad-rc-filter">
                    <label className="ad-rc-filter__label">Mitarbeiter</label>
                    <MultiSelect
                      options={employees.filter(e => e.is_active).map(e => ({ value: e.id, label: e.name }))}
                      value={v2EmpIds}
                      onChange={setV2EmpIds}
                      placeholder="Mitarbeiter"
                    />
                  </div>
                  <div className="ad-rc-filter">
                    <label className="ad-rc-filter__label">Standort</label>
                    <MultiSelect
                      options={locations.map(l => ({ value: l.id, label: l.name }))}
                      value={v2LocIds}
                      onChange={setV2LocIds}
                      placeholder="Standorte"
                    />
                  </div>
                  <div className="ad-rc-filter">
                    <label className="ad-rc-filter__label">Von</label>
                    <input className="ad-input" type="date" value={v2FromDate} onChange={e => setV2FromDate(e.target.value)} />
                  </div>
                  <div className="ad-rc-filter">
                    <label className="ad-rc-filter__label">Bis</label>
                    <input className="ad-input" type="date" value={v2ToDate} onChange={e => setV2ToDate(e.target.value)} />
                  </div>
                  <div className="ad-rc-filter">
                    <label className="ad-rc-filter__label">Gruppierung</label>
                    <select className="ad-input ad-select" value={v2Grouping} onChange={e => setV2Grouping(e.target.value)}>
                      <option value="daily">Täglich</option>
                      <option value="weekly">Wöchentlich</option>
                      <option value="monthly">Monatlich</option>
                    </select>
                  </div>
                </div>
                <div className="ad-rc-filters-actions">
                  <button className="ad-btn ad-btn--primary" onClick={fetchV2Report} disabled={v2Loading || !v2FromDate || !v2ToDate}>
                    {v2Loading ? "Lädt…" : "Bericht anzeigen"}
                  </button>
                  <button className="ad-btn ad-btn--excel" onClick={handleDownloadV2Excel} disabled={v2Loading || !v2Report}>
                    <span className="ad-btn__icon">{Ico.download}</span> Excel-Export (.xlsx)
                  </button>
                </div>
              </Card>

              {v2Error && <p className="ad-alert" style={{ marginBottom: "1rem" }}>{v2Error}</p>}
              {v2Loading && <div className="ad-rc-spinner">Bericht wird geladen…</div>}

              {v2Report && !v2Loading && (
                <>
                  {/* ── KPI Cards ── */}
                  <div className="ad-rc-kpis">
                    <div className="ad-rc-kpi">
                      <div className="ad-rc-kpi__icon">{Ico.clock}</div>
                      <div className="ad-rc-kpi__body">
                        <div className="ad-rc-kpi__value">{fmtHours(v2Report.kpis.total_hours)}</div>
                        <div className="ad-rc-kpi__label">Gesamtstunden</div>
                      </div>
                    </div>
                    <div className="ad-rc-kpi ad-rc-kpi--green">
                      <div className="ad-rc-kpi__icon ad-rc-kpi__icon--green">{Ico.check}</div>
                      <div className="ad-rc-kpi__body">
                        <div className="ad-rc-kpi__value">{fmtHours(v2Report.kpis.official_hours)}</div>
                        <div className="ad-rc-kpi__label">Offizielle Stunden</div>
                      </div>
                    </div>
                    <div className="ad-rc-kpi ad-rc-kpi--orange">
                      <div className="ad-rc-kpi__icon ad-rc-kpi__icon--orange">{Ico.bell}</div>
                      <div className="ad-rc-kpi__body">
                        <div className="ad-rc-kpi__value">{fmtHours(v2Report.kpis.pending_hours)}</div>
                        <div className="ad-rc-kpi__label">Ausstehend</div>
                      </div>
                    </div>
                    <div className="ad-rc-kpi ad-rc-kpi--indigo">
                      <div className="ad-rc-kpi__icon ad-rc-kpi__icon--indigo">{Ico.chart}</div>
                      <div className="ad-rc-kpi__body">
                        <div className="ad-rc-kpi__value">{v2Report.kpis.total_shifts}</div>
                        <div className="ad-rc-kpi__label">Schichten</div>
                      </div>
                    </div>
                    <div className="ad-rc-kpi ad-rc-kpi--purple">
                      <div className="ad-rc-kpi__icon ad-rc-kpi__icon--purple">{Ico.map}</div>
                      <div className="ad-rc-kpi__body">
                        <div className="ad-rc-kpi__value">{v2Report.kpis.location_count}</div>
                        <div className="ad-rc-kpi__label">Standorte</div>
                      </div>
                    </div>
                    <div className="ad-rc-kpi ad-rc-kpi--teal">
                      <div className="ad-rc-kpi__icon ad-rc-kpi__icon--teal">{Ico.calendar}</div>
                      <div className="ad-rc-kpi__body">
                        <div className="ad-rc-kpi__value">{v2Report.kpis.work_days}</div>
                        <div className="ad-rc-kpi__label">Arbeitstage</div>
                      </div>
                    </div>
                  </div>

                  {/* ── Charts ── */}
                  {(v2Report.location_summary.length > 0 || v2Report.trend_data.length > 0) && (
                    <div className="ad-rc-charts">
                      {v2Report.location_summary.length > 0 && (
                        <div className="ad-rc-chart-card">
                          <div className="ad-rc-chart-card__title">Stunden pro Standort</div>
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={v2Report.location_summary} margin={{ top: 4, right: 12, left: 0, bottom: 44 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                              <XAxis dataKey="location_name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                              <YAxis tick={{ fontSize: 11 }} unit="h" />
                              <Tooltip formatter={(v) => [`${v}h`, "Stunden"]} />
                              <Bar dataKey="total_hours" fill="#2563eb" radius={[4,4,0,0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {v2Report.trend_data.length > 0 && (
                        <div className="ad-rc-chart-card">
                          <div className="ad-rc-chart-card__title">Stundenentwicklung</div>
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={v2Report.trend_data} margin={{ top: 4, right: 12, left: 0, bottom: 44 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                              <XAxis dataKey="period_label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                              <YAxis tick={{ fontSize: 11 }} unit="h" />
                              <Tooltip formatter={(v, n) => [fmtHours(v), n === "official_hours" ? "Offiziell" : "Ausstehend"]} />
                              <Legend formatter={(v) => v === "official_hours" ? "Offizielle Stunden" : "Ausstehend"} />
                              <Line type="monotone" dataKey="official_hours" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                              <Line type="monotone" dataKey="pending_hours" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {v2Report.location_summary.length > 0 && (
                        <div className="ad-rc-chart-card">
                          <div className="ad-rc-chart-card__title">Verteilung nach Standort</div>
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie
                                data={v2Report.location_summary.map((l) => ({ name: l.location_name, value: l.total_hours }))}
                                cx="50%" cy="45%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value"
                              >
                                {v2Report.location_summary.map((_, i) => (
                                  <Cell key={i} fill={RC_PIE_COLORS[i % RC_PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v) => [`${v}h`]} />
                              <Legend />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Detailbericht ── */}
                  <Card style={{ marginTop: "1.5rem" }}>
                    <div className="ad-rc-section-header">
                      <h3 className="ad-rc-section-title">Detailbericht</h3>
                      <span className="ad-rc-section-badge">{v2Report.sessions.length} Schichten</span>
                    </div>
                    <div className="ad-table-wrap ad-table-wrap--scroll">
                      <table className="ad-table">
                        <thead>
                          <tr>
                            {v2Report.employee_summary.length > 1 && <th>Mitarbeiter</th>}
                            <th>Datum</th><th>Wochentag</th><th>Standort</th>
                            <th>Check-In</th><th>Check-Out</th><th>Pause</th>
                            <th>Arbeitszeit</th><th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v2Report.sessions.length === 0 ? (
                            <tr><td colSpan={9} className="ad-empty">Keine Schichten im gewählten Zeitraum.</td></tr>
                          ) : (
                            v2Report.sessions
                              .slice((v2Page - 1) * V2_PAGE_SIZE, v2Page * V2_PAGE_SIZE)
                              .map((row, i) => (
                                <tr key={i}>
                                  {v2Report.employee_summary.length > 1 && <td><strong>{row.employee_name}</strong></td>}
                                  <td className="ad-mono">{row.date.split("-").reverse().join(".")}</td>
                                  <td className="ad-muted">{row.weekday}</td>
                                  <td>{row.location_name}</td>
                                  <td className="ad-mono">{fmtTimeBerlin(row.checkin_time)}</td>
                                  <td className="ad-mono">{row.checkout_time ? fmtTimeBerlin(row.checkout_time) : "—"}</td>
                                  <td className="ad-muted">—</td>
                                  <td><strong>{fmtMinutes(row.work_minutes)}</strong></td>
                                  <td>
                                    <span className={`ad-badge ad-badge--${{ approved:"green", corrected:"blue", rejected:"red", pending:"yellow" }[row.status] ?? "gray"}`}>
                                      {{ approved:"Genehmigt", corrected:"Korrigiert", rejected:"Abgelehnt", pending:"Ausstehend" }[row.status] ?? row.status}
                                    </span>
                                  </td>
                                </tr>
                              ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {Math.ceil(v2Report.sessions.length / V2_PAGE_SIZE) > 1 && (
                      <div className="ad-rc-pagination">
                        <button className="ad-rc-pg-btn" onClick={() => setV2Page(p => Math.max(1, p - 1))} disabled={v2Page === 1}>‹ Zurück</button>
                        <span className="ad-rc-pg-info">
                          Seite {v2Page} / {Math.ceil(v2Report.sessions.length / V2_PAGE_SIZE)} · {v2Report.sessions.length} Einträge
                        </span>
                        <button className="ad-rc-pg-btn" onClick={() => setV2Page(p => Math.min(Math.ceil(v2Report.sessions.length / V2_PAGE_SIZE), p + 1))} disabled={v2Page === Math.ceil(v2Report.sessions.length / V2_PAGE_SIZE)}>Weiter ›</button>
                      </div>
                    )}
                  </Card>

                  {/* ── Standortauswertung ── */}
                  {v2Report.location_summary.length > 0 && (
                    <Card style={{ marginTop: "1.25rem" }}>
                      <div className="ad-rc-section-header">
                        <h3 className="ad-rc-section-title">Standortauswertung</h3>
                      </div>
                      <div className="ad-table-wrap">
                        <table className="ad-table">
                          <thead><tr><th>Standort</th><th>Schichten</th><th>Stunden</th></tr></thead>
                          <tbody>
                            {v2Report.location_summary.map((loc, i) => (
                              <tr key={i}>
                                <td><strong>{loc.location_name}</strong></td>
                                <td>{loc.shift_count}</td>
                                <td><strong>{fmtHours(loc.total_hours)}</strong></td>
                              </tr>
                            ))}
                            <tr className="ad-table-sum">
                              <td><strong>Gesamt</strong></td>
                              <td><strong>{v2Report.location_summary.reduce((s, l) => s + l.shift_count, 0)}</strong></td>
                              <td><strong>{fmtHours(v2Report.kpis.total_hours)}</strong></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}

                  {/* ── Mitarbeiterübersicht (nur bei mehreren) ── */}
                  {v2Report.employee_summary.length > 1 && (
                    <Card style={{ marginTop: "1.25rem" }}>
                      <div className="ad-rc-section-header">
                        <h3 className="ad-rc-section-title">Mitarbeiterübersicht</h3>
                        <span className="ad-rc-section-badge">{v2Report.employee_summary.length} Mitarbeiter</span>
                      </div>
                      <div className="ad-table-wrap ad-table-wrap--scroll">
                        <table className="ad-table">
                          <thead>
                            <tr>
                              <th>Mitarbeiter</th><th>Offizielle Stunden</th><th>Ausstehend</th>
                              <th>Schichten</th><th>Arbeitstage</th><th>Soll (h)</th><th>Differenz</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v2Report.employee_summary.map((emp, i) => (
                              <tr key={i}>
                                <td><strong>{emp.employee_name}</strong></td>
                                <td><strong>{fmtHours(emp.official_hours)}</strong></td>
                                <td className="ad-muted">{fmtHours(emp.pending_hours)}</td>
                                <td>{emp.shift_count}</td>
                                <td>{emp.work_days}</td>
                                <td>{emp.target_hours}h</td>
                                <td className={emp.diff_hours >= 0 ? "ad-txt-green" : "ad-txt-red"}>
                                  <strong>{emp.diff_hours >= 0 ? "+" : ""}{fmtHours(emp.diff_hours)}</strong>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}

                  {/* ── Perioden-Zusammenfassung ── */}
                  <div className="ad-rc-period-summary">
                    <h3 className="ad-rc-period-summary__title">Perioden-Zusammenfassung</h3>
                    <div className="ad-rc-period-summary__grid">
                      {[
                        { label: "Gesamtstunden",      value: fmtHours(v2Report.period_summary.total_hours),    cls: "" },
                        { label: "Offizielle Stunden", value: fmtHours(v2Report.period_summary.official_hours), cls: "ad-txt-green" },
                        { label: "Ausstehend",          value: fmtHours(v2Report.period_summary.pending_hours),  cls: "ad-txt-orange" },
                        { label: "Soll-Stunden",        value: `${v2Report.period_summary.target_hours}h`,        cls: "" },
                        {
                          label: "Differenz",
                          value: `${v2Report.period_summary.diff_hours >= 0 ? "+" : ""}${fmtHours(v2Report.period_summary.diff_hours)}`,
                          cls: v2Report.period_summary.diff_hours >= 0 ? "ad-txt-green" : "ad-txt-red",
                        },
                        { label: "Schichten",   value: String(v2Report.period_summary.shift_count), cls: "" },
                        { label: "Arbeitstage", value: String(v2Report.period_summary.work_days),   cls: "" },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="ad-rc-period-summary__item">
                          <span className="ad-rc-period-summary__label">{label}</span>
                          <span className={`ad-rc-period-summary__value ${cls}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

            </div>
          )}

          {/* ═══════════ PLANNING ═════════════════════════════════════════ */}
          {activeSection === "planning" && (
            <div className="ad-section">
              <SectionTitle
                title="Schichtplanung"
                action={
                  <div className="ad-plan-actions">
                    <button
                      className="ad-btn ad-btn--primary"
                      onClick={() => { resetShiftForm(); setShowShiftForm(true); }}
                    >
                      <span className="ad-btn__icon">{Ico.plus}</span>
                      Neue Schicht
                    </button>
                    <button
                      className="ad-btn ad-btn--ghost"
                      onClick={() => openRangePlanning(
                        toIsoDate(startOfMonth(new Date())),
                        toIsoDate(endOfMonth(new Date())),
                      )}
                    >
                      <span className="ad-btn__icon">{Ico.calendar}</span>
                      Monat planen
                    </button>
                  </div>
                }
              />

              {/* ── Erfolgsmeldung ── */}
              {shiftFormSuccess && (
                <p className="ad-success" style={{ marginBottom: "1rem" }}>{shiftFormSuccess}</p>
              )}

              {/* ── Kalender-Toolbar ── */}
              <Card className="ad-plan-toolbar-card">
                <div className="ad-plan-toolbar">
                  <div className="ad-plan-toolbar__left">
                    <div className="ad-plan-toolbar__nav">
                      {planView === "week" ? (
                        <>
                          <button
                            type="button"
                            className="ad-btn ad-btn--ghost ad-btn--sm ad-plan-nav-btn"
                            onClick={() => setPlanWeekStart((d) => addDays(d, -7))}
                            aria-label="Vorherige Woche"
                          >
                            ‹
                          </button>
                          <button type="button" className="ad-btn ad-btn--ghost ad-btn--sm" onClick={goToPlanToday}>
                            Heute
                          </button>
                          <button
                            type="button"
                            className="ad-btn ad-btn--ghost ad-btn--sm ad-plan-nav-btn"
                            onClick={() => setPlanWeekStart((d) => addDays(d, 7))}
                            aria-label="Nächste Woche"
                          >
                            ›
                          </button>
                          <div className="ad-plan-toolbar__range-wrap">
                            <span className="ad-plan-toolbar__range">{formatWeekRange(planWeekStart)}</span>
                            <span className="ad-plan-toolbar__kw">Kalenderwoche {getISOWeek(planWeekStart)}</span>
                          </div>
                        </>
                      ) : (
                      <>
                        <button
                          type="button"
                          className="ad-btn ad-btn--ghost ad-btn--sm ad-plan-nav-btn"
                          onClick={() => setPlanDay((d) => addDays(d, -1))}
                          aria-label="Vorheriger Tag"
                        >
                          ‹
                        </button>
                        <button type="button" className="ad-btn ad-btn--ghost ad-btn--sm" onClick={goToPlanToday}>
                          Heute
                        </button>
                        <button
                          type="button"
                          className="ad-btn ad-btn--ghost ad-btn--sm ad-plan-nav-btn"
                          onClick={() => setPlanDay((d) => addDays(d, 1))}
                          aria-label="Nächster Tag"
                        >
                          ›
                        </button>
                        <span className="ad-plan-toolbar__range">
                          {planDay.toLocaleDateString("de-DE", {
                            weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
                          })}
                        </span>
                      </>
                    )}
                    </div>
                    {planView === "week" && (
                      <div className="ad-plan-toolbar__legend">
                        <span className="ad-plan-legend__item">
                          <span className="ad-plan-legend__swatch ad-plan-legend__swatch--night" aria-hidden />
                          Nacht
                        </span>
                        <span className="ad-plan-legend__item">
                          <span className="ad-plan-legend__swatch ad-plan-legend__swatch--day" aria-hidden />
                          Tag / Früh
                        </span>
                        <span className="ad-plan-toolbar__hint">Zelle klicken zum Planen</span>
                      </div>
                    )}
                  </div>
                  <div className="ad-plan-toolbar__filter">
                    <span className="ad-plan-toolbar__filter-icon" aria-hidden="true">{Ico.search}</span>
                    <input
                      className="ad-input ad-plan-toolbar__search"
                      type="search"
                      placeholder="Mitarbeiter filtern…"
                      value={planEmpFilter}
                      onChange={(e) => setPlanEmpFilter(e.target.value)}
                      aria-label="Mitarbeiter in der Planung filtern"
                    />
                    {planEmpFilter && (
                      <button
                        type="button"
                        className="ad-btn ad-btn--ghost ad-btn--sm ad-plan-toolbar__clear"
                        onClick={() => setPlanEmpFilter("")}
                        aria-label="Filter zurücksetzen"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="ad-plan-toggle-group" role="tablist" aria-label="Ansicht">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={planView === "week"}
                      className={`ad-plan-toggle${planView === "week" ? " ad-plan-toggle--on" : ""}`}
                      onClick={() => setPlanView("week")}
                    >
                      Woche
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={planView === "day"}
                      className={`ad-plan-toggle${planView === "day" ? " ad-plan-toggle--on" : ""}`}
                      onClick={() => setPlanView("day")}
                    >
                      Tag
                    </button>
                  </div>
                </div>
              </Card>

              {/* ── Kalender ── */}
              <Card>
                {planView === "week" ? (
                  <PlanningWeekGrid
                    employees={planEmployeesFiltered}
                    weekDays={planWeekDays}
                    shifts={shifts}
                    todayIso={planTodayIso}
                    onSlotClick={handlePlanSlotClick}
                    onShiftClick={handleEditShift}
                    emptyMessage={planEmpFilter ? `Kein Mitarbeiter passt zum Filter „${planEmpFilter}“.`: undefined}
                  />
                ) : (
                  <PlanningDayTimeline
                    employees={planEmployeesFiltered}
                    shifts={shifts}
                    day={planDay}
                    todayIso={planTodayIso}
                    onSlotClick={handlePlanSlotClick}
                    onShiftClick={handleEditShift}
                    emptyMessage={planEmpFilter ? `Kein Mitarbeiter passt zum Filter „${planEmpFilter}“.`: undefined}
                  />
                )}
              </Card>

              {/* ── Schicht anlegen/bearbeiten (Modal) ── */}
              {showShiftForm && (
                <div
                  className="ad-modal-backdrop"
                  role="presentation"
                  onClick={(ev) => {
                    if (ev.target === ev.currentTarget && !shiftFormBusy) {
                      resetShiftForm(); setShowShiftForm(false);
                    }
                  }}
                >
                  <div
                    className="ad-modal ad-modal--shift"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="ad-shift-modal-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="ad-modal__header ad-modal__header--leave">
                      <div>
                        <h2 id="ad-shift-modal-title" className="ad-modal__title">
                          {shiftEditId !== null
                            ? "Schicht bearbeiten"
                            : shiftFormMode === "range"
                              ? "Zeitraum planen"
                              : "Neue Schicht anlegen"}
                        </h2>
                        {shiftFormMode === "single" && shiftDate && (
                          <p className="ad-modal__subtitle">
                            {new Date(shiftDate + "T00:00:00").toLocaleDateString("de-DE", {
                              weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
                            })}
                          </p>
                        )}
                        {shiftFormMode === "range" && shiftDate && shiftDateTo && shiftDate <= shiftDateTo && (
                          <p className="ad-modal__subtitle">
                            {shiftEmpIds.length} Mitarbeiter · {planRangeDayCount} Tage · {planRangeShiftCount} Schichten
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ad-modal__close ad-modal__close--primary"
                        onClick={() => { if (!shiftFormBusy) { resetShiftForm(); setShowShiftForm(false); } }}
                        aria-label="Schließen"
                      >
                        ×
                      </button>
                    </div>
                    <form onSubmit={handleSaveShift}>
                      <div className="ad-modal__body">
                        {shiftEditId === null && (
                          <div className="ad-plan-form-mode" role="tablist" aria-label="Planungsmodus">
                            <button
                              type="button"
                              role="tab"
                              aria-selected={shiftFormMode === "single"}
                              className={`ad-plan-toggle${shiftFormMode === "single" ? " ad-plan-toggle--on" : ""}`}
                              onClick={() => setShiftFormMode("single")}
                              disabled={shiftFormBusy}
                            >
                              Einzeltag
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={shiftFormMode === "range"}
                              className={`ad-plan-toggle${shiftFormMode === "range" ? " ad-plan-toggle--on" : ""}`}
                              onClick={() => {
                                setShiftFormMode("range");
                                if (shiftDate && !shiftDateTo) setShiftDateTo(shiftDate);
                                if (shiftEmpId) setShiftEmpIds([shiftEmpId]);
                              }}
                              disabled={shiftFormBusy}
                            >
                              Zeitraum
                            </button>
                          </div>
                        )}
                        <div className="ad-form-grid">
                          {/* Mitarbeiter */}
                          {shiftFormMode === "range" && shiftEditId === null ? (
                            <div className="ad-field ad-field--span2">
                              <label>Mitarbeiter *</label>
                              <div className="ad-plan-emp-pick">
                                <div className="ad-plan-emp-pick__search">
                                  <span className="ad-plan-emp-pick__search-icon" aria-hidden="true">{Ico.search}</span>
                                  <input
                                    className="ad-input"
                                    type="search"
                                    placeholder="Mitarbeiter suchen…"
                                    value={shiftEmpSearch}
                                    onChange={(e) => setShiftEmpSearch(e.target.value)}
                                    disabled={shiftFormBusy}
                                    aria-label="Mitarbeiter in der Auswahl filtern"
                                  />
                                </div>
                                <div className="ad-plan-emp-pick__actions">
                                  <button
                                    type="button"
                                    className="ad-btn ad-btn--ghost ad-btn--sm"
                                    onClick={selectAllShiftEmps}
                                    disabled={shiftFormBusy}
                                  >
                                    {shiftEmpSearch.trim() ? "Gefilterte auswählen" : "Alle auswählen"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ad-btn ad-btn--ghost ad-btn--sm"
                                    onClick={() => { setShiftEmpIds([]); setShiftEmpLocMap({}); }}
                                    disabled={shiftFormBusy}
                                  >
                                    Keine
                                  </button>
                                  <span className="ad-plan-emp-pick__count">
                                    {shiftEmpIds.length} ausgewählt
                                  </span>
                                </div>
                                <div className="ad-plan-emp-pick__list">
                                  {shiftEmpPickerList.length === 0 ? (
                                    <p className="ad-plan-emp-pick__empty">
                                      {shiftEmpSearch.trim()
                                        ? `Kein Treffer für „${shiftEmpSearch.trim()}“`
                                        : "Keine aktiven Mitarbeiter."}
                                    </p>
                                  ) : shiftEmpPickerList.map((emp) => {
                                    const checked = shiftEmpIds.includes(String(emp.id));
                                    return (
                                      <label key={emp.id} className="ad-plan-emp-pick__item">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleShiftEmpId(emp.id)}
                                          disabled={shiftFormBusy}
                                        />
                                        <span>{emp.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
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
                                {planEmployees.map((emp) => (
                                  <option key={emp.id} value={String(emp.id)}>
                                    {emp.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Standort: einzeln = ein Feld; Zeitraum = pro Mitarbeiter */}
                          {shiftFormMode === "range" && shiftEditId === null ? (
                            shiftSelectedEmployees.length > 0 && (
                              <div className="ad-field ad-field--span2">
                                <label>Standort pro Mitarbeiter</label>
                                <div className="ad-plan-emp-locs">
                                  {shiftSelectedEmployees.map((emp) => {
                                    const sid = String(emp.id);
                                    return (
                                      <div key={emp.id} className="ad-plan-emp-loc-row">
                                        <span className="ad-plan-emp-loc-row__name">{emp.name}</span>
                                        <select
                                          className="ad-input ad-select ad-plan-emp-loc-row__select"
                                          value={shiftEmpLocMap[sid] ?? ""}
                                          onChange={(e) => setShiftEmpLocMap((m) => ({
                                            ...m,
                                            [sid]: e.target.value,
                                          }))}
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
                                    );
                                  })}
                                </div>
                              </div>
                            )
                          ) : (
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
                          )}

                          {/* Datum / Zeitraum — placeholder removed duplicate below */}
                          {shiftFormMode === "range" && shiftEditId === null ? (
                            <>
                              <div className="ad-field ad-field--span2">
                                <label>Zeitraum</label>
                                <div className="ad-plan-month-presets">
                                  <button
                                    type="button"
                                    className="ad-btn ad-btn--ghost ad-btn--sm"
                                    onClick={() => applyPlanMonthPreset(0)}
                                    disabled={shiftFormBusy}
                                  >
                                    Dieser Monat
                                  </button>
                                  <button
                                    type="button"
                                    className="ad-btn ad-btn--ghost ad-btn--sm"
                                    onClick={() => applyPlanMonthPreset(1)}
                                    disabled={shiftFormBusy}
                                  >
                                    Nächster Monat
                                  </button>
                                </div>
                              </div>
                              <div className="ad-field">
                                <label>Von Datum *</label>
                                <input
                                  className="ad-input"
                                  type="date"
                                  value={shiftDate}
                                  onChange={(e) => setShiftDate(e.target.value)}
                                  disabled={shiftFormBusy}
                                  required
                                />
                              </div>
                              <div className="ad-field">
                                <label>Bis Datum *</label>
                                <input
                                  className="ad-input"
                                  type="date"
                                  value={shiftDateTo}
                                  onChange={(e) => setShiftDateTo(e.target.value)}
                                  disabled={shiftFormBusy}
                                  required
                                />
                              </div>
                            </>
                          ) : (
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
                          )}

                          {/* Uhrzeit */}
                          <div className="ad-field">
                            <label>{shiftFormMode === "range" ? "Uhrzeit von *" : "Startzeit *"}</label>
                            <input
                              className="ad-input"
                              type="time"
                              value={shiftStart}
                              onChange={(e) => setShiftStart(e.target.value)}
                              disabled={shiftFormBusy}
                              required
                            />
                          </div>

                          <div className="ad-field">
                            <label>{shiftFormMode === "range" ? "Uhrzeit bis *" : "Endzeit *"}</label>
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
                        </div>
                        {shiftFormMode === "range" && shiftEditId === null && planRangeShiftCount > 0 && (
                          <p className="ad-plan-range-hint">
                            Es werden <strong>{planRangeShiftCount}</strong> Schichten angelegt
                            ({shiftEmpIds.length} Mitarbeiter × {planRangeDayCount} Tage, {shiftStart || "—"}–{shiftEnd || "—"}).
                          </p>
                        )}
                        {shiftFormError && <p className="ad-alert" style={{ marginTop: "0.85rem" }}>{shiftFormError}</p>}
                      </div>
                      <div className="ad-modal__footer ad-modal__footer--modal-end">
                        <button type="submit" className="ad-btn ad-btn--primary" disabled={shiftFormBusy}>
                          {shiftFormBusy
                            ? "Wird gespeichert…"
                            : shiftEditId !== null
                              ? "Speichern"
                              : shiftFormMode === "range"
                                ? "Zeitraum planen"
                                : "Anlegen"}
                        </button>
                        <button
                          type="button"
                          className="ad-btn ad-btn--ghost"
                          onClick={() => { resetShiftForm(); setShowShiftForm(false); }}
                          disabled={shiftFormBusy}
                        >
                          Abbrechen
                        </button>
                        {shiftEditId !== null && (
                          <button
                            type="button"
                            className="ad-btn ad-btn--danger ad-plan-modal__delete"
                            disabled={shiftFormBusy}
                            onClick={async () => {
                              const deleted = await handleDeleteShift(shiftEditId);
                              if (deleted) { resetShiftForm(); setShowShiftForm(false); }
                            }}
                          >
                            Löschen
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                </div>
              )}
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
                                <strong>{formatSeconds(session.duration_seconds)}</strong>
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

              {/* ── Eincheck-Benachrichtigung ── */}
              <Card style={{ marginBottom: "1.5rem" }}>
                <div className="ad-card-header">
                  <h3>Eincheck-Warnung (E-Mail)</h3>
                </div>
                <p style={{ color: "var(--text-3)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
                  Wenn ein Mitarbeiter länger als die angegebene Stundenzahl eingecheckt ist
                  ohne auszuchecken, kann eine E-Mail an den Admin gesendet werden.
                </p>

                {/* Toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifEnabled}
                    onClick={() => { setNotifEnabled((v) => !v); setNotifSaveOk(false); setNotifSaveErr(null); }}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                      background: notifEnabled ? "#2563eb" : "#cbd5e1", position: "relative", transition: "background 0.2s",
                    }}
                  >
                    <span style={{
                      position: "absolute", top: 3, left: notifEnabled ? 23 : 3,
                      width: 18, height: 18, borderRadius: "50%", background: "#fff",
                      transition: "left 0.2s", display: "block",
                    }} />
                  </button>
                  <span style={{ fontWeight: 600, color: notifEnabled ? "#2563eb" : "#64748b" }}>
                    {notifEnabled ? "Aktiviert" : "Deaktiviert"}
                  </span>
                </div>

                {/* Hours + Email */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "0.35rem" }}>
                      Schwellenwert (Stunden)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={48}
                      value={notifHours}
                      onChange={(e) => { setNotifHours(Number(e.target.value)); setNotifSaveOk(false); }}
                      className="ad-input"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "0.35rem" }}>
                      Admin-E-Mail (Empfänger)
                    </label>
                    <input
                      type="email"
                      value={notifEmail}
                      onChange={(e) => { setNotifEmail(e.target.value); setNotifSaveOk(false); }}
                      placeholder="admin@firma.de"
                      className="ad-input"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>

                {/* Save button */}
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                  <button
                    type="button"
                    className="ad-btn ad-btn--primary"
                    disabled={notifSaving}
                    onClick={async () => {
                      setNotifSaving(true); setNotifSaveOk(false); setNotifSaveErr(null);
                      try {
                        await apiClient.put(NOTIF_SETTINGS_URL, {
                          enabled: notifEnabled,
                          hours: notifHours,
                          email: notifEmail,
                        });
                        setNotifSaveOk(true);
                      } catch (err) {
                        const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
                        setNotifSaveErr(typeof d === "string" ? d : "Speichern fehlgeschlagen.");
                      } finally {
                        setNotifSaving(false);
                      }
                    }}
                  >
                    {notifSaving ? "Speichert…" : "Einstellungen speichern"}
                  </button>
                  {notifSaveOk  && <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Gespeichert</span>}
                  {notifSaveErr && <span style={{ color: "#dc2626", fontSize: "0.85rem" }}>{notifSaveErr}</span>}
                </div>

                {/* Divider */}
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />

                {/* Manual check */}
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                  <button
                    type="button"
                    className="ad-btn ad-btn--ghost"
                    disabled={notifChecking}
                    onClick={async () => {
                      setNotifChecking(true); setNotifCheckResult(null); setNotifCheckErr(null);
                      try {
                        const res = await apiClient.post(NOTIF_CHECK_URL);
                        setNotifCheckResult(res.data);
                        setNotifSmtpReady(res.data.smtp_ready ?? null);
                      } catch (err) {
                        const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
                        setNotifCheckErr(typeof d === "string" ? d : "Prüfung fehlgeschlagen.");
                      } finally {
                        setNotifChecking(false);
                      }
                    }}
                  >
                    {notifChecking ? "Prüft…" : "Jetzt manuell prüfen & E-Mail senden"}
                  </button>
                  {notifCheckErr && <span style={{ color: "#dc2626", fontSize: "0.85rem" }}>{notifCheckErr}</span>}
                </div>

                {/* Check result */}
                {notifCheckResult && (
                  <div style={{ background: "var(--bg-2)", borderRadius: 8, padding: "1rem" }}>
                    <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                      <span style={{ fontSize: "0.85rem", color: "var(--text-3)" }}>
                        Gefunden: <strong style={{ color: "#1e293b" }}>{notifCheckResult.alerts?.length ?? 0}</strong>
                      </span>
                      <span style={{ fontSize: "0.85rem", color: "var(--text-3)" }}>
                        E-Mail gesendet:{" "}
                        <strong style={{ color: notifCheckResult.email_sent ? "#16a34a" : "#64748b" }}>
                          {notifCheckResult.email_sent ? `Ja → ${notifCheckResult.email_to}` : "Nein"}
                        </strong>
                      </span>
                      <span style={{ fontSize: "0.85rem", color: "var(--text-3)" }}>
                        SMTP:{" "}
                        <strong style={{ color: notifCheckResult.smtp_ready ? "#16a34a" : "#dc2626" }}>
                          {notifCheckResult.smtp_ready ? "konfiguriert" : "nicht konfiguriert"}
                        </strong>
                      </span>
                    </div>

                    {notifCheckResult.alerts?.length > 0 ? (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                        <thead>
                          <tr style={{ background: "#1e3a5f", color: "#fff" }}>
                            <th style={{ padding: "8px 10px", textAlign: "left" }}>Mitarbeiter</th>
                            <th style={{ padding: "8px 10px", textAlign: "left" }}>Eingecheckt seit</th>
                            <th style={{ padding: "8px 10px", textAlign: "left" }}>Dauer</th>
                          </tr>
                        </thead>
                        <tbody>
                          {notifCheckResult.alerts.map((a, i) => (
                            <tr key={a.employee_id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                              <td style={{ padding: "7px 10px", borderBottom: "1px solid #e2e8f0" }}>{a.employee_name}</td>
                              <td style={{ padding: "7px 10px", borderBottom: "1px solid #e2e8f0" }}>
                                {new Date(a.checkin_time).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                              </td>
                              <td style={{ padding: "7px 10px", borderBottom: "1px solid #e2e8f0", color: "#c0392b", fontWeight: 700 }}>
                                {a.hours_elapsed} Std.
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ color: "#16a34a", fontWeight: 600, margin: 0 }}>
                        ✓ Kein Mitarbeiter überschreitet den Schwellenwert.
                      </p>
                    )}

                    {!notifCheckResult.smtp_ready && (
                      <p style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#64748b", background: "#fef9c3", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
                        Hinweis: SMTP ist nicht konfiguriert — E-Mail-Versand ist deaktiviert.
                        Setze <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> in der <code>.env</code>-Datei.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            </div>
          )}

        </main>
      </div>

      {empDeactivateModal && (
        <div
          className="ad-modal-backdrop"
          role="presentation"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget && !empDeactivateBusy) setEmpDeactivateModal(null);
          }}
        >
          <div
            className="ad-modal ad-modal--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ad-emp-deactivate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ad-modal__header">
              <div>
                <h2 id="ad-emp-deactivate-title" className="ad-modal__title">Mitarbeiter endgültig löschen?</h2>
                <p className="ad-modal__subtitle">
                  {empDeactivateModal.name} ({empDeactivateModal.email})
                </p>
              </div>
              <button
                type="button"
                className="ad-modal__close"
                onClick={() => { if (!empDeactivateBusy) setEmpDeactivateModal(null); }}
                disabled={empDeactivateBusy}
                aria-label="Schließen"
              >
                ×
              </button>
            </div>
            <div className="ad-modal__body">
              <p className="ad-modal__summary ad-modal__summary--warn" role="alert">
                Der Mitarbeiter und <strong>alle zugehörigen Daten</strong> werden unwiderruflich gelöscht:
                Stempelprotokoll, Arbeitszeiten, Urlaubsanträge, Schichten, Benachrichtigungen und Standort-Zuweisungen.
                Diese Aktion kann <strong>nicht rückgängig</strong> gemacht werden.
              </p>
              <div className="ad-modal__footer ad-modal__footer--modal-end">
                <button
                  type="button"
                  className="ad-btn ad-btn--ghost"
                  onClick={() => setEmpDeactivateModal(null)}
                  disabled={empDeactivateBusy}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="ad-btn ad-btn--danger"
                  onClick={confirmEmpDeactivate}
                  disabled={empDeactivateBusy}
                >
                  {empDeactivateBusy ? "Wird gelöscht…" : "Endgültig löschen"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <strong className="ad-hours-kpi__val">{fmtHours(hoursModalRow.hours_official_month ?? 0)}</strong>
                </div>
                <div className="ad-hours-kpi">
                  <span className="ad-hours-kpi__label">Ausstehend (Monat)</span>
                  <strong className="ad-hours-kpi__val">{fmtHours(hoursModalRow.hours_pending_month ?? 0)}</strong>
                </div>
                <div className={`ad-hours-kpi ad-hours-kpi--${(hoursModalRow.hours_diff_month ?? 0) > 0 ? "over" : (hoursModalRow.hours_diff_month ?? 0) < 0 ? "under" : "ok"}`}>
                  <span className="ad-hours-kpi__label">Abweichung</span>
                  <strong className="ad-hours-kpi__val">
                    {(hoursModalRow.hours_diff_month ?? 0) > 0
                      ? `+${fmtHours(hoursModalRow.hours_diff_month ?? 0)} über Soll`
                      : (hoursModalRow.hours_diff_month ?? 0) < 0
                        ? `${fmtHours(hoursModalRow.hours_diff_month ?? 0)} unter Soll`
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
                          <td>{formatSeconds(s.duration_seconds)}</td>
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
                <div className="ad-emp-edit__avatar" aria-hidden style={{ background: avatarColorForName(empEditEmp.name) }}>
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
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h} h : ${String(m).padStart(2, "0")} m : ${String(sec).padStart(2, "0")} s`;
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
