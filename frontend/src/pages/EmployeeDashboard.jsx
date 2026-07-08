import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient, clearToken } from "../apiClient";
import { MobileEmployeeDashboard } from "./MobileEmployeeDashboard";
import { NotificationDropdown } from "../components/NotificationDropdown";
import { useNotifications } from "../utils/useNotifications";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";
import { notifBodyLines, notifCategory, formatNotifRelativeTime } from "../utils/notificationDisplay";
import "./EmployeeDashboard.css";

const NOTIF_ENTITY_TAB = {
  work_session: "worked",
  shift_plan: "shifts",
  leave_request: "leave",
  attendance_log: "overview",
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

const ME_URL           = "/auth/me";
const CHECKIN_URL      = "/attendance/checkin";
const CHECKOUT_URL     = "/attendance/checkout";
const LOGS_URL         = "/attendance/logs";
const STATUS_URL       = "/attendance/status";
const WORKED_TIME_URL  = "/attendance/worked-time";
const MY_SHIFTS_URL    = "/planning/my-shifts";
const MY_SESSIONS_URL  = "/attendance/my-sessions";
const LEAVE_SUMMARY_URL = "/employee/leave-summary";
const LEAVE_REQUESTS_URL = "/employee/leave-requests";

const GEOFENCE_MESSAGE = "Outside allowed workplace area";

// ── Markdown renderer (bold + line breaks only, no external dep) ──────────────
function MdText({ text }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <span key={i} style={{ display: "block", minHeight: line.trim() ? undefined : "0.4em" }}>
            {parts.map((p, j) =>
              p.startsWith("**") && p.endsWith("**")
                ? <strong key={j}>{p.slice(2, -2)}</strong>
                : p
            )}
          </span>
        );
      })}
    </>
  );
}

// ── SVG Icons ────────────────────────────────────────────────────────────────
const IcoCheckin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);
const IcoWorked = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IcoShifts = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="12" y2="18" />
  </svg>
);
const IcoLogs = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6"  x2="21" y2="6"  />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6"  x2="3.01" y2="6"  />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);
const IcoAdmin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
const IcoLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const IcoBell = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const IcoSessions = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const IcoVacation = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-6" />
    <path d="M4.5 10a7.5 7.5 0 0 1 15 0Z" />
    <path d="M2 10h20" />
  </svg>
);
const IcoHome = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);

/** Mo–So Raster für einen Monat (monthIndex 0–11) */
function buildMonthCells(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const mon0 = (d) => (d + 6) % 7; // Montag = 0
  const pad = mon0(first.getDay());
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push({ kind: "pad", key: `p-${i}` });
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ kind: "day", day: d, iso, key: iso });
  }
  while (cells.length % 7 !== 0) cells.push({ kind: "pad", key: `t-${cells.length}` });
  return cells;
}

