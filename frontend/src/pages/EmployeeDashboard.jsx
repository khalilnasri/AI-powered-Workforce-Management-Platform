import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
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

const GEOFENCE_MESSAGE = "Outside allowed company area";

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

// ── Nav config ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "checkin",  label: "Check-in / Out",  Icon: IcoCheckin  },
  { id: "worked",   label: "Worked Time",     Icon: IcoWorked   },
  { id: "shifts",   label: "Meine Schichten", Icon: IcoShifts   },
  { id: "sessions", label: "Meine Sessions",  Icon: IcoSessions },
  { id: "logs",     label: "Attendance Log",  Icon: IcoLogs     },
  { id: "ai",       label: "AI Assistant",    Icon: IcoAI       },
];

// ── Main Component ────────────────────────────────────────────────────────────
export function EmployeeDashboard() {
  const navigate = useNavigate();

  // ── Tab state (default: Check-in / Out) ───────────────────────────────────
  const [activeTab, setActiveTab] = useState("checkin");

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
      .catch(() => { setAttendanceStatus(null); setStatusError("Attendance-Status konnte nicht geladen werden."); })
      .finally(() => { setStatusLoading(false); });
  }, []);

  const fetchAttendanceLogs = useCallback(() => {
    setLogsLoading(true);
    setLogsError(null);
    return apiClient
      .get(LOGS_URL)
      .then((res) => { setLogs(res.data); })
      .catch(() => { setLogsError("Attendance-Logs konnten nicht geladen werden."); })
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

  useEffect(() => { fetchAttendanceLogs();   }, [fetchAttendanceLogs]);
  useEffect(() => { fetchAttendanceStatus(); }, [fetchAttendanceStatus]);
  useEffect(() => { fetchWorkedTime();       }, [fetchWorkedTime]);

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
              .then(() => fetchWorkedTime());
          })
          .catch((err) => {
            if (
              axios.isAxiosError(err) &&
              err.response?.data?.status === "error" &&
              typeof err.response.data.message === "string"
            ) {
              const msg = err.response.data.message;
              setAttendanceError(msg);
              setAreaStatus(msg === GEOFENCE_MESSAGE ? "outside" : null);
              return;
            }
            setAttendanceError("Attendance konnte nicht an den Server gesendet werden.");
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

  const isCheckedIn   = attendanceStatus?.status === "checked_in";
  const activeLabel   = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? "Dashboard";

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
              <span className="ed-topbar__user-role">{data.role}</span>
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="ed-content">

          {/* Stats cards — immer sichtbar */}
          <div className="ed-stats-grid">
            <div className={`ed-stat-card ed-stat-card--${isCheckedIn ? "green" : "blue"}`}>
              <div className="ed-stat-card__icon">{isCheckedIn ? "🟢" : "⏸"}</div>
              <div className="ed-stat-card__body">
                <div className="ed-stat-card__value">{isCheckedIn ? "Checked In" : "Checked Out"}</div>
                <div className="ed-stat-card__label">Status</div>
              </div>
            </div>
            <div className="ed-stat-card ed-stat-card--green">
              <div className="ed-stat-card__icon">✅</div>
              <div className="ed-stat-card__body">
                <div className="ed-stat-card__value">
                  {workedLoading ? "…" : workedTime ? `${workedTime.official_hours?.toFixed(1) ?? "0.0"} h` : "—"}
                </div>
                <div className="ed-stat-card__label">Offizielle Stunden</div>
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
          </div>

          {/* ═══ CHECK-IN / OUT ══════════════════════════════════════════ */}
          {activeTab === "checkin" && (
            <div className="ed-section">
              <div className="ed-section-title"><h2>Attendance mit GPS</h2></div>
              <div className="ed-dashboard-grid">

                {/* Aktionen */}
                <div className="ed-card ed-card--grow">
                  <p className="ed-hint">
                    Nutzt deinen Browser-Standort. Check-in und Check-out wechseln sich ab.
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
                      <p className="ed-status-message">{attendanceStatus.message}</p>
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
                        {gpsBusy ? "Standort wird ermittelt…" : "✔ Check In"}
                      </button>
                    )}
                    {attendanceStatus?.can_checkout && (
                      <button
                        type="button"
                        className="ed-btn ed-btn--checkout"
                        onClick={() => runGpsThenPost(CHECKOUT_URL)}
                        disabled={gpsBusy || statusLoading || Boolean(statusError)}
                      >
                        {gpsBusy ? "Standort wird ermittelt…" : "✖ Check Out"}
                      </button>
                    )}
                  </div>

                  {attendanceError && (
                    <p className="ed-alert" role="alert">{attendanceError}</p>
                  )}
                </div>

                {/* GPS Info */}
                <div className="ed-card ed-card--sidebar">
                  <p className="ed-card-title">GPS Info</p>
                  {gpsCoords ? (
                    <div className="ed-gps-row">
                      <span className="ed-gps-label">Latitude</span>
                      <span className="ed-gps-value">{gpsCoords.lat}</span>
                      <span className="ed-gps-label">Longitude</span>
                      <span className="ed-gps-value">{gpsCoords.lng}</span>
                    </div>
                  ) : (
                    <p className="ed-no-gps">Noch keine GPS-Daten — drücke Check In oder Check Out.</p>
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
                  Jeder Check-in wird mit dem nächsten Check-out gepaart.
                  Ein offener Check-in zählt bis jetzt.
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
                        <span className="ed-worked-stat__label">Uhr</span>
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
                          <span>Check-in</span>
                          <span>Check-out</span>
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
                      Nach dem ersten Check-out erscheint deine Session hier.
                    </p>
                  </div>
                ) : (
                  <div className="ed-table-wrap">
                    <table className="ed-table">
                      <thead>
                        <tr>
                          <th scope="col">Check-in</th>
                          <th scope="col">Check-out</th>
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
              <div className="ed-section-title"><h2>Attendance Log</h2></div>
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
                      Gehe zu „Check-in / Out" um deine erste Stempelung zu machen.
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
                <h2>AI Reception Assistant</h2>
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
                        Beispiel: „Wie mache ich einen Check-in in Opera?"
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
  if (t === "checkin")  return "Check-in";
  if (t === "checkout") return "Check-out";
  return type || "—";
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
