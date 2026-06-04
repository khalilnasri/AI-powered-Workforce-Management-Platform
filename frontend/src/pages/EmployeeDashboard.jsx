import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient, clearToken } from "../apiClient";
import "./EmployeeDashboard.css";

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
const IcoSessions = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
const IcoAI = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
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

/** Zeitpunkt des Einstempelns der offenen Besuchssession (für Live-Zähler). */
function getOpenSessionCheckinIso(workedTime) {
  if (!workedTime?.active || !Array.isArray(workedTime.sessions)) return null;
  const open = [...workedTime.sessions].reverse().find((s) => !s.checkout);
  return open?.checkin ?? null;
}

function resolveActiveCheckinIso(workedTime, logs, checkedIn) {
  const fromWorked = getOpenSessionCheckinIso(workedTime);
  if (fromWorked) return fromWorked;
  if (checkedIn && logs?.[0] && String(logs[0].type ?? "").toLowerCase() === "checkin") {
    return logs[0].created_at;
  }
  return null;
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

// ── Nav config ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "overview", label: "Dashboard",       Icon: IcoHome     },
  { id: "checkin",  label: "Stempeln & GPS",  Icon: IcoCheckin  },
  { id: "worked",   label: "Arbeitszeit",     Icon: IcoWorked   },
  { id: "shifts",   label: "Meine Schichten", Icon: IcoShifts   },
  { id: "leave",    label: "Urlaub",          Icon: IcoVacation },
  { id: "sessions", label: "Meine Sessions",  Icon: IcoSessions },
  { id: "logs",     label: "Stempelprotokoll", Icon: IcoLogs     },
  { id: "ai",       label: "KI-Assistent",    Icon: IcoAI       },
];