function enumerateRequestDates(isoStart, isoEnd) {
  if (!isoStart || !isoEnd) return [];
  const start = new Date(`${isoStart}T12:00:00`);
  const end = new Date(`${isoEnd}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Kalendertag YYYY-MM-DD in lokaler Zeitzone (für Stempel-Sessions). */
function localIsoDateFromInstant(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localIsoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Letzter Check-in nur wenn das neueste Log-Ereignis ein Check-in ist. */
function getLatestCheckinIsoFromLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) return null;
  const latest = logs[0];
  if (String(latest?.type ?? "").toLowerCase() === "checkin") {
    return latest.created_at ?? null;
  }
  return null;
}

/**
 * Startzeit für die Live-Stoppuhr (nur aktuelle Besuchssession).
 * Kein workedTime.sessions — dort können alte Sessions die Anzeige verfälschen.
 */
function resolveLiveSessionStartIso(checkedIn, liveSessionStartAt, attendanceStatus, logs) {
  if (!checkedIn) return null;
  if (liveSessionStartAt) return liveSessionStartAt;
  if (attendanceStatus?.active_checkin_at) return attendanceStatus.active_checkin_at;
  return getLatestCheckinIsoFromLogs(logs);
}

/** { h, m, s } seit checkinIso (lokale Uhr). */
function formatElapsedHmsParts(checkinIso) {
  if (!checkinIso) return null;
  const t0 = new Date(checkinIso).getTime();
  if (Number.isNaN(t0)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - t0) / 1000));
  return {
    h: Math.floor(secs / 3600),
    m: Math.floor((secs % 3600) / 60),
    s: secs % 60,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Re-Rendern jede Sekunde solange eine laufende Schicht angezeigt wird. */
function useTickingNow(enabled) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
}

/** Kalender + Legende (geplant / gestempelt / Urlaub) */
function EmployeeMonthCalendar({
  year,
  monthIndex,
  onPrev,
  onNext,
  plannedShiftDates,
  workedShiftDates,
  leaveDayMap,
  todayIso,
  size = "default",
}) {
  const cells = buildMonthCells(year, monthIndex);
  const title = new Date(year, monthIndex, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const dow = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const calClass = size === "large" ? "ed-cal ed-cal--large" : "ed-cal";

  return (
    <div className={calClass}>
      <div className="ed-cal__head">
        <button type="button" className="ed-cal__nav" onClick={onPrev} aria-label="Vorheriger Monat">‹</button>
        <h3 className="ed-cal__title">{title}</h3>
        <button type="button" className="ed-cal__nav" onClick={onNext} aria-label="Nächster Monat">›</button>
      </div>
      <div className="ed-cal__dow" role="row">
        {dow.map((d) => (
          <span key={d} className="ed-cal__dow-cell">{d}</span>
        ))}
      </div>
      <div className="ed-cal__grid" role="grid">
        {cells.map((c) => {
          if (c.kind === "pad") return <div key={c.key} className="ed-cal__cell ed-cal__cell--pad" aria-hidden />;
          const isToday = c.iso === todayIso;
          const hasPlanned = plannedShiftDates?.has?.(c.iso);
          const hasWorked = workedShiftDates?.has?.(c.iso);
          const leave = leaveDayMap?.get?.(c.iso);
          return (
            <div
              key={c.key}
              className={`ed-cal__cell${isToday ? " ed-cal__cell--today" : ""}`}
              role="gridcell"
            >
              <span className="ed-cal__num">{c.day}</span>
              {(hasPlanned || hasWorked || leave) && (
                <span className="ed-cal__dots" aria-hidden>
                  {hasPlanned && <span className="ed-cal__dot ed-cal__dot--planned" title="Geplante Schicht" />}
                  {hasWorked && <span className="ed-cal__dot ed-cal__dot--worked" title="Gearbeitet (Einstempelung)" />}
                  {leave === "approved" && <span className="ed-cal__dot ed-cal__dot--leave-ok" />}
                  {leave === "pending" && <span className="ed-cal__dot ed-cal__dot--leave-pend" />}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ul className="ed-cal__legend">
        <li><span className="ed-cal__dot ed-cal__dot--planned" /> Geplante Schicht</li>
        <li><span className="ed-cal__dot ed-cal__dot--worked" /> Gearbeitet (Stempel)</li>
        <li><span className="ed-cal__dot ed-cal__dot--leave-ok" /> Urlaub genehmigt</li>
        <li><span className="ed-cal__dot ed-cal__dot--leave-pend" /> Urlaub offen</li>
      </ul>
    </div>
  );
}

/** Rollenbezeichnung für die Anzeige (Topbar). */
function formatRoleDe(role) {
  const r = String(role || "").toLowerCase();
  if (r === "employee") return "Mitarbeiter";
  if (r === "admin") return "Administration";
  return role || "—";
}

/** Server liefert englische Status-Texte — für einheitliches Deutsch mappen. */
const ATTENDANCE_MSG_DE = {
  "Checked out — no punches recorded yet. Start with Check In.":
    "Ausgestempelt — noch keine Stempel. Zum Start: Einstempeln.",
  "Checked in — Check Out ends this visit. Both actions can repeat in the same day.":
    "Eingestempelt — mit Ausstempeln beendest du diesen Besuch. Mehrere Ein- und Ausstempelungen pro Tag sind möglich.",
  "Checked out — you can Check In again for another visit whenever you arrive.":
    "Ausgestempelt — du kannst bei Ankunft wieder einstempeln.",
};

function localizeAttendanceMessage(msg) {
  if (msg == null || typeof msg !== "string") return msg;
  const t = msg.trim();
  return ATTENDANCE_MSG_DE[t] ?? msg;
}

// ── Nav config (mobile/desktop labels via i18n in components) ─────────────────
export function EmployeeDashboard() {
  const isMobile = useIsMobile();
  return (
    <LanguageProvider>
      {isMobile ? <MobileEmployeeDashboard /> : <DesktopEmployeeDashboard />}
    </LanguageProvider>
  );
}

// ── Desktop Dashboard ─────────────────────────────────────────────────────────
function DesktopEmployeeDashboard() {
  const navigate = useNavigate();
  const notif = useNotifications();
  const { t, locale } = useLanguage();

  const navItems = useMemo(
    () => [
      { id: "overview", label: t("desktop.nav.overview"), Icon: IcoHome },
      { id: "worked", label: t("desktop.nav.worked"), Icon: IcoWorked },
      { id: "shifts", label: t("desktop.nav.shifts"), Icon: IcoShifts },
      { id: "leave", label: t("desktop.nav.leave"), Icon: IcoVacation },
      { id: "notifications", label: t("desktop.nav.notifications"), Icon: IcoBell },
      { id: "logs", label: t("desktop.nav.logs"), Icon: IcoLogs },
    ],
    [t],
  );

  // ── Tab state (Standard: Dashboard mit Kalender & Schnellaktionen) ───────
  const [activeTab, setActiveTab] = useState("overview");
  const [highlightSessionId, setHighlightSessionId] = useState(null);
  /** Monat für Kalender (1. des Monats) */
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  // ── Profile ───────────────────────────────────────────────────────────────
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // ── Attendance logs ───────────────────────────────────────────────────────
  const [logs,        setLogs]        = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError,   setLogsError]   = useState(null);

  // ── Attendance status ─────────────────────────────────────────────────────
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [statusLoading,    setStatusLoading]    = useState(true);
  const [statusError,      setStatusError]      = useState(null);

  // ── Worked time ───────────────────────────────────────────────────────────
  const [workedTime,    setWorkedTime]    = useState(null);
  const [workedLoading, setWorkedLoading] = useState(true);
  const [workedError,   setWorkedError]   = useState(null);

  // ── GPS / check-in action ─────────────────────────────────────────────────
  const [gpsCoords,          setGpsCoords]          = useState(null);
  const [gpsError,           setGpsError]           = useState(null);
  const [gpsBusy,            setGpsBusy]            = useState(false);
  const [attendanceResponse, setAttendanceResponse] = useState(null);
  const [attendanceError,    setAttendanceError]    = useState(null);
  const [areaStatus,         setAreaStatus]         = useState(null);
  /** Start der aktuellen Besuchssession — nur per Einstempeln/Ausstempeln ändern, nicht per Refetch. */
  const [liveSessionStartAt, setLiveSessionStartAt] = useState(null);
  const liveSessionHydratedRef = useRef(false);
  const statusFetchSeqRef = useRef(0);

  // ── Shifts ────────────────────────────────────────────────────────────────
  const [myShifts,      setMyShifts]      = useState([]);
  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [shiftsError,   setShiftsError]   = useState(null);

  // ── My Sessions (approval status) ─────────────────────────────────────────
  const [mySessions,      setMySessions]      = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError,   setSessionsError]   = useState(null);

  // ── Urlaub ─────────────────────────────────────────────────────────────────
  const [leaveSummary,        setLeaveSummary]        = useState(null);
  const [leaveSummaryLoading, setLeaveSummaryLoading] = useState(true);
  const [leaveSummaryError,   setLeaveSummaryError]   = useState(null);
  const [myLeaveRequests,     setMyLeaveRequests]     = useState([]);
  const [leaveListLoading,    setLeaveListLoading]    = useState(false);
  const [leaveListError,      setLeaveListError]      = useState(null);
  const [leaveStart,          setLeaveStart]          = useState("");
  const [leaveEnd,            setLeaveEnd]            = useState("");
  const [leaveNote,           setLeaveNote]           = useState("");
  const [leaveFormBusy,       setLeaveFormBusy]       = useState(false);
  const [leaveFormError,      setLeaveFormError]      = useState(null);
  const [leaveFormSuccess,    setLeaveFormSuccess]    = useState(null);

  // ── API fetchers ──────────────────────────────────────────────────────────
  const fetchAttendanceStatus = useCallback(() => {
    statusFetchSeqRef.current += 1;
    const seq = statusFetchSeqRef.current;
    setStatusLoading(true);
    setStatusError(null);
    return apiClient
      .get(STATUS_URL)
      .then((res) => {
        if (seq !== statusFetchSeqRef.current) return;
        setAttendanceStatus(res.data);
      })
      .catch(() => {
        if (seq !== statusFetchSeqRef.current) return;
        setAttendanceStatus(null);
        setStatusError("Stempelstatus konnte nicht geladen werden.");
      })
      .finally(() => {
        if (seq === statusFetchSeqRef.current) setStatusLoading(false);
      });
  }, []);

  const fetchAttendanceLogs = useCallback(() => {
    setLogsLoading(true);
    setLogsError(null);
    return apiClient
      .get(LOGS_URL)
      .then((res) => { setLogs(res.data); })
      .catch(() => { setLogsError("Stempelprotokoll konnte nicht geladen werden."); })
      .finally(() => { setLogsLoading(false); });
  }, []);

  const fetchWorkedTime = useCallback(() => {
    setWorkedLoading(true);
    setWorkedError(null);
    return apiClient
      .get(WORKED_TIME_URL)
      .then((res) => { setWorkedTime(res.data); })
      .catch(() => { setWorkedTime(null); setWorkedError("Arbeitszeit konnte nicht geladen werden."); })
      .finally(() => { setWorkedLoading(false); });
  }, []);

  const fetchLeaveSummary = useCallback(() => {
    setLeaveSummaryLoading(true);
    setLeaveSummaryError(null);
    return apiClient
      .get(LEAVE_SUMMARY_URL)
      .then((res) => { setLeaveSummary(res.data); })
      .catch(() => {
        setLeaveSummary(null);
        setLeaveSummaryError("Urlaubsübersicht konnte nicht geladen werden.");
      })
      .finally(() => { setLeaveSummaryLoading(false); });
  }, []);

  const fetchMyLeaveRequests = useCallback(() => {
    setLeaveListLoading(true);
    setLeaveListError(null);
    return apiClient
      .get(LEAVE_REQUESTS_URL)
      .then((res) => { setMyLeaveRequests(res.data ?? []); })
      .catch(() => {
        setMyLeaveRequests([]);
        setLeaveListError("Anträge konnten nicht geladen werden.");
      })
      .finally(() => { setLeaveListLoading(false); });
  }, []);

  useEffect(() => { fetchAttendanceLogs();   }, [fetchAttendanceLogs]);
  useEffect(() => { fetchAttendanceStatus(); }, [fetchAttendanceStatus]);
  useEffect(() => { fetchWorkedTime();       }, [fetchWorkedTime]);
  useEffect(() => { fetchLeaveSummary();     }, [fetchLeaveSummary]);

  // Nur beim ersten Status-Laden (Seitenaufruf): laufende Session aus API übernehmen.
  // Kein Sync bei späteren Refetches — veraltete Antworten würden sonst die Stoppuhr zurücksetzen.
  useEffect(() => {
    if (liveSessionHydratedRef.current || !attendanceStatus) return;
    liveSessionHydratedRef.current = true;
    if (
      attendanceStatus.status === "checked_in" &&
      attendanceStatus.active_checkin_at
    ) {
      setLiveSessionStartAt(attendanceStatus.active_checkin_at);
    }
  }, [attendanceStatus]);

  useEffect(() => {
    setShiftsLoading(true);
    apiClient
      .get(MY_SHIFTS_URL)
      .then((res) => { setMyShifts(res.data ?? []); })
      .catch(() => { setShiftsError("Schichten konnten nicht geladen werden."); })
      .finally(() => { setShiftsLoading(false); });
  }, []);

  const fetchMySessions = useCallback(() => {
    setSessionsLoading(true);
    setSessionsError(null);
    return apiClient
      .get(MY_SESSIONS_URL)
      .then((res) => { setMySessions(res.data ?? []); })
      .catch(() => { setSessionsError("Sessions konnten nicht geladen werden."); })
      .finally(() => { setSessionsLoading(false); });
  }, []);

  useEffect(() => {
    if (activeTab === "worked") fetchMySessions();
  }, [activeTab, fetchMySessions]);

  useEffect(() => {
    if (activeTab === "notifications") notif.openList();
  }, [activeTab, notif.openList]);

  useEffect(() => {
    if (activeTab !== "worked" || highlightSessionId == null) return undefined;
    const el = document.getElementById(`session-${highlightSessionId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightSessionId(null), 3000);
    return () => clearTimeout(t);
  }, [activeTab, highlightSessionId, mySessions]);

  useEffect(() => {
    if (activeTab === "leave" || activeTab === "overview") fetchMyLeaveRequests();
  }, [activeTab, fetchMyLeaveRequests]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(ME_URL)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => {
        if (!cancelled) setError("Profil konnte nicht geladen werden. Läuft der FastAPI-Server auf Port 8000?");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── GPS + POST ────────────────────────────────────────────────────────────
  function runGpsThenPost(url) {
    setGpsError(null);
    setAttendanceResponse(null);
    setAttendanceError(null);
    setAreaStatus(null);

    if (!navigator.geolocation) {
      setGpsError("Dieser Browser unterstützt keine Geolocation.");
      return;
    }

    setGpsBusy(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGpsCoords({ lat, lng });

        apiClient
          .post(url, { lat, lng })
          .then((res) => {
            setAttendanceResponse(res.data);
            setAreaStatus("inside");

            const isCheckin = url === CHECKIN_URL || String(url).endsWith("/checkin");
            const isCheckout = url === CHECKOUT_URL || String(url).endsWith("/checkout");

            if (isCheckin && res.data?.created_at) {
              const startedAt = res.data.created_at;
              statusFetchSeqRef.current += 1;
              setLiveSessionStartAt(startedAt);
              setAttendanceStatus((prev) =>
                prev
                  ? {
                      ...prev,
                      status: "checked_in",
                      last_type: "checkin",
                      can_checkin: false,
                      can_checkout: true,
                      active_checkin_at: startedAt,
                    }
                  : {
                      status: "checked_in",
                      last_type: "checkin",
                      can_checkin: false,
                      can_checkout: true,
                      active_checkin_at: startedAt,
                    },
              );
              setLogs((prev) => [
                {
                  id: res.data?.id ?? Date.now(),
                  type: "checkin",
                  lat: res.data?.lat ?? lat,
                  lng: res.data?.lng ?? lng,
                  created_at: startedAt,
                },
                ...(prev ?? []).filter((e) => String(e?.type ?? "").toLowerCase() !== "checkin" || e.created_at !== startedAt),
              ]);
            }
            if (isCheckout) {
              statusFetchSeqRef.current += 1;
              setLiveSessionStartAt(null);
              setAttendanceStatus((prev) =>
                prev
                  ? {
                      ...prev,
                      status: "checked_out",
                      last_type: "checkout",
                      can_checkin: true,
                      can_checkout: false,
                      active_checkin_at: null,
                    }
                  : prev,
              );
              setWorkedTime((prev) => {
                if (!prev) return prev;
                const closedAt = res.data?.created_at ?? new Date().toISOString();
                return {
                  ...prev,
                  active: false,
                  active_checkin_at: null,
                  sessions: (prev.sessions ?? []).map((s) =>
                    s.checkout
                      ? s
                      : { ...s, checkout: closedAt, duration_seconds: s.duration_seconds ?? 0 },
                  ),
                };
              });
              setLogs((prev) => {
                const checkoutEntry = {
                  id: res.data?.id ?? Date.now(),
                  type: "checkout",
                  lat: res.data?.lat,
                  lng: res.data?.lng,
                  created_at: res.data?.created_at ?? new Date().toISOString(),
                };
                return [checkoutEntry, ...(prev ?? [])];
              });
            }

            return fetchAttendanceLogs()
              .then(() => fetchWorkedTime())
              .then(() => fetchAttendanceStatus())
              .then(() => fetchLeaveSummary());
          })
          .catch((err) => {
            if (
              axios.isAxiosError(err) &&
              err.response?.data?.status === "error" &&
              typeof err.response.data.message === "string"
            ) {
              const msg = err.response.data.message;
              setAttendanceError(
                msg === GEOFENCE_MESSAGE
                  ? "Außerhalb des erlaubten Arbeitsbereichs (nur Schichtstandort während der Schicht, sonst dein zugewiesener Standort)."
                  : msg,
              );
              setAreaStatus(msg === GEOFENCE_MESSAGE ? "outside" : null);
              return;
            }
            setAttendanceError("Stempelung konnte nicht an den Server gesendet werden.");
            setAreaStatus(null);
          })
          .finally(() => { setGpsBusy(false); });
      },
      (geoErr) => {
        setGpsBusy(false);
        setGpsError(geoErr.message || "Standortberechtigung verweigert oder nicht verfügbar.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function handleLeaveSubmit(e) {
    e.preventDefault();
    setLeaveFormError(null);
    setLeaveFormSuccess(null);
    if (!leaveStart || !leaveEnd) {
      setLeaveFormError("Von- und Bis-Datum angeben.");
      return;
    }
    setLeaveFormBusy(true);
    try {
      await apiClient.post(LEAVE_REQUESTS_URL, {
        start_date: leaveStart,
        end_date: leaveEnd,
        note: leaveNote.trim() || null,
      });
      setLeaveFormSuccess("Antrag wurde eingereicht — dein Admin wird informiert.");
      setLeaveNote("");
      await fetchLeaveSummary();
      await fetchMyLeaveRequests();
    } catch (err) {
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      setLeaveFormError(typeof d === "string" ? d : "Antrag konnte nicht gesendet werden.");
    } finally {
      setLeaveFormBusy(false);
    }
  }

  const shiftDateSet = useMemo(() => {
    const s = new Set();
    for (const sh of myShifts) {
      if (sh.shift_date) s.add(sh.shift_date);
    }
    return s;
  }, [myShifts]);

  /** Tage mit mindestens einer Einstempelung (lokales Datum), aus Paar-Sessions. */
  const workedShiftDateSet = useMemo(() => {
    const s = new Set();
    if (!workedTime?.sessions?.length) return s;
    for (const sess of workedTime.sessions) {
      const iso = localIsoDateFromInstant(sess.checkin);
      if (iso) s.add(iso);
    }
    return s;
  }, [workedTime]);

  const leaveDayMap = useMemo(() => {
    const m = new Map();
    for (const r of myLeaveRequests) {
      const st = (r.status || "").toLowerCase();
      if (st === "rejected") continue;
      const kind = st === "approved" ? "approved" : "pending";
      for (const iso of enumerateRequestDates(r.start_date, r.end_date)) {
        const prev = m.get(iso);
        if (kind === "approved" || prev === "approved") m.set(iso, "approved");
        else m.set(iso, "pending");
      }
    }
    return m;
  }, [myLeaveRequests]);

  /** Nächste Schichten (ab heute) für Dashboard-Karte */
  const upcomingShiftsPreview = useMemo(() => {
    const today = localIsoToday();
    return [...myShifts]
      .filter((sh) => sh.shift_date >= today)
      .sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time))
      .slice(0, 4);
  }, [myShifts]);

  const calYear = calendarMonth.getFullYear();
  const calMonthIndex = calendarMonth.getMonth();
  const calPrev = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const calNext = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const isCheckedIn = attendanceStatus?.status === "checked_in";
  const activeCheckinIso = useMemo(
    () => resolveLiveSessionStartIso(
      isCheckedIn,
      liveSessionStartAt,
      attendanceStatus,
      logs,
    ),
    [isCheckedIn, liveSessionStartAt, attendanceStatus, logs],
  );
  useTickingNow(Boolean(isCheckedIn && activeCheckinIso));

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="ed-loading">
        <div className="ed-loading__spinner" />
        <span>Dashboard wird geladen…</span>
      </div>
    );
  }
  if (error) {
    return <div className="ed-error"><p role="alert">{error}</p></div>;
  }
  if (!data) {
    return <div className="ed-error"><p>Keine Profildaten erhalten.</p></div>;
  }

  const todayLabel = new Date().toLocaleDateString("de-DE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const activeLabel   = navItems.find((n) => n.id === activeTab)?.label ?? t("desktop.nav.overview");
  const liveShiftParts = formatElapsedHmsParts(activeCheckinIso);

  const monthHoursRemain =
    workedTime != null
      ? {
          target: workedTime.month_target_hours ?? 160,
          done: workedTime.official_hours_month ?? 0,
          pend: workedTime.pending_hours_month ?? 0,
          remain:
            Math.round(
              ((workedTime.month_target_hours ?? 160) - (workedTime.official_hours_month ?? 0)) * 100,
            ) / 100,
        }
      : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ed-shell">

      {/* ═══ SIDEBAR ═══════════════════════════════════════════════════════ */}
      <nav className="ed-sidebar">
        <div className="ed-sidebar__brand">
          <span className="ed-sidebar__brand-icon">⏱</span>
          <span className="ed-sidebar__brand-name">TimeStemple</span>
        </div>

        <div className="ed-sidebar__nav">
          {navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`ed-sidebar__item${activeTab === id ? " ed-sidebar__item--active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              <span className="ed-sidebar__item-icon"><Icon /></span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="ed-sidebar__footer">
          {data.role === "admin" && (
            <Link to="/admin/dashboard" className="ed-sidebar__item">
              <span className="ed-sidebar__item-icon"><IcoAdmin /></span>
              <span>Admin Panel</span>
            </Link>
          )}
          <button
            type="button"
            className="ed-sidebar__logout"
            onClick={() => { clearToken(); navigate("/login"); }}
          >
            <span className="ed-sidebar__item-icon"><IcoLogout /></span>
            <span>Log out</span>
          </button>
        </div>
      </nav>

      {/* ═══ MAIN ══════════════════════════════════════════════════════════ */}
      <div className="ed-main">

        {/* ── Topbar ── */}
        <div className="ed-topbar">
          <div className="ed-topbar__left">
            <h1 className="ed-topbar__title">{activeLabel}</h1>
            <span className="ed-topbar__date">{todayLabel}</span>
          </div>
          <NotificationDropdown
            variant="desktop"
            notif={notif}
            onOpenEntity={(n) => {
              const tab = NOTIF_ENTITY_TAB[n.entity_type];
              if (tab) {
                setActiveTab(tab);
                if (n.entity_type === "work_session") setHighlightSessionId(n.entity_id);
              } else {
                setActiveTab("notifications");
              }
            }}
            onViewAll={() => {
              setActiveTab("notifications");
              notif.openList();
            }}
          />
          <div className="ed-topbar__user">
            <div className="ed-topbar__avatar">{data.name?.[0]?.toUpperCase() ?? "?"}</div>
            <div className="ed-topbar__user-info">
              <span className="ed-topbar__user-name">{data.name}</span>
              <span className="ed-topbar__user-role">{formatRoleDe(data.role)}</span>
            </div>
            <button
              type="button"
              className="ed-topbar__mobile-logout"
              onClick={() => { clearToken(); navigate("/login"); }}
              aria-label="Ausloggen"
            >
              <IcoLogout />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className={`ed-content${activeTab === "overview" ? " ed-content--overview-dense" : ""}`}>

          {/* Stats cards — immer sichtbar */}
          <div className={`ed-stats-grid${activeTab === "overview" ? " ed-stats-grid--overview-4" : ""}`}>
            <div className={`ed-stat-card ed-stat-card--${isCheckedIn ? "green" : "blue"}`}>
              <div className="ed-stat-card__icon">{isCheckedIn ? "🟢" : "⏸"}</div>
              <div className="ed-stat-card__body">
                <div className="ed-stat-card__value">{isCheckedIn ? "Eingestempelt" : "Ausgestempelt"}</div>
                <div className="ed-stat-card__label">Status</div>
              </div>
            </div>
            <div className="ed-stat-card ed-stat-card--green">
              <div className="ed-stat-card__icon">✅</div>
              <div className="ed-stat-card__body">
                <div className="ed-stat-card__value">
                  {workedLoading
                    ? "…"
                    : workedTime
                      ? formatDurationSeconds(workedTime.official_seconds_month ?? 0)
                      : "—"}
                </div>
                <div className="ed-stat-card__label">Offiziell (Monat)</div>
              </div>
            </div>
            <div className="ed-stat-card ed-stat-card--orange">
              <div className="ed-stat-card__icon">⏳</div>
              <div className="ed-stat-card__body">
                <div className="ed-stat-card__value">
                  {workedLoading ? "…" : workedTime ? (workedTime.pending_count ?? 0) : "—"}
                </div>
                <div className="ed-stat-card__label">Ausstehend</div>
              </div>
            </div>
            <div className="ed-stat-card ed-stat-card--vacation">
              <div className="ed-stat-card__icon">🏖</div>
              <div className="ed-stat-card__body">
                <div className="ed-stat-card__value">
                  {leaveSummaryLoading ? "…" : leaveSummary != null ? `${leaveSummary.available_days}` : "—"}
                </div>
                <div className="ed-stat-card__label">Urlaub noch buchbar ({new Date().getFullYear()})</div>
                {leaveSummaryError ? (
                  <span className="ed-stat-card__hint">{leaveSummaryError}</span>
                ) : leaveSummary != null ? (
                  <span className="ed-stat-card__hint">
                    Soll {leaveSummary.annual_leave_days} · {leaveSummary.used_days_this_year} genommen · Rest{" "}
                    {leaveSummary.remaining_days}
                    {leaveSummary.pending_days_this_year > 0
                      ? ` · ${leaveSummary.pending_days_this_year} Tage ausstehend reserviert`
                      : leaveSummary.pending_requests > 0
                        ? ` · ${leaveSummary.pending_requests} Antrag offen`
                        : ""}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* ═══ DASHBOARD (Übersicht + Kalender + Stempeln) ═══════════════════ */}
          {activeTab === "overview" && (
            <div className="ed-section">
              <div className="ed-section-title ed-section-title--overview">
                <div className="ed-section-title__text">
                  <h2>Übersicht</h2>
                  <p className="ed-section-title__sub">Stempeln, Monatsstunden, Kalender und nächste Termine</p>
                </div>
              </div>
              <div className="ed-overview ed-overview--dashboard">
                <div className="ed-overview__pre">
                  <div className="ed-overview__primary">
                    <div className="ed-card ed-overview__hero">
                      <p className="ed-hint ed-overview__lede">
                        Stempeln direkt hier mit Browser-Standort — Einstempeln und Ausstempeln wechseln sich ab.
                      </p>

                      {statusLoading ? (
                        <p className="ed-hint">Status wird geladen…</p>
                      ) : statusError ? (
                        <p className="ed-alert" role="alert">{statusError}</p>
                      ) : attendanceStatus ? (
                        <div className="ed-status-row ed-status-row--hero">
                          <span className={`ed-badge ed-badge--${isCheckedIn ? "green" : "gray"}`}>
                            {isCheckedIn ? "Eingestempelt" : "Ausgestempelt"}
                          </span>
                          <p className="ed-status-message">{localizeAttendanceMessage(attendanceStatus.message)}</p>
                        </div>
                      ) : null}

                      <div className="ed-hero-actions">
                        <button
                          type="button"
                          className="ed-btn ed-btn--checkin ed-btn--hero"
                          onClick={() => runGpsThenPost(CHECKIN_URL)}
                          disabled={
                            gpsBusy || statusLoading || Boolean(statusError) || !attendanceStatus?.can_checkin
                          }
                        >
                          {gpsBusy && attendanceStatus?.can_checkin ? "Standort wird ermittelt…" : "✔ Einstempeln"}
                        </button>
                        <button
                          type="button"
                          className="ed-btn ed-btn--checkout ed-btn--hero"
                          onClick={() => runGpsThenPost(CHECKOUT_URL)}
                          disabled={
                            gpsBusy || statusLoading || Boolean(statusError) || !attendanceStatus?.can_checkout
                          }
                        >
                          {gpsBusy && attendanceStatus?.can_checkout ? "Standort wird ermittelt…" : "✖ Ausstempeln"}
                        </button>
                      </div>
                      <p className="ed-hint ed-hero-actions__hint">
                        Ausgegraute Taste: Aktion gerade nicht möglich (siehe Status oben).
                      </p>

                      {attendanceError && (
                        <p className="ed-alert" role="alert">{attendanceError}</p>
                      )}
                      {gpsError && (
                        <p className="ed-alert" role="alert">{gpsError}</p>
                      )}
                    </div>

                    <div className="ed-overview__stack">
                      <div className="ed-card ed-overview__live-shift">
                        <h3 className="ed-overview__quick-title">Laufende Schicht</h3>
                        {isCheckedIn && !activeCheckinIso && (
                          <p className="ed-hint">Zeit wird geladen…</p>
                        )}
                        {isCheckedIn && activeCheckinIso && liveShiftParts && (
                          <>
                            <p className="ed-live-shift__since">
                              Gestartet: <time dateTime={activeCheckinIso}>{formatLogTime(activeCheckinIso)}</time>
                            </p>
                            <div className="ed-live-shift__clock" aria-live="polite" aria-atomic="true">
                              <span className="ed-live-shift__unit">
                                <span className="ed-live-shift__num">{pad2(liveShiftParts.h)}</span>
                                <span className="ed-live-shift__cap">h</span>
                              </span>
                              <span className="ed-live-shift__colon" aria-hidden>:</span>
                              <span className="ed-live-shift__unit">
                                <span className="ed-live-shift__num">{pad2(liveShiftParts.m)}</span>
                                <span className="ed-live-shift__cap">m</span>
                              </span>
                              <span className="ed-live-shift__colon" aria-hidden>:</span>
                              <span className="ed-live-shift__unit">
                                <span className="ed-live-shift__num">{pad2(liveShiftParts.s)}</span>
                                <span className="ed-live-shift__cap">s</span>
                              </span>
                            </div>
                            <p className="ed-live-shift__hint">
                              Zum Beenden: <strong>Ausstempeln</strong> (Button oben).
                            </p>
                          </>
                        )}
                        {!isCheckedIn && (
                          <p className="ed-hint ed-live-shift__idle">
                            Keine laufende Schicht. Nach <strong>Einstempeln</strong> startet die Live-Zeit bei{" "}
                            <strong>0 h : 00 m : 00 s</strong>.
                          </p>
                        )}
                      </div>

                      <div className="ed-card ed-overview__month-budget ed-overview__month-budget--in-primary">
                        <p className="ed-card-title ed-overview__cal-heading">Stunden im Monat</p>
                        <p className="ed-overview__month-budget-sub">
                          {new Date().toLocaleString("de-DE", { month: "long", year: "numeric" })} · Monatssoll minus
                          genehmigte/korrigierte Sessions
                        </p>
                        {workedLoading ? (
                          <p className="ed-hint">Wird geladen…</p>
                        ) : workedError ? (
                          <p className="ed-alert" role="alert">{workedError}</p>
                        ) : !workedTime ? (
                          <p className="ed-hint">Keine Daten.</p>
                        ) : monthHoursRemain ? (
                          <>
                            <div className="ed-overview__month-budget-rows">
                              <div className="ed-overview__month-budget-row">
                                <span>Monatssoll</span>
                                <strong>{formatDurationSeconds(monthHoursRemain.target * 3600)}</strong>
                              </div>
                              <div className="ed-overview__month-budget-row">
                                <span>Offiziell (Monat)</span>
                                <strong className="ed-overview__month-budget-done">
                                  {formatDurationSeconds(monthHoursRemain.done * 3600)}
                                </strong>
                              </div>
                              {monthHoursRemain.pend > 0 && (
                                <div className="ed-overview__month-budget-row ed-overview__month-budget-row--muted">
                                  <span>Davon ausstehend</span>
                                  <strong>{formatDurationSeconds(monthHoursRemain.pend * 3600)}</strong>
                                </div>
                              )}
                            </div>
                            <div
                              className={`ed-overview__month-budget-remain${
                                monthHoursRemain.remain > 0 ? "" : " ed-overview__month-budget-remain--done"
                              }`}
                              role="status"
                            >
                              {monthHoursRemain.remain > 0 ? (
                                <>
                                  <span className="ed-overview__month-budget-remain-label">Noch zu leisten</span>
                                  <span className="ed-overview__month-budget-remain-val">
                                    {formatDurationSeconds(monthHoursRemain.remain * 3600)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="ed-overview__month-budget-remain-label">Monatssoll</span>
                                  <span className="ed-overview__month-budget-remain-val">
                                    erreicht
                                    {monthHoursRemain.remain < 0
                                      ? ` · +${formatDurationSeconds(Math.abs(monthHoursRemain.remain) * 3600)} über Soll`
                                      : ""}
                                  </span>
                                </>
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="ed-overview__tri-grid"
                  role="group"
                  aria-label="Schichten, Kalender und Arbeitszeit"
                >
                  <div className="ed-overview__tri-col ed-overview__tri-col--shifts">
                    <div className="ed-card ed-overview__extra">
                      <h3 className="ed-overview__quick-title">Meine Schichten</h3>
                      <p className="ed-hint ed-overview__extra-hint">Nächste Termine (ab heute).</p>
                      {shiftsLoading ? (
                        <p className="ed-hint">Schichten werden geladen…</p>
                      ) : shiftsError ? (
                        <p className="ed-alert" role="alert">{shiftsError}</p>
                      ) : upcomingShiftsPreview.length === 0 ? (
                        <p className="ed-hint">Keine anstehenden Schichten.</p>
                      ) : (
                        <ul className="ed-overview__shift-list">
                          {upcomingShiftsPreview.map((shift) => {
                            const todayIso = new Date().toISOString().slice(0, 10);
                            const isToday = shift.shift_date === todayIso;
                            const dateLabel = new Date(`${shift.shift_date}T00:00:00`).toLocaleDateString("de-DE", {
                              weekday: "short",
                              day: "2-digit",
                              month: "short",
                            });
                            return (
                              <li key={shift.id} className="ed-overview__shift-row">
                                <span className="ed-overview__shift-date">
                                  {isToday && <span className="ed-overview__shift-today">Heute</span>}
                                  {dateLabel}
                                </span>
                                <span className="ed-overview__shift-time">
                                  {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
                                </span>
                                {shift.location_name && (
                                  <span className="ed-overview__shift-loc">{shift.location_name}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <button type="button" className="ed-btn ed-btn--ghost ed-btn--sm" onClick={() => setActiveTab("shifts")}>
                        Alle Schichten →
                      </button>
                    </div>
                  </div>

                  <div className="ed-overview__tri-col ed-overview__tri-col--calendar">
                    <div className="ed-card ed-overview__cal-card ed-overview__cal-card--feature">
                      <div className="ed-overview__cal-head">
                        <p className="ed-card-title ed-overview__cal-heading">Kalender</p>
                      </div>
                      {leaveListLoading && myLeaveRequests.length === 0 ? (
                        <p className="ed-hint">Kalenderdaten werden geladen…</p>
                      ) : (
                        <EmployeeMonthCalendar
                          year={calYear}
                          monthIndex={calMonthIndex}
                          onPrev={calPrev}
                          onNext={calNext}
                          plannedShiftDates={shiftDateSet}
                          workedShiftDates={workedShiftDateSet}
                          leaveDayMap={leaveDayMap}
                          todayIso={localIsoToday()}
                          size="large"
                        />
                      )}
                      {shiftsError && (
                        <p className="ed-hint" role="note">Schichten: {shiftsError}</p>
                      )}
                    </div>
                  </div>

                  <div className="ed-overview__tri-col ed-overview__tri-col--worked">
                    <div className="ed-card ed-overview__extra">
                      <h3 className="ed-overview__quick-title">Arbeitszeit (Monat)</h3>
                      <p className="ed-hint ed-overview__extra-hint">Offizielle und ausstehende Zeiten diesen Monat.</p>
                      {workedLoading ? (
                        <p className="ed-hint">Arbeitszeit wird geladen…</p>
                      ) : workedError ? (
                        <p className="ed-alert" role="alert">{workedError}</p>
                      ) : !workedTime ? (
                        <p className="ed-hint">Keine Daten.</p>
                      ) : (
                        <div className="ed-overview__worked">
                          <div className="ed-overview__worked-row">
                            <span className="ed-overview__worked-label">Offiziell</span>
                            <strong className="ed-overview__worked-val ed-overview__worked-val--ok">
                              {formatDurationSeconds(workedTime.official_seconds_month ?? 0)}
                            </strong>
                          </div>
                          <div className="ed-overview__worked-row">
                            <span className="ed-overview__worked-label">Ausstehend</span>
                            <strong className="ed-overview__worked-val ed-overview__worked-val--pend">
                              {formatDurationSeconds(workedTime.pending_seconds_month ?? 0)}
                              <span className="ed-overview__worked-meta"> ({workedTime.pending_count ?? 0})</span>
                            </strong>
                          </div>
                          <div className="ed-overview__worked-row ed-overview__worked-row--last">
                            <span className="ed-overview__worked-label">Stempelung</span>
                            <span>
                              <span className={`ed-badge ed-badge--${workedTime.active ? "green" : "gray"}`}>
                                {workedTime.active ? "Aktiv" : "Inaktiv"}
                              </span>
                              {isCheckedIn && (
                                <span className="ed-sr-only"> Live-Stoppuhr in der Karte „Laufende Schicht“.</span>
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                      <button type="button" className="ed-btn ed-btn--ghost ed-btn--sm" onClick={() => setActiveTab("worked")}>
                        Details &amp; Sessions →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ WORKED TIME ═════════════════════════════════════════════ */}
          {activeTab === "worked" && (() => {
            const loading = workedLoading || sessionsLoading;
            const pendingSessions  = mySessions.filter(s => s.status === "pending");
            const officialSessions = mySessions.filter(s => s.status === "approved" || s.status === "corrected");
            const rejectedSessions = mySessions.filter(s => s.status === "rejected");

            const fmtTime = (iso) => iso
              ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
              : "—";
            const fmtDate = (iso) => iso
              ? new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
              : "—";

            const WARN_THRESHOLD_S = 12 * 3600; // 12 Stunden

            const SessionCard = ({ s }) => {
              const isCorrected = s.status === "corrected";
              const isLong      = s.duration_seconds > WARN_THRESHOLD_S;
              const isPending   = s.status === "pending";
              const isApproved  = s.status === "approved";
              const isRejected  = s.status === "rejected";

              const cardCls = isCorrected ? "wt-card wt-card--corrected"
                            : isApproved  ? "wt-card wt-card--approved"
                            : isRejected  ? "wt-card wt-card--rejected"
                            : isLong      ? "wt-card wt-card--pending wt-card--warn"
                            :               "wt-card wt-card--pending";

              const checkinDate = fmtDate(s.checkin_time);

              return (
                <div
                  className={`${cardCls}${highlightSessionId === s.id ? " wt-scard--highlight" : ""}`}
                  id={`session-${s.id}`}
                >
                  <div className="wt-card__head">
                    <div className="wt-card__date">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      {checkinDate}
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      {isPending && isLong && (
                        <span className="wt-card__warn-badge">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          Vergessen?
                        </span>
                      )}
                      {isCorrected && (
                        <span className="wt-card__badge wt-card__badge--corrected">✎ Korrigiert</span>
                      )}
                      {isApproved && (
                        <span className="wt-card__badge wt-card__badge--approved">✓ Genehmigt</span>
                      )}
                      {isPending && (
                        <span className="wt-card__badge wt-card__badge--pending">⏳ Ausstehend</span>
                      )}
                      {isRejected && (
                        <span className="wt-card__badge wt-card__badge--rejected">✖ Abgelehnt</span>
                      )}
                    </div>
                  </div>

                  {/* Zeitleiste */}
                  <div className="wt-card__timeline">
                    <div className="wt-card__time-block">
                      <div className="wt-card__time-label">Eingestempelt</div>
                      <div className="wt-card__time-val">{fmtTime(s.checkin_time)}</div>
                    </div>
                    <div className="wt-card__arrow">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                    <div className="wt-card__time-block">
                      <div className="wt-card__time-label">Ausgestempelt</div>
                      <div className={`wt-card__time-val ${!s.checkout_time ? "wt-card__time-val--muted" : ""}`}>
                        {s.checkout_time ? fmtTime(s.checkout_time) : <em>offen</em>}
                      </div>
                    </div>
                    <div className="wt-card__dur">
                      <div className="wt-card__dur-label">Dauer</div>
                      <div className="wt-card__dur-val">{formatDurationSeconds(s.duration_seconds)}</div>
                    </div>
                  </div>

                  {/* Originale Zeiten bei Korrekturen */}
                  {isCorrected && (s.original_checkin_time || s.original_checkout_time) && (
                    <div className="wt-card__orig-row">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span className="wt-card__orig-label">Original:</span>
                      <span className="wt-card__orig-times">
                        {fmtDate(s.original_checkin_time)} {fmtTime(s.original_checkin_time)}
                        &nbsp;→&nbsp;
                        {s.original_checkout_time ? fmtTime(s.original_checkout_time) : "—"}
                      </span>
                    </div>
                  )}

                  {/* Admin-Notiz / Ablehnungsgrund */}
                  {(s.admin_note || s.rejection_reason) && (
                    <div className={`wt-card__note ${isRejected ? "wt-card__note--red" : "wt-card__note--blue"}`}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {isRejected ? `Grund: ${s.rejection_reason}` : `Notiz: ${s.admin_note}`}
                    </div>
                  )}

                  {/* Warnung bei sehr langer ausstehender Session */}
                  {isPending && isLong && (
                    <div className="wt-card__warn-hint">
                      Möglicherweise vergessen auszustempeln — wartet auf Admin-Korrektur
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className="ed-section wt-section">
                {loading ? (
                  <div className="wt-loading">Arbeitszeit wird geladen…</div>
                ) : workedError ? (
                  <p className="ed-alert" role="alert">{workedError}</p>
                ) : !workedTime ? (
                  <p className="ed-empty">Keine Arbeitszeit-Daten vorhanden.</p>
                ) : (
                  <>
                    {/* ── Hero-Karte ──────────────────────────────────── */}
                    <div className="wt-hero">
                      <div className="wt-hero__left">
                        <div className="wt-hero__kicker">Offizielle Arbeitszeit (Monat)</div>
                        <div className="wt-hero__value">
                          {formatDurationSeconds(workedTime.official_seconds_month ?? 0)}
                        </div>
                        <div className="wt-hero__sub">Genehmigt &amp; Korrigiert</div>
                      </div>
                      <div className="wt-hero__right">
                        <div className="wt-hero__stat">
                          <div className="wt-hero__stat-val wt-hero__stat-val--amber">
                            {formatDurationSeconds(workedTime.pending_seconds_month ?? 0)}
                          </div>
                          <div className="wt-hero__stat-lbl">Ausstehend — wartet auf Admin</div>
                        </div>
                        <div className="wt-hero__divider" />
                        <div className="wt-hero__stat">
                          <div className={`wt-hero__dot ${workedTime.active ? "wt-hero__dot--active" : "wt-hero__dot--idle"}`}>
                            <span className="wt-hero__dot-pulse" />
                          </div>
                          <div className="wt-hero__stat-lbl">
                            {workedTime.active ? "Eingestempelt" : "Ausgestempelt"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Ausstehende Schichten ───────────────────────── */}
                    {pendingSessions.length > 0 && (
                      <>
                        <div className="wt-section-header wt-section-header--pending">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          Ausstehende Schichten
                          <span className="wt-section-header__count">{pendingSessions.length}</span>
                          <span className="wt-section-header__total">
                            · gesamt {formatDurationSeconds(pendingSessions.reduce((a, s) => a + s.duration_seconds, 0))}
                          </span>
                        </div>
                        <div className="wt-cards">
                          {pendingSessions.map(s => <SessionCard key={s.id} s={s} />)}
                        </div>
                      </>
                    )}

                    {/* ── Genehmigte & Korrigierte Schichten ─────────── */}
                    {officialSessions.length > 0 && (
                      <>
                        <div className="wt-section-header wt-section-header--official">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          Genehmigte &amp; Korrigierte Schichten
                          <span className="wt-section-header__count">{officialSessions.length}</span>
                        </div>
                        <div className="wt-cards">
                          {officialSessions.map(s => <SessionCard key={s.id} s={s} />)}
                        </div>
                      </>
                    )}

                    {/* ── Abgelehnte Schichten ────────────────────────── */}
                    {rejectedSessions.length > 0 && (
                      <>
                        <div className="wt-section-header wt-section-header--rejected">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                          Abgelehnte Schichten
                          <span className="wt-section-header__count">{rejectedSessions.length}</span>
                        </div>
                        <div className="wt-cards">
                          {rejectedSessions.map(s => <SessionCard key={s.id} s={s} />)}
                        </div>
                      </>
                    )}

                    {/* ── Leer-Zustand ────────────────────────────────── */}
                    {mySessions.length === 0 && !sessionsLoading && (
                      <div className="wt-empty">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>Noch keine Schichten vorhanden.</span>
                      </div>
                    )}

                    <p className="wt-footnote">
                      Offizielle Arbeitszeit = genehmigt + korrigiert · Ausstehend = wartet auf Admin-Entscheidung
                    </p>
                  </>
                )}
              </div>
            );
          })()}

          {/* ═══ MEINE SCHICHTEN ═════════════════════════════════════════ */}
          {activeTab === "shifts" && (
            <div className="ed-section">
              <div className="ed-section-title"><h2>Meine Schichten</h2></div>
              <div className="ed-card">
                <p className="ed-hint">Deine nächsten geplanten Schichten (ab heute).</p>

                {shiftsLoading ? (
                  <p className="ed-hint">Schichten werden geladen…</p>
                ) : shiftsError ? (
                  <p className="ed-alert" role="alert">{shiftsError}</p>
                ) : myShifts.length === 0 ? (
                  <div className="ed-empty-state">
                    <span className="ed-empty-state__icon">📅</span>
                    <p className="ed-empty-state__text">Keine Schichten geplant.</p>
                    <p className="ed-hint" style={{ textAlign: "center" }}>
                      Dein Admin hat noch keine Schichten für dich eingetragen.
                    </p>
                  </div>
                ) : (
                  <ul className="ed-shifts-list">
                    {myShifts.map((shift) => {
                      const isToday = shift.shift_date === new Date().toISOString().slice(0, 10);
                      const dateLabel = new Date(shift.shift_date + "T00:00:00").toLocaleDateString("de-DE", {
                        weekday: "long", day: "2-digit", month: "long",
                      });
                      return (
                        <li key={shift.id}
                          className={`ed-shift-card${isToday ? " ed-shift-card--today" : ""}`}>
                          <div className="ed-shift-card__date">
                            {isToday && (
                              <span className="ed-badge ed-badge--green ed-shift-card__today-badge">
                                Heute
                              </span>
                            )}
                            <span className="ed-shift-card__datetext">{dateLabel}</span>
                          </div>
                          <div className="ed-shift-card__body">
                            <span className="ed-shift-card__time">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" width="14" height="14">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                              </svg>
                              {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} Uhr
                              {shift.end_time.slice(0, 5) < shift.start_time.slice(0, 5) && (
                                <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", fontWeight: 700, color: "#7c3aed", background: "#ede9fe", borderRadius: "4px", padding: "1px 5px" }}>Nacht</span>
                              )}
                            </span>
                            {shift.location_name && (
                              <span className="ed-shift-card__loc">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                  strokeWidth="2" width="14" height="14">
                                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                                  <circle cx="12" cy="10" r="3"/>
                                </svg>
                                {shift.location_name}
                              </span>
                            )}
                            {shift.note && (
                              <span className="ed-shift-card__note">{shift.note}</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ═══ URLAUB ════════════════════════════════════════════════════ */}
          {activeTab === "leave" && (
            <div className="ed-section">
              <div className="ed-section-title"><h2>Urlaub</h2></div>
              <div className="ed-card" style={{ marginBottom: "1rem" }}>
                <p className="ed-hint">
                  Stelle einen Urlaubs- oder Abwesenheitswunsch. Dein Admin kann den Antrag unter
                  „Urlaubanträge“ annehmen oder ablehnen.
                </p>
                {leaveSummary && !leaveSummaryLoading && !leaveSummaryError && (
                  <p className="ed-hint" style={{ marginTop: "0.5rem" }}>
                    <strong>{new Date().getFullYear()}:</strong> noch buchbar <strong>{leaveSummary.available_days}</strong> Tage
                    (Soll {leaveSummary.annual_leave_days}, genommen {leaveSummary.used_days_this_year}, Rest{" "}
                    {leaveSummary.remaining_days}
                    {leaveSummary.pending_days_this_year > 0
                      ? `, ausstehend reserviert ${leaveSummary.pending_days_this_year}`
                      : ""}
                    ).
                  </p>
                )}
                <form className="ed-leave-form" onSubmit={handleLeaveSubmit}>
                  <div className="ed-leave-form__row">
                    <label>
                      <span>Von *</span>
                      <input
                        type="date"
                        value={leaveStart}
                        onChange={(e) => setLeaveStart(e.target.value)}
                        disabled={leaveFormBusy}
                        required
                      />
                    </label>
                    <label>
                      <span>Bis *</span>
                      <input
                        type="date"
                        value={leaveEnd}
                        onChange={(e) => setLeaveEnd(e.target.value)}
                        disabled={leaveFormBusy}
                        required
                      />
                    </label>
                  </div>
                  <label className="ed-leave-form__full">
                    <span>Notiz (optional)</span>
                    <textarea
                      className="ed-textarea"
                      rows={2}
                      value={leaveNote}
                      onChange={(e) => setLeaveNote(e.target.value)}
                      disabled={leaveFormBusy}
                      placeholder="z. B. Familienfeier, Umzug …"
                    />
                  </label>
                  {leaveFormError && <p className="ed-alert" role="alert">{leaveFormError}</p>}
                  {leaveFormSuccess && <p className="ed-success" role="status">{leaveFormSuccess}</p>}
                  <button type="submit" className="ed-btn ed-btn--primary" disabled={leaveFormBusy}>
                    {leaveFormBusy ? "Wird gesendet…" : "Antrag einreichen"}
                  </button>
                </form>
              </div>
              <div className="ed-card">
                <h3 className="ed-card__subtitle">Meine Anträge</h3>
                {leaveListLoading ? (
                  <p className="ed-hint">Lädt…</p>
                ) : leaveListError ? (
                  <p className="ed-alert" role="alert">{leaveListError}</p>
                ) : myLeaveRequests.length === 0 ? (
                  <p className="ed-empty">Noch keine Anträge.</p>
                ) : (
                  <div className="ed-table-wrap">
                    <table className="ed-table">
                      <thead>
                        <tr>
                          <th>Von</th>
                          <th>Bis</th>
                          <th>Status</th>
                          <th>Notiz</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myLeaveRequests.map((r) => (
                          <tr key={r.id}>
                            <td>{new Date(r.start_date + "T12:00:00").toLocaleDateString("de-DE")}</td>
                            <td>{new Date(r.end_date + "T12:00:00").toLocaleDateString("de-DE")}</td>
                            <td><LeaveStatusBadge status={r.status} /></td>
                            <td>{r.note ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ BENACHRICHTIGUNGEN ══════════════════════════════════════ */}
          {activeTab === "notifications" && (
            <div className="ed-section">
              <div className="ed-notifications-page">
                <div className="ed-notifications-page__header">
                  <div>
                    <h2 className="ed-notifications-page__title">{t("notifications.title")}</h2>
                    <p className="ed-hint">{t("notifications.sub")}</p>
                  </div>
                  <div className="ed-notifications-page__actions">
                    {notif.unreadCount > 0 && (
                      <button type="button" className="ed-notif-mark-all" onClick={notif.markAllRead}>
                        {t("common.markAllRead")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="wt-refresh-btn"
                      onClick={notif.openList}
                      disabled={notif.listLoading}
                    >
                      {notif.listLoading ? t("common.loading") : t("common.refresh")}
                    </button>
                  </div>
                </div>

                {notif.listLoading && notif.notifications.length === 0 ? (
                  <div className="ed-notif-empty ed-notifications-page__empty">{t("common.loading")}</div>
                ) : notif.notifications.length === 0 ? (
                  <div className="ed-notifications-page__empty">
                    <IcoBell />
                    <p>{t("notifications.empty")}</p>
                    <span className="ed-hint">{t("notifications.emptyHint")}</span>
                  </div>
                ) : (
                  <div className="ed-notifications-page__list">
                    {notif.notifications.map((n) => (
                      <button
                        type="button"
                        key={n.id}
                        className={`ed-notifications-page__item${!n.read_at ? " ed-notifications-page__item--unread" : ""}`}
                        onClick={() => {
                          if (!n.read_at) notif.markRead(n.id);
                          const tab = NOTIF_ENTITY_TAB[n.entity_type];
                          if (tab) {
                            setActiveTab(tab);
                            if (n.entity_type === "work_session") setHighlightSessionId(n.entity_id);
                          }
                        }}
                      >
                        <div className="ed-notifications-page__item-main">
                          <span className="ed-notifications-page__item-category">{notifCategory(n.type, t)}</span>
                          <span className="ed-notifications-page__item-title">{n.title}</span>
                          {notifBodyLines(n.body).map((line) => (
                            <span key={line} className="ed-notifications-page__item-body">{line}</span>
                          ))}
                          <span className="ed-notifications-page__item-meta">
                            {formatNotifRelativeTime(n.created_at, locale)}
                          </span>
                        </div>
                        {!n.read_at && <span className="ed-notifications-page__dot" aria-hidden />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ ATTENDANCE LOG ══════════════════════════════════════════ */}
          {activeTab === "logs" && (
            <div className="ed-section">
              <div className="ed-section-title"><h2>Stempelprotokoll</h2></div>
              <div className="ed-card">
                <p className="ed-hint">Deine letzten 20 Stempelungen, neueste zuerst.</p>

                {logsLoading ? (
                  <p className="ed-hint">Logs werden geladen…</p>
                ) : logsError ? (
                  <p className="ed-alert" role="alert">{logsError}</p>
                ) : logs.length === 0 ? (
                  <div className="ed-empty-state">
                    <span className="ed-empty-state__icon">🕐</span>
                    <p className="ed-empty-state__text">Noch keine Stempelungen vorhanden.</p>
                    <p className="ed-hint" style={{ textAlign: "center" }}>
                      Stemple auf dem Dashboard ein, um deine erste Stempelung zu machen.
                    </p>
                  </div>
                ) : (
                  <div className="ed-table-wrap">
                    <table className="ed-table">
                      <thead>
                        <tr>
                          <th scope="col">ID</th>
                          <th scope="col">Typ</th>
                          <th scope="col">Breitengrad</th>
                          <th scope="col">Längengrad</th>
                          <th scope="col">Zeit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((row) => (
                          <tr key={row.id}>
                            <td>{row.id}</td>
                            <td>
                              <span className={`ed-pill ed-pill--${normalizeTypeKey(row.type)}`}>
                                {formatTypeLabel(row.type)}
                              </span>
                            </td>
                            <td>{row.lat}</td>
                            <td>{row.lng}</td>
                            <td>{formatLogTime(row.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}


        </div>
      </div>

      {/* ═══ MOBILE BOTTOM NAV ════════════════════════════════════════════ */}
      <nav className="ed-mobile-nav" aria-label="Mobile Navigation">
        {[
          { id: "overview", label: t("desktop.navCompact.home"), Icon: IcoHome },
          { id: "worked", label: t("desktop.navCompact.worked"), Icon: IcoWorked },
          { id: "leave", label: t("desktop.navCompact.leave"), Icon: IcoVacation },
          { id: "notifications", label: t("desktop.navCompact.messages"), Icon: IcoBell },
          { id: "logs", label: t("desktop.navCompact.logs"), Icon: IcoLogs },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={[
              "ed-mobile-nav__item",
              activeTab === id ? "ed-mobile-nav__item--active" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => setActiveTab(id)}
          >
            <span className="ed-mobile-nav__icon"><Icon /></span>
            <span className="ed-mobile-nav__label">{label}</span>
          </button>
        ))}
      </nav>

    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────
function formatLogTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return Number.isNaN(d.getTime()) ? isoString : d.toLocaleString("de-DE");
}

function formatDurationSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h} h : ${String(m).padStart(2, "0")} m : ${String(sec).padStart(2, "0")} s`;
}

function normalizeTypeKey(type) {
  const t = String(type || "").toLowerCase();
  if (t === "checkin" || t === "checkout") return t;
  return "other";
}

function formatTypeLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "checkin")  return "Einstempeln";
  if (t === "checkout") return "Ausstempeln";
  return type || "—";
}

function LeaveStatusBadge({ status }) {
  const s = (status || "").toLowerCase();
  if (s === "approved") return <span className="ed-badge ed-badge--green">Genehmigt</span>;
  if (s === "rejected") return <span className="ed-badge ed-badge--red">Abgelehnt</span>;
  return <span className="ed-badge ed-badge--orange">Ausstehend</span>;
}

function SessionStatusBadge({ status }) {
  const map = {
    pending:   ["ed-badge--yellow", "Ausstehend"],
    approved:  ["ed-badge--green",  "Genehmigt"],
    rejected:  ["ed-badge--red",    "Abgelehnt"],
    corrected: ["ed-badge--blue",   "Korrigiert"],
  };
  const [cls, label] = map[status] ?? ["ed-badge--gray", status];
  return <span className={`ed-badge ${cls}`}>{label}</span>;
}