// ── Main Component ────────────────────────────────────────────────────────────
export function EmployeeDashboard() {
  const navigate = useNavigate();

  // ── Tab state (Standard: Dashboard mit Kalender & Schnellaktionen) ───────
  const [activeTab, setActiveTab] = useState("overview");
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

  // ── AI Chat ───────────────────────────────────────────────────────────────
  // Jede Nachricht: { role: "user"|"assistant", content: string, sources: [] }
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput,    setAiInput]    = useState("");
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState(null);
  const chatBottomRef = useRef(null);

  // ── API fetchers ──────────────────────────────────────────────────────────
  const fetchAttendanceStatus = useCallback(() => {
    setStatusLoading(true);
    setStatusError(null);
    return apiClient
      .get(STATUS_URL)
      .then((res) => { setAttendanceStatus(res.data); })
      .catch(() => { setAttendanceStatus(null); setStatusError("Stempelstatus konnte nicht geladen werden."); })
      .finally(() => { setStatusLoading(false); });
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
    if (activeTab === "sessions") fetchMySessions();
  }, [activeTab, fetchMySessions]);

  useEffect(() => {
    if (activeTab === "leave" || activeTab === "overview") fetchMyLeaveRequests();
  }, [activeTab, fetchMyLeaveRequests]);

  // Automatisch zum Ende des Chats scrollen wenn neue Nachricht kommt
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages, aiLoading]);

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

  // ── AI Chat Handler ───────────────────────────────────────────────────────
  async function handleAiAsk(e) {
    e.preventDefault();
    const question = aiInput.trim();
    if (!question || aiLoading) return;

    // Nutzernachricht sofort anzeigen
    setAiMessages((prev) => [...prev, { role: "user", content: question, sources: [] }]);
    setAiInput("");
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await apiClient.post("/ai/ask", { question });
      setAiMessages((prev) => [
        ...prev,
        {
          role:    "assistant",
          content: res.data.answer ?? "Keine Antwort erhalten.",
          sources: res.data.sources ?? [],
        },
      ]);
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      let msg = "Fehler beim Abrufen der Antwort. Bitte versuche es erneut.";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        // Pydantic validation error: [{msg: "...", loc: [...], ...}]
        msg = detail[0].msg ?? msg;
      }
      setAiMessages((prev) => [
        ...prev,
        { role: "assistant", content: msg, sources: [], isError: true },
      ]);
    } finally {
      setAiLoading(false);
    }
  }

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
            return fetchAttendanceLogs()
              .then(() => fetchAttendanceStatus())
              .then(() => fetchWorkedTime())
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
    const today = new Date().toISOString().slice(0, 10);
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
    () => resolveActiveCheckinIso(workedTime, logs, isCheckedIn),
    [workedTime, logs, isCheckedIn],
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

  const activeLabel   = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? "Dashboard";
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
          {NAV_ITEMS.map(({ id, label, Icon }) => (
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
          <div className="ed-topbar__user">
            <div className="ed-topbar__avatar">{data.name?.[0]?.toUpperCase() ?? "?"}</div>
            <div className="ed-topbar__user-info">
              <span className="ed-topbar__user-name">{data.name}</span>
              <span className="ed-topbar__user-role">{formatRoleDe(data.role)}</span>
            </div>
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
                      ? `${(workedTime.official_hours_month ?? workedTime.official_hours ?? 0)
                          .toFixed(1)
                          .replace(/\.0$/, "")} h`
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
                        Stempeln mit Browser-Standort. Details unter{" "}
                        <button type="button" className="ed-inline-link" onClick={() => setActiveTab("checkin")}>
                          Stempeln &amp; GPS
                        </button>
                        .
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
                                <span className="ed-live-shift__cap">Std.</span>
                              </span>
                              <span className="ed-live-shift__colon" aria-hidden>:</span>
                              <span className="ed-live-shift__unit">
                                <span className="ed-live-shift__num">{pad2(liveShiftParts.m)}</span>
                                <span className="ed-live-shift__cap">Min.</span>
                              </span>
                              <span className="ed-live-shift__colon" aria-hidden>:</span>
                              <span className="ed-live-shift__unit">
                                <span className="ed-live-shift__num">{pad2(liveShiftParts.s)}</span>
                                <span className="ed-live-shift__cap">Sek.</span>
                              </span>
                            </div>
                            <p className="ed-live-shift__hint">
                              Zum Beenden: <strong>Ausstempeln</strong> (Button oben).
                            </p>
                          </>
                        )}
                        {!isCheckedIn && (
                          <p className="ed-hint ed-live-shift__idle">
                            Keine laufende Schicht. Nach <strong>Einstempeln</strong> erscheint hier die Live-Zeit
                            (Std. · Min. · Sek.).
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
                                <strong>{monthHoursRemain.target} h</strong>
                              </div>
                              <div className="ed-overview__month-budget-row">
                                <span>Offiziell (Monat)</span>
                                <strong className="ed-overview__month-budget-done">
                                  {monthHoursRemain.done.toFixed(1).replace(/\.0$/, "")} h
                                </strong>
                              </div>
                              {monthHoursRemain.pend > 0 && (
                                <div className="ed-overview__month-budget-row ed-overview__month-budget-row--muted">
                                  <span>Davon ausstehend</span>
                                  <strong>{monthHoursRemain.pend.toFixed(1).replace(/\.0$/, "")} h</strong>
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
                                    ca. {monthHoursRemain.remain.toFixed(1).replace(/\.0$/, "")} h
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="ed-overview__month-budget-remain-label">Monatssoll</span>
                                  <span className="ed-overview__month-budget-remain-val">
                                    erreicht
                                    {monthHoursRemain.remain < 0
                                      ? ` · +${Math.abs(monthHoursRemain.remain).toFixed(1).replace(/\.0$/, "")} h über Soll`
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
                      <h3 className="ed-overview__quick-title">Arbeitszeit</h3>
                      <p className="ed-hint ed-overview__extra-hint">Offizielle und ausstehende Zeiten.</p>
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
                              {formatDurationSeconds(workedTime.official_seconds ?? 0)}
                            </strong>
                          </div>
                          <div className="ed-overview__worked-row">
                            <span className="ed-overview__worked-label">Ausstehend</span>
                            <strong className="ed-overview__worked-val ed-overview__worked-val--pend">
                              {formatDurationSeconds(workedTime.pending_seconds ?? 0)}
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

          {/* ═══ CHECK-IN / OUT ══════════════════════════════════════════ */}
          {activeTab === "checkin" && (
            <div className="ed-section">
              <div className="ed-section-title"><h2>Stempeln mit GPS</h2></div>
              <div className="ed-dashboard-grid">

                {/* Aktionen */}
                <div className="ed-card ed-card--grow">
                  <p className="ed-hint">
                    Nutzt deinen Browser-Standort. Einstempeln und Ausstempeln wechseln sich ab.
                    Der Server erzwingt diese Reihenfolge.
                  </p>

                  {statusLoading ? (
                    <p className="ed-hint">Status wird geladen…</p>
                  ) : statusError ? (
                    <p className="ed-alert" role="alert">{statusError}</p>
                  ) : attendanceStatus ? (
                    <div className="ed-status-row">
                      <span className={`ed-badge ed-badge--${isCheckedIn ? "green" : "gray"}`}>
                        {isCheckedIn ? "Eingestempelt" : "Ausgestempelt"}
                      </span>
                      <p className="ed-status-message">{localizeAttendanceMessage(attendanceStatus.message)}</p>
                    </div>
                  ) : null}

                  <div className="ed-actions">
                    {attendanceStatus?.can_checkin && (
                      <button
                        type="button"
                        className="ed-btn ed-btn--checkin"
                        onClick={() => runGpsThenPost(CHECKIN_URL)}
                        disabled={gpsBusy || statusLoading || Boolean(statusError)}
                      >
                        {gpsBusy ? "Standort wird ermittelt…" : "✔ Einstempeln"}
                      </button>
                    )}
                    {attendanceStatus?.can_checkout && (
                      <button
                        type="button"
                        className="ed-btn ed-btn--checkout"
                        onClick={() => runGpsThenPost(CHECKOUT_URL)}
                        disabled={gpsBusy || statusLoading || Boolean(statusError)}
                      >
                        {gpsBusy ? "Standort wird ermittelt…" : "✖ Ausstempeln"}
                      </button>
                    )}
                  </div>

                  {attendanceError && (
                    <p className="ed-alert" role="alert">{attendanceError}</p>
                  )}
                </div>

                {/* GPS Info */}
                <div className="ed-card ed-card--sidebar">
                  <p className="ed-card-title">GPS-Information</p>
                  {gpsCoords ? (
                    <div className="ed-gps-row">
                      <span className="ed-gps-label">Latitude</span>
                      <span className="ed-gps-value">{gpsCoords.lat}</span>
                      <span className="ed-gps-label">Longitude</span>
                      <span className="ed-gps-value">{gpsCoords.lng}</span>
                    </div>
                  ) : (
                    <p className="ed-no-gps">Noch keine GPS-Daten — zuerst ein- oder ausstempeln.</p>
                  )}

                  {areaStatus === "inside" && (
                    <p className="ed-fence ed-fence--inside" role="status">Im Firmenbereich</p>
                  )}
                  {areaStatus === "outside" && (
                    <p className="ed-fence ed-fence--outside" role="alert">Außerhalb des Firmenbereichs</p>
                  )}
                  {gpsError && (
                    <p className="ed-alert" role="alert">{gpsError}</p>
                  )}
                  {attendanceResponse && (
                    <pre className="ed-pre">{JSON.stringify(attendanceResponse, null, 2)}</pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ WORKED TIME ═════════════════════════════════════════════ */}
          {activeTab === "worked" && (
            <div className="ed-section">
              <div className="ed-section-title"><h2>Arbeitszeit</h2></div>
              <div className="ed-card">
                <p className="ed-hint">
                  Jedes Einstempeln wird mit dem nächsten Ausstempeln gepaart.
                  Ein offenes Einstempeln zählt bis jetzt.
                </p>

                {workedLoading ? (
                  <p className="ed-hint">Arbeitszeit wird geladen…</p>
                ) : workedError ? (
                  <p className="ed-alert" role="alert">{workedError}</p>
                ) : !workedTime ? (
                  <p className="ed-empty">Keine Arbeitszeit-Daten vorhanden.</p>
                ) : (
                  <>
                    <div className="ed-worked-grid">
                      <div className="ed-worked-stat">
                        <span className="ed-worked-stat__value" style={{ color: "#16a34a" }}>
                          {formatDurationSeconds(workedTime.official_seconds ?? 0)}
                        </span>
                        <span className="ed-worked-stat__label">Offizielle Stunden</span>
                      </div>
                      <div className="ed-worked-stat">
                        <span className="ed-worked-stat__value" style={{ color: "#d97706" }}>
                          {formatDurationSeconds(workedTime.pending_seconds ?? 0)}
                        </span>
                        <span className="ed-worked-stat__label">Ausstehend ({workedTime.pending_count ?? 0})</span>
                      </div>
                      <div className="ed-worked-stat">
                        <span className="ed-worked-stat__value">
                          <span className={`ed-badge ed-badge--${workedTime.active ? "green" : "gray"}`}>
                            {workedTime.active ? "Aktiv" : "Inaktiv"}
                          </span>
                        </span>
                        <span className="ed-worked-stat__label">Stempelung</span>
                      </div>
                    </div>
                    <p className="ed-hint" style={{ marginTop: "0.5rem", marginBottom: "1rem" }}>
                      Offizielle Stunden = genehmigt + korrigiert. Ausstehende warten auf Admin-Genehmigung.
                    </p>

                    {workedTime.sessions.length === 0 ? (
                      <p className="ed-empty">Noch keine abgeschlossenen oder offenen Sessions.</p>
                    ) : (
                      <>
                        <div className="ed-sessions__header">
                          <span>Status</span>
                          <span>Eingestempelt</span>
                          <span>Ausgestempelt</span>
                          <span>Dauer</span>
                        </div>
                        <ul className="ed-sessions">
                          {workedTime.sessions.map((session, idx) => (
                            <li key={`${session.checkin}-${idx}`}>
                              <span className="ed-session-type">
                                {session.checkout ? "Abgeschlossen" : "Aktiv"}
                              </span>
                              <span className="ed-session-time">{formatLogTime(session.checkin)}</span>
                              <span className="ed-session-time">
                                {session.checkout ? formatLogTime(session.checkout) : "— (noch aktiv)"}
                              </span>
                              <span className="ed-session-duration">
                                {formatDurationSeconds(session.duration_seconds)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

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

          {/* ═══ MEINE SESSIONS ══════════════════════════════════════════ */}
          {activeTab === "sessions" && (
            <div className="ed-section">
              <div className="ed-section-title">
                <h2>Meine Sessions</h2>
                <button type="button" className="ed-btn ed-btn--ghost ed-btn--sm"
                  onClick={fetchMySessions} disabled={sessionsLoading}>
                  {sessionsLoading ? "Lädt…" : "Aktualisieren"}
                </button>
              </div>
              <div className="ed-card">
                <p className="ed-hint">
                  Jede abgeschlossene Schicht wartet auf Admin-Genehmigung.
                  Hier siehst du den aktuellen Status deiner Arbeitszeiten.
                </p>

                {sessionsLoading ? (
                  <p className="ed-hint">Sessions werden geladen…</p>
                ) : sessionsError ? (
                  <p className="ed-alert" role="alert">{sessionsError}</p>
                ) : mySessions.length === 0 ? (
                  <div className="ed-empty-state">
                    <span className="ed-empty-state__icon">✅</span>
                    <p className="ed-empty-state__text">Noch keine Sessions vorhanden.</p>
                    <p className="ed-hint" style={{ textAlign: "center" }}>
                      Nach dem ersten Ausstempeln erscheint deine Session hier.
                    </p>
                  </div>
                ) : (
                  <div className="ed-table-wrap">
                    <table className="ed-table">
                      <thead>
                        <tr>
                          <th scope="col">Eingestempelt</th>
                          <th scope="col">Ausgestempelt</th>
                          <th scope="col">Dauer</th>
                          <th scope="col">Status</th>
                          <th scope="col">Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mySessions.map((s) => (
                          <tr key={s.id}>
                            <td>{formatLogTime(s.checkin_time)}</td>
                            <td>{s.checkout_time ? formatLogTime(s.checkout_time) : <em>offen</em>}</td>
                            <td>{formatDurationSeconds(s.duration_seconds)}</td>
                            <td><SessionStatusBadge status={s.status} /></td>
                            <td>
                              {s.rejection_reason && (
                                <span className="ed-hint" style={{ color: "#b91c1c" }}>
                                  Grund: {s.rejection_reason}
                                </span>
                              )}
                              {s.admin_note && (
                                <span className="ed-hint">Notiz: {s.admin_note}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                      Gehe zu „Stempeln & GPS“, um deine erste Stempelung zu machen.
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

          {/* ═══ AI ASSISTANT ════════════════════════════════════════ */}
          {activeTab === "ai" && (
            <div className="ed-section">
              <div className="ed-section-title">
                <h2>KI-Empfangsassistent</h2>
                {aiMessages.length > 0 && (
                  <button
                    type="button"
                    className="ed-btn ed-btn--ghost ed-btn--sm"
                    onClick={() => { setAiMessages([]); setAiError(null); }}
                  >
                    Chat leeren
                  </button>
                )}
              </div>

              <div className="ed-card ed-chat-card">
                <p className="ed-chat-hint">
                  🤖 Stelle Fragen zu deinen Reception-Dokumenten.
                  Die KI antwortet nur auf Basis der hinterlegten Hotel-SOPs.
                </p>

                {/* ── Nachrichtenverlauf ── */}
                <div className="ed-chat-messages">
                  {aiMessages.length === 0 && (
                    <div className="ed-chat-empty">
                      <span>💬</span>
                      <p>Noch keine Fragen gestellt.</p>
                      <p className="ed-chat-empty-hint">
                        Beispiel: „Wie erfasse ich eine Ankunft in Opera?"
                      </p>
                    </div>
                  )}

                  {aiMessages.map((msg, i) => (
                    <div key={i} className={`ed-chat-msg ed-chat-msg--${msg.role}`}>
                      {/* Avatar links (Assistent) */}
                      {msg.role === "assistant" && (
                        <div className="ed-chat-avatar">🤖</div>
                      )}

                      {/* Bubble */}
                      <div className={`ed-chat-bubble${msg.isError ? " ed-chat-bubble--error" : ""}`}>
                        <div className="ed-chat-text">
                          <MdText text={msg.content} />
                        </div>

                        {/* Quellen */}
                        {msg.sources?.length > 0 && (
                          <div className="ed-chat-sources">
                            {/* Deduplizieren: gleiche Seite nur einmal */}
                            {msg.sources
                              .filter((s, idx, arr) =>
                                arr.findIndex((x) => x.document === s.document && x.page === s.page) === idx
                              )
                              .map((s, si) => (
                                <span key={si} className="ed-chat-source">
                                  📄 {s.document.replace("_reception_sop.pdf", "").replace(/_/g, " ")} · S. {s.page}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>

                      {/* Avatar rechts (User) */}
                      {msg.role === "user" && (
                        <div className="ed-chat-avatar ed-chat-avatar--user">
                          {data.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Lade-Indikator */}
                  {aiLoading && (
                    <div className="ed-chat-msg ed-chat-msg--assistant">
                      <div className="ed-chat-avatar">🤖</div>
                      <div className="ed-chat-bubble ed-chat-bubble--loading">
                        <span className="ed-chat-dots">
                          <span /><span /><span />
                        </span>
                        Antwort wird gesucht…
                      </div>
                    </div>
                  )}

                  {/* Scroll-Anker */}
                  <div ref={chatBottomRef} />
                </div>

                {/* ── Eingabebereich ── */}
                <form className="ed-chat-form" onSubmit={handleAiAsk}>
                  <textarea
                    className="ed-chat-input"
                    placeholder='z. B. „Wie stelle ich in Opera eine Rechnung aus?"'
                    value={aiInput}
                    rows={2}
                    disabled={aiLoading}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter allein = Absenden, Shift+Enter = neue Zeile
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAiAsk(e);
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="ed-chat-send"
                    disabled={aiLoading || !aiInput.trim()}
                  >
                    {aiLoading ? "…" : "Fragen →"}
                  </button>
                </form>
              </div>
            </div>
          )}

        </div>
      </div>
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
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
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
