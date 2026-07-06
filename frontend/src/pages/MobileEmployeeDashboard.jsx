import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { apiClient, clearToken } from "../apiClient";
import "./MobileEmployeeDashboard.css";
import "./MobileArbeitszeit.css";

// ── Icons ──────────────────────────────────────────────────────────────────────
const IcoMenu = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const IcoBell = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);
const IcoDashboard = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
    <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
  </svg>
);
const IcoClock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IcoChart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const IcoPerson = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const IcoLocation = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
);
const IcoXCircle = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);
const IcoArrowLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);
const IcoLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IcoAdmin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
);
// Schicht + Urlaub kombiniert: Kalender mit Haken (Schicht) und Sonne (Urlaub)
const IcoPlanung = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
    {/* checkmark = Schicht links */}
    <polyline points="5.5 16.5 7.5 18.5 11 13.5" strokeWidth="2.2"/>
    {/* sun = Urlaub rechts */}
    <circle cx="16.5" cy="16" r="1.7"/>
    <line x1="16.5" y1="12.5" x2="16.5" y2="13.3"/>
    <line x1="16.5" y1="18.7" x2="16.5" y2="19.5"/>
    <line x1="13.3" y1="16" x2="14.1" y2="16"/>
    <line x1="18.9" y1="16" x2="19.7" y2="16"/>
    <line x1="14.3" y1="13.8" x2="14.9" y2="14.4"/>
    <line x1="18.1" y1="17.6" x2="18.7" y2="18.2"/>
    <line x1="14.3" y1="18.2" x2="14.9" y2="17.6"/>
    <line x1="18.1" y1="14.4" x2="18.7" y2="13.8"/>
  </svg>
);

const IcoHome = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const IcoEnter = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
    <polyline points="10 17 15 12 10 7"/>
    <line x1="15" y1="12" x2="3" y2="12"/>
  </svg>
);
const IcoStop = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="2.5"/>
  </svg>
);

// ── Leaflet custom marker (avoids default icon issues) ─────────────────────────
function makeIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// Re-center map reactively
function MapFly({ lat, lng }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], 16, { animate: true }); }, [lat, lng, map]);
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h} h : ${String(m).padStart(2, "0")} m : ${String(sec).padStart(2, "0")} s`;
}

function azParseHms(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
}

function AzHms({ seconds, variant = "big" }) {
  const [h, m, s] = azParseHms(seconds);
  return (
    <span className={`az-hms az-hms--${variant}`}>
      <span className="az-hms__n">{h}</span><span className="az-hms__u">h</span>
      {" "}
      <span className="az-hms__n">{String(m).padStart(2, "0")}</span><span className="az-hms__u">m</span>
      {" "}
      <span className="az-hms__n">{String(s).padStart(2, "0")}</span><span className="az-hms__u">s</span>
    </span>
  );
}

function AzShiftCard({ session }) {
  const status = session.status;
  const isCorrected = status === "corrected";
  const isLong      = session.duration_seconds > 12 * 3600;

  const fmtT = (iso) => iso
    ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : "—";
  const fmtD = (iso) => iso
    ? new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : "—";

  const chipLabel = { pending: "Ausstehend", approved: "Genehmigt", corrected: "Korrigiert", rejected: "Abgelehnt" }[status] ?? status;

  return (
    <div className={`az-card az-card--${status}`}>
      <div className="az-card__inner">
        {/* top row */}
        <div className="az-card__top">
          <span className="az-card__date">{fmtD(session.checkin_time)}</span>
          <span className={`az-card__chip az-card__chip--${status}`}>{chipLabel}</span>
        </div>

        {/* times row */}
        <div className="az-card__times">
          <div className="az-card__time-block">
            <span className="az-card__time-label">Ein</span>
            <span className="az-card__time-val">{fmtT(session.checkin_time)}</span>
          </div>
          <span className="az-card__arrow">→</span>
          <div className="az-card__time-block">
            <span className="az-card__time-label">Aus</span>
            <span className="az-card__time-val">{session.checkout_time ? fmtT(session.checkout_time) : "—"}</span>
          </div>
          <div className="az-card__dur-block">
            <span className="az-card__dur-label">Dauer</span>
            <AzHms seconds={session.duration_seconds} variant={status === "pending" ? "sm" : "neutral"} />
          </div>
        </div>

        {/* original times (corrected only) */}
        {isCorrected && (session.original_checkin_time || session.original_checkout_time) && (
          <div className="az-card__orig">
            <strong>Original:</strong>{" "}
            <span className="az-card__orig-times">
              {fmtD(session.original_checkin_time)}{" "}
              {fmtT(session.original_checkin_time)} → {session.original_checkout_time ? fmtT(session.original_checkout_time) : "—"}
            </span>
          </div>
        )}

        {/* admin note */}
        {session.admin_note && (
          <div className="az-card__note">{session.admin_note}</div>
        )}
        {session.rejection_reason && (
          <div className="az-card__note az-card__note--red">Grund: {session.rejection_reason}</div>
        )}

        {/* long-session warning */}
        {status === "pending" && isLong && (
          <div className="az-card__warn">
            Möglicherweise vergessen auszustempeln — wartet auf Admin-Korrektur
          </div>
        )}
      </div>
    </div>
  );
}

function fmtClock(secs) {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}


function fmtDayLabel(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

function toLocalIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLatestCheckinIsoFromLogs(logs) {
  if (!Array.isArray(logs) || !logs.length) return null;
  const latest = logs[0];
  if (String(latest?.type ?? "").toLowerCase() === "checkin") {
    return latest.created_at ?? null;
  }
  return null;
}

function resolveLiveSessionStartIso(checkedIn, liveSessionStartAt, status, logs) {
  if (!checkedIn) return null;
  if (liveSessionStartAt) return liveSessionStartAt;
  if (status?.active_checkin_at) return status.active_checkin_at;
  return getLatestCheckinIsoFromLogs(logs);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function MobileEmployeeDashboard() {
  const navigate = useNavigate();

  // Tab
  const [tab, setTab] = useState("dashboard");
  // Overlay: null | "checkin" | "checkout"
  const [overlay, setOverlay] = useState(null);

  // Data
  const [user,         setUser]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [status,       setStatus]       = useState(null);
  const [worked,       setWorked]       = useState(null);
  const [logs,         setLogs]         = useState([]);
  const [leaveSummary, setLeaveSummary] = useState(null);
  const [workplace,    setWorkplace]    = useState(null);
  const [mySessions,   setMySessions]   = useState([]);

  // Planung tab
  const [planungTab,       setPlanungTab]       = useState("schichten");
  const [myShifts,         setMyShifts]         = useState([]);
  const [myLeaveRequests,  setMyLeaveRequests]  = useState([]);
  const [leaveFrom,        setLeaveFrom]        = useState("");
  const [leaveTo,          setLeaveTo]          = useState("");
  const [leaveNote,        setLeaveNote]        = useState("");
  const [leaveSubmitting,  setLeaveSubmitting]  = useState(false);
  const [leaveSuccess,     setLeaveSuccess]     = useState(null);
  const [leaveError,       setLeaveError]       = useState(null);

  // Inline stamp state (big button)
  const [stampBusy,  setStampBusy]  = useState(false);
  const [stampError, setStampError] = useState(null);

  // GPS overlay state (kept for CheckinOverlay component)
  const [gps,       setGps]       = useState(null);
  const [gpsBusy,   setGpsBusy]   = useState(false);
  const [gpsError,  setGpsError]  = useState(null);
  const [apiResult, setApiResult] = useState(null);
  const [apiBusy,   setApiBusy]   = useState(false);
  /** Start der aktuellen Besuchssession — nur per Einstempeln/Ausstempeln ändern. */
  const [liveSessionStartAt, setLiveSessionStartAt] = useState(null);
  const liveSessionHydratedRef = useRef(false);
  const statusFetchSeqRef = useRef(0);

  // Live timer trigger
  const [, tick] = useState(0);

  // ── Fetchers ────────────────────────────────────────────────────────────
  const fetchStatus = useCallback(() => {
    statusFetchSeqRef.current += 1;
    const seq = statusFetchSeqRef.current;
    return apiClient
      .get("/attendance/status")
      .then((r) => {
        if (seq === statusFetchSeqRef.current) setStatus(r.data);
      })
      .catch(() => {});
  }, []);
  const fetchWorked = useCallback(() =>
    apiClient.get("/attendance/worked-time").then(r => setWorked(r.data)).catch(() => {}), []);
  const fetchLogs = useCallback(() =>
    apiClient.get("/attendance/logs").then(r => setLogs(r.data ?? [])).catch(() => {}), []);
  const fetchLeaveSummary = useCallback(() =>
    apiClient.get("/employee/leave-summary").then(r => setLeaveSummary(r.data)).catch(() => {}), []);
  const fetchShifts = useCallback(() =>
    apiClient.get("/planning/my-shifts").then(r => setMyShifts(r.data ?? [])).catch(() => {}), []);
  const fetchLeaveRequests = useCallback(() =>
    apiClient.get("/employee/leave-requests").then(r => setMyLeaveRequests(r.data ?? [])).catch(() => {}), []);
  const fetchMySessions = useCallback(() =>
    apiClient.get("/attendance/my-sessions").then(r => setMySessions(r.data ?? [])).catch(() => {}), []);

  useEffect(() => {
    Promise.all([
      apiClient.get("/auth/me").then(r => setUser(r.data)).catch(() => {}),
      fetchStatus(),
      fetchWorked(),
      fetchLogs(),
      fetchLeaveSummary(),
      fetchShifts(),
      fetchLeaveRequests(),
      fetchMySessions(),
      apiClient.get("/employee/my-location").then(r => setWorkplace(r.data?.location ?? null)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [fetchStatus, fetchWorked, fetchLogs, fetchLeaveSummary, fetchShifts, fetchLeaveRequests, fetchMySessions]);

  useEffect(() => {
    if (liveSessionHydratedRef.current || !status) return;
    liveSessionHydratedRef.current = true;
    if (status.status === "checked_in" && status.active_checkin_at) {
      setLiveSessionStartAt(status.active_checkin_at);
    }
  }, [status]);

  // Live second tick when checked in
  useEffect(() => {
    if (status?.status !== "checked_in") return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [status?.status]);

  // ── Leave request submit ─────────────────────────────────────────────────
  async function handleLeaveSubmit(e) {
    e.preventDefault();
    if (!leaveFrom || !leaveTo) return;
    setLeaveSubmitting(true);
    setLeaveError(null);
    setLeaveSuccess(null);
    try {
      await apiClient.post("/employee/leave-requests", {
        start_date: leaveFrom,
        end_date:   leaveTo,
        note:       leaveNote.trim() || null,
      });
      setLeaveSuccess("Antrag wurde eingereicht!");
      setLeaveFrom("");
      setLeaveTo("");
      setLeaveNote("");
      fetchLeaveRequests();
      fetchLeaveSummary();
    } catch (err) {
      const d = err.response?.data?.detail;
      setLeaveError(typeof d === "string" ? d : "Antrag konnte nicht gesendet werden.");
    } finally {
      setLeaveSubmitting(false);
    }
  }

  // ── Inline stamp (big button) ────────────────────────────────────────────
  async function handleBigButtonClick() {
    if (stampBusy) return;
    setStampBusy(true);
    setStampError(null);

    // 1. GPS holen
    let coords;
    try {
      coords = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error("GPS nicht verfügbar")); return; }
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          err => reject(new Error(err.message || "Standortfehler")),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
      });
    } catch (err) {
      setStampError(err.message);
      setStampBusy(false);
      return;
    }

    // 2. API-Stempel senden
    const isCheckin = !isCheckedIn;
    const url = isCheckin ? "/attendance/checkin" : "/attendance/checkout";
    try {
      const res = await apiClient.post(url, { lat: coords.lat, lng: coords.lng });
      statusFetchSeqRef.current += 1;

      if (isCheckin && res.data?.created_at) {
        const startedAt = res.data.created_at;
        setLiveSessionStartAt(startedAt);
        setStatus(prev => ({
          ...(prev ?? {}),
          status: "checked_in",
          last_type: "checkin",
          can_checkin: false,
          can_checkout: true,
          active_checkin_at: startedAt,
        }));
        setLogs(prev => [{
          id: res.data?.id ?? Date.now(),
          type: "checkin",
          lat: res.data?.lat ?? coords.lat,
          lng: res.data?.lng ?? coords.lng,
          created_at: startedAt,
        }, ...(prev ?? [])]);
      } else if (!isCheckin) {
        setLiveSessionStartAt(null);
        setStatus(prev => ({
          ...(prev ?? {}),
          status: "checked_out",
          last_type: "checkout",
          can_checkin: true,
          can_checkout: false,
          active_checkin_at: null,
        }));
        setLogs(prev => [{
          id: res.data?.id ?? Date.now(),
          type: "checkout",
          lat: res.data?.lat ?? coords.lat,
          lng: res.data?.lng ?? coords.lng,
          created_at: res.data?.created_at ?? new Date().toISOString(),
        }, ...(prev ?? [])]);
      }

      await Promise.all([fetchWorked(), fetchLogs(), fetchMySessions()]);
    } catch (err) {
      const msg = err.response?.data?.message ?? err.response?.data?.detail ?? "Stempelung fehlgeschlagen";
      const isOutside = String(msg).toLowerCase().includes("outside") || String(msg).toLowerCase().includes("außerhalb");
      setStampError(isOutside ? "Außerhalb des erlaubten Bereichs" : String(msg));
    } finally {
      setStampBusy(false);
    }
  }

  // ── Overlay: auto-start GPS ──────────────────────────────────────────────
  useEffect(() => {
    if (!overlay) { setGps(null); setGpsError(null); setApiResult(null); return; }
    if (!navigator.geolocation) { setGpsError("GPS nicht verfügbar"); return; }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsBusy(false); },
      err  => { setGpsBusy(false); setGpsError(err.message || "Standortfehler"); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [overlay]);

  // ── Confirm stamp ────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!gps || apiBusy) return;
    setApiBusy(true);
    const isCheckin = overlay === "checkin";
    const url = isCheckin ? "/attendance/checkin" : "/attendance/checkout";
    try {
      const res = await apiClient.post(url, { lat: gps.lat, lng: gps.lng });
      statusFetchSeqRef.current += 1;

      if (isCheckin && res.data?.created_at) {
        const startedAt = res.data.created_at;
        setLiveSessionStartAt(startedAt);
        setStatus((prev) => ({
          ...(prev ?? {}),
          status: "checked_in",
          last_type: "checkin",
          can_checkin: false,
          can_checkout: true,
          active_checkin_at: startedAt,
        }));
        setLogs((prev) => [
          {
            id: res.data?.id ?? Date.now(),
            type: "checkin",
            lat: res.data?.lat ?? gps.lat,
            lng: res.data?.lng ?? gps.lng,
            created_at: startedAt,
          },
          ...(prev ?? []),
        ]);
      } else if (!isCheckin) {
        setLiveSessionStartAt(null);
        setStatus((prev) => ({
          ...(prev ?? {}),
          status: "checked_out",
          last_type: "checkout",
          can_checkin: true,
          can_checkout: false,
          active_checkin_at: null,
        }));
        setLogs((prev) => [
          {
            id: res.data?.id ?? Date.now(),
            type: "checkout",
            lat: res.data?.lat ?? gps.lat,
            lng: res.data?.lng ?? gps.lng,
            created_at: res.data?.created_at ?? new Date().toISOString(),
          },
          ...(prev ?? []),
        ]);
      }

      setApiResult({ success: true });
      await Promise.all([fetchStatus(), fetchWorked(), fetchLogs()]);
      setTimeout(() => setOverlay(null), 1600);
    } catch (err) {
      const msg = err.response?.data?.message ?? err.response?.data?.detail ?? "Stempelung fehlgeschlagen";
      const isOutside = String(msg).toLowerCase().includes("outside") || String(msg).toLowerCase().includes("außerhalb");
      setApiResult({
        success: false,
        isOutside,
        message: isOutside ? "Außerhalb des erlaubten Arbeitsbereichs" : String(msg),
      });
    } finally {
      setApiBusy(false);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const isCheckedIn = status?.status === "checked_in";
  const todayIso = toLocalIso(new Date().toISOString());
  const todayLabel = new Date().toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

  const todaySessions = useMemo(() => {
    if (!worked?.sessions?.length) return [];
    return worked.sessions.filter(s => toLocalIso(s.checkin) === todayIso);
  }, [worked, todayIso]);

  const openSession = worked?.sessions?.find(s => !s.checkout);
  const todayClosedSecs = todaySessions.filter(s => s.checkout).reduce((a, s) => a + (s.duration_seconds || 0), 0);

  const activeCheckinIso = useMemo(
    () => resolveLiveSessionStartIso(isCheckedIn, liveSessionStartAt, status, logs),
    [isCheckedIn, liveSessionStartAt, status, logs],
  );

  const liveSecs = activeCheckinIso
    ? Math.max(0, Math.floor((Date.now() - new Date(activeCheckinIso).getTime()) / 1000))
    : 0;

  const sessionsByDay = useMemo(() => {
    if (!worked?.sessions?.length) return [];
    const map = {};
    for (const s of worked.sessions) {
      const d = toLocalIso(s.checkin);
      if (!d) continue;
      if (!map[d]) map[d] = [];
      map[d].push(s);
    }
    return Object.entries(map)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, sessions]) => ({ date, sessions }));
  }, [worked]);

  // Sessions mit Genehmigungsstatus (für Verlauf-Tab)
  const sessionsByDayFull = useMemo(() => {
    if (!mySessions.length) return [];
    const map = {};
    for (const s of mySessions) {
      const d = toLocalIso(s.checkin_time);
      if (!d) continue;
      if (!map[d]) map[d] = [];
      map[d].push(s);
    }
    return Object.entries(map)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, sessions]) => ({ date, sessions }));
  }, [mySessions]);

  // ── Guards ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mb-loading">
        <div className="mb-loading__spinner" />
        <span className="mb-loading__text">Wird geladen…</span>
      </div>
    );
  }

  // When checked in: show the CURRENT session's check-in time (not the first of the day)
  const currentCheckinTime = isCheckedIn ? fmtTime(activeCheckinIso) : null;
  const todayCheckinTime   = currentCheckinTime ?? fmtTime(todaySessions[0]?.checkin);
  const todayCheckoutTime  = fmtTime(todaySessions.filter(s => s.checkout).slice(-1)[0]?.checkout);
  const totalSecs = todayClosedSecs + liveSecs;

  const todayLabelUpper = new Date().toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).toUpperCase();
  const firstName = user?.name?.split(" ")[0] ?? "—";
  const lastShiftGroup = sessionsByDay.find(d => d.date !== todayIso);
  const lastShiftSecs  = lastShiftGroup
    ? lastShiftGroup.sessions.reduce((a, s) => a + (s.duration_seconds || 0), 0)
    : null;
  const lastShiftLabel = lastShiftSecs != null
    ? `${Math.floor(lastShiftSecs / 3600)} Std ${Math.floor((lastShiftSecs % 3600) / 60)} Min`
    : null;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mb-shell">

      {/* ─── App Bar ─── */}
      <header className="mb-appbar">
        <button type="button" className="mb-appbar__btn" aria-label="Menü"><IcoMenu /></button>
        <span className="mb-appbar__title">Zeiterfassung</span>
        <button type="button" className="mb-appbar__btn" aria-label="Benachrichtigungen">
          <IcoBell />
          <span className="mb-appbar__dot" aria-hidden="true" />
        </button>
      </header>

      {/* ─── Main content ─── */}
      <main className="mb-main">

        {/* ══ DASHBOARD ══════════════════════════════════════════════════ */}
        {tab === "dashboard" && (
          <>
            {/* Greeting */}
            <div className="mb-greeting-new">
              <p className="mb-greeting-new__date">{todayLabelUpper}</p>
              <h1 className="mb-greeting-new__heading">
                Hallo,<br /><em>{firstName}.</em>
              </h1>
              <p className="mb-greeting-new__sub">Schön, dass du da bist — bereit für deinen Tag.</p>
            </div>

            {/* Timer card */}
            <div className="mb-timer-card">
              <div className="mb-timer-card__header">
                <div className="mb-timer-card__status">
                  <span className={`mb-timer-card__dot${isCheckedIn ? " mb-timer-card__dot--active" : ""}`} />
                  <span className="mb-timer-card__status-label">
                    {isCheckedIn ? "Eingestempelt" : "Ausgestempelt"}
                  </span>
                </div>
                <span className="mb-timer-card__today-label">HEUTE</span>
              </div>

              <div className="mb-timer-card__time">{fmtClock(isCheckedIn ? liveSecs : 0)}</div>
              <p className="mb-timer-card__caption">ARBEITSZEIT · STD : MIN : SEK</p>

              <div className="mb-timer-card__divider" />

              <div className="mb-timer-card__inout">
                <div className="mb-timer-card__col">
                  <span className="mb-timer-card__col-label">Check-In</span>
                  <span className="mb-timer-card__col-value">{todayCheckinTime ?? "—"}</span>
                </div>
                <div className="mb-timer-card__col-sep" />
                <div className="mb-timer-card__col">
                  <span className="mb-timer-card__col-label">Check-Out</span>
                  <span className="mb-timer-card__col-value">{todayCheckoutTime ?? "—"}</span>
                </div>
              </div>
            </div>

            {/* Big action button */}
            <div className="mb-action-area">
              {isCheckedIn && !stampBusy && <div className="mb-pulse-ring" />}
              <button
                type="button"
                className={`mb-big-btn ${isCheckedIn ? "mb-big-btn--dark" : "mb-big-btn--accent"}`}
                onClick={handleBigButtonClick}
                disabled={stampBusy || (isCheckedIn ? !status?.can_checkout : !status?.can_checkin)}
              >
                {stampBusy ? (
                  <>
                    <span className="mb-big-btn__spinner" />
                    <span className="mb-big-btn__label">Standort…</span>
                    <span className="mb-big-btn__sub">WIRD GEPRÜFT</span>
                  </>
                ) : isCheckedIn ? (
                  <>
                    <span className="mb-big-btn__icon"><IcoStop /></span>
                    <span className="mb-big-btn__label">Auschecken</span>
                    <span className="mb-big-btn__sub">LÄUFT GERADE</span>
                  </>
                ) : (
                  <>
                    <span className="mb-big-btn__icon"><IcoEnter /></span>
                    <span className="mb-big-btn__label">Einchecken</span>
                    <span className="mb-big-btn__sub">TIPPEN ZUM START</span>
                  </>
                )}
              </button>

              {stampError && (
                <p className="mb-action-area__error">{stampError}</p>
              )}
              {!isCheckedIn && !stampError && (
                <p className="mb-action-area__hint">
                  {lastShiftLabel ? `Letzte Schicht · ${lastShiftLabel}` : "Letzte Schicht · —"}
                </p>
              )}
            </div>
          </>
        )}

        {/* ══ VERLAUF ════════════════════════════════════════════════════ */}
        {tab === "verlauf" && (
          <div className="mb-verlauf">
            {sessionsByDayFull.length === 0 ? (
              <div className="mb-empty">
                <div className="mb-empty__icon">🕐</div>
                <p className="mb-empty__text">Noch keine Einträge vorhanden.</p>
              </div>
            ) : (
              sessionsByDayFull.map(({ date, sessions }) => {
                const dayTotal = sessions.reduce((acc, s) => {
                  if (s.status === "pending" && s.checkout_time) {
                    const diff = (new Date(s.checkout_time) - new Date(s.checkin_time)) / 1000;
                    return acc + Math.max(0, Math.round(diff));
                  }
                  return acc + (s.duration_seconds || 0);
                }, 0);
                return (
                  <div key={date} className="mb-day-group">
                    <div className="mb-day-group__header">
                      <span className="mb-day-group__date">{fmtDayLabel(date)}</span>
                      {dayTotal > 0 && <span className="mb-day-group__hours">{fmtDuration(dayTotal)}</span>}
                    </div>

                    <div className="mb-session-list">
                      {sessions.map((s) => {
                        const statusMap = {
                          pending:   { label: "Ausstehend", cls: "mb-session-badge--pending"  },
                          approved:  { label: "Genehmigt",  cls: "mb-session-badge--approved" },
                          corrected: { label: "Korrigiert", cls: "mb-session-badge--corrected"},
                          rejected:  { label: "Abgelehnt",  cls: "mb-session-badge--rejected" },
                        };
                        const st = statusMap[s.status] ?? { label: s.status, cls: "" };

                        let displaySecs = s.duration_seconds || 0;
                        if (s.status === "pending" && s.checkout_time) {
                          displaySecs = Math.max(0, Math.round(
                            (new Date(s.checkout_time) - new Date(s.checkin_time)) / 1000
                          ));
                        }

                        return (
                          <div key={s.id} className="mb-session-card">
                            <div className="mb-session-card__head">
                              <div className="mb-session-card__times">
                                <span className="mb-session-card__time-in">
                                  {fmtTime(s.checkin_time) ?? "—"}
                                </span>
                                <span className="mb-session-card__arrow">→</span>
                                <span className="mb-session-card__time-out">
                                  {s.checkout_time
                                    ? fmtTime(s.checkout_time)
                                    : <em className="mb-session-card__active">Aktiv</em>}
                                </span>
                              </div>
                              <span className={`mb-session-badge ${st.cls}`}>{st.label}</span>
                            </div>

                            <div className="mb-session-card__body">
                              {s.checkout_time && (
                                <span className="mb-session-card__dur">
                                  {fmtDuration(displaySecs)}
                                </span>
                              )}
                              {s.status === "corrected" && s.admin_note && (
                                <span className="mb-session-card__note">Hinweis: {s.admin_note}</span>
                              )}
                              {s.status === "rejected" && s.rejection_reason && (
                                <span className="mb-session-card__note mb-session-card__note--reject">
                                  Grund: {s.rejection_reason}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ══ STATISTIK / ARBEITSZEIT ════════════════════════════════════ */}
        {tab === "statistik" && (() => {
          const todayLabel = new Date().toLocaleDateString("de-DE", {
            weekday: "long", day: "numeric", month: "long", year: "numeric",
          }).toUpperCase();

          const pendingSessions  = mySessions.filter(s => s.status === "pending");
          const officialSessions = mySessions.filter(s => s.status === "approved" || s.status === "corrected");
          const rejectedSessions = mySessions.filter(s => s.status === "rejected");

          const pendingTotalSec = pendingSessions.reduce((a, s) => a + (s.duration_seconds || 0), 0);

          const [ph, pm, ps] = azParseHms(pendingTotalSec);
          const pendingTotalStr = `${ph}h ${String(pm).padStart(2,"0")}m ${String(ps).padStart(2,"0")}s`;

          return (
            <div className="az-screen">
              {/* ── Header ───────────────────────────────────────────── */}
              <div className="az-header">
                <div className="az-header__eyebrow">{todayLabel}</div>
                <h2 className="az-header__title">Arbeitszeit</h2>
              </div>

              {/* ── Official dark banner ──────────────────────────────── */}
              <div className="az-banner">
                <div className="az-banner__eyebrow">OFFIZIELLE ARBEITSZEIT · MONAT</div>
                <div className="az-banner__total">
                  <AzHms seconds={worked?.official_seconds_month ?? 0} variant="big" />
                </div>
                <div className="az-banner__sub">Genehmigt &amp; Korrigiert</div>
                <div className="az-banner__divider" />
                <div className="az-banner__footer">
                  <div>
                    <div className="az-banner__pending-label">AUSSTEHEND</div>
                    <AzHms seconds={worked?.pending_seconds_month ?? 0} variant="sm" />
                  </div>
                  <div className="az-banner__caption">wartet auf Admin-Freigabe</div>
                </div>
              </div>

              {/* ── Metric tiles ──────────────────────────────────────── */}
              <div className="az-tiles">
                <div className="az-tile">
                  <div className="az-tile__num">{worked?.pending_count ?? 0}</div>
                  <div className="az-tile__label">AUSSTEHEND</div>
                </div>
                <div className="az-tile">
                  <div className="az-tile__num">{leaveSummary?.remaining_days ?? "—"}</div>
                  <div className="az-tile__label">URLAUB · REST</div>
                </div>
              </div>

              {/* ── Ausstehende Schichten ─────────────────────────────── */}
              {pendingSessions.length > 0 && (
                <div className="az-section">
                  <div className="az-section-header">
                    <span className="az-section-header__dot az-section-header__dot--amber" />
                    <span className="az-section-header__title">Ausstehende Schichten</span>
                    <span className="az-section-header__rule" />
                    <span className="az-section-header__total">{pendingTotalStr}</span>
                  </div>
                  {pendingSessions.map(s => <AzShiftCard key={s.id} session={s} />)}
                </div>
              )}

              {/* ── Genehmigt & Korrigiert ────────────────────────────── */}
              {officialSessions.length > 0 && (
                <div className="az-section">
                  <div className="az-section-header">
                    <span className="az-section-header__dot az-section-header__dot--green" />
                    <span className="az-section-header__title">Genehmigt &amp; Korrigiert</span>
                    <span className="az-section-header__rule" />
                  </div>
                  {officialSessions.map(s => <AzShiftCard key={s.id} session={s} />)}
                </div>
              )}

              {/* ── Abgelehnte Schichten ──────────────────────────────── */}
              {rejectedSessions.length > 0 && (
                <div className="az-section">
                  <div className="az-section-header">
                    <span className="az-section-header__dot" style={{ background: "#DC2626" }} />
                    <span className="az-section-header__title">Abgelehnte Schichten</span>
                    <span className="az-section-header__rule" />
                  </div>
                  {rejectedSessions.map(s => <AzShiftCard key={s.id} session={s} />)}
                </div>
              )}

              {/* ── Leer-Zustand ──────────────────────────────────────── */}
              {mySessions.length === 0 && (
                <div className="az-empty">Noch keine Schichten vorhanden.</div>
              )}

              {/* ── Footer ────────────────────────────────────────────── */}
              <p className="az-footer">
                Offizielle Arbeitszeit = genehmigt + korrigiert · Ausstehend = wartet auf Admin-Entscheidung
              </p>
            </div>
          );
        })()}

        {/* ══ PLANUNG ════════════════════════════════════════════════════ */}
        {tab === "planung" && (
          <div className="mb-planung">
            {/* Sub-Tab-Bar */}
            <div className="mb-planung-tabs">
              <button
                type="button"
                className={`mb-planung-tab${planungTab === "schichten" ? " mb-planung-tab--active" : ""}`}
                onClick={() => setPlanungTab("schichten")}
              >
                <span className="mb-planung-tab__icon">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="16" height="15" rx="2"/>
                    <line x1="14" y1="1" x2="14" y2="5"/><line x1="6" y1="1" x2="6" y2="5"/>
                    <line x1="2" y1="8" x2="18" y2="8"/>
                    <polyline points="5 13.5 7 15.5 10.5 11"/>
                  </svg>
                </span>
                Schichtplan
              </button>
              <button
                type="button"
                className={`mb-planung-tab${planungTab === "urlaub" ? " mb-planung-tab--active" : ""}`}
                onClick={() => setPlanungTab("urlaub")}
              >
                <span className="mb-planung-tab__icon">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="10" cy="10" r="3"/>
                    <line x1="10" y1="2" x2="10" y2="4"/>
                    <line x1="10" y1="16" x2="10" y2="18"/>
                    <line x1="2" y1="10" x2="4" y2="10"/>
                    <line x1="16" y1="10" x2="18" y2="10"/>
                    <line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/>
                    <line x1="14.4" y1="14.4" x2="15.8" y2="15.8"/>
                    <line x1="4.2" y1="15.8" x2="5.6" y2="14.4"/>
                    <line x1="14.4" y1="5.6" x2="15.8" y2="4.2"/>
                  </svg>
                </span>
                Urlaub
              </button>
            </div>

            {/* ─── Schichtplan ─── */}
            {planungTab === "schichten" && (() => {
              const todayIso2 = new Date().toISOString().slice(0, 10);
              const upcoming  = [...myShifts]
                .filter(s => s.shift_date >= todayIso2)
                .sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
              const past = [...myShifts]
                .filter(s => s.shift_date < todayIso2)
                .sort((a, b) => b.shift_date.localeCompare(a.shift_date))
                .slice(0, 5);
              if (myShifts.length === 0) return (
                <div className="mb-empty">
                  <div className="mb-empty__icon">📅</div>
                  <p className="mb-empty__text">Keine Schichten geplant.</p>
                </div>
              );
              return (
                <div className="mb-shift-list">
                  {upcoming.length > 0 && <p className="mb-shift-section-label">Bevorstehend</p>}
                  {upcoming.map(s => {
                    const isToday = s.shift_date === todayIso2;
                    const dateLabel = new Date(s.shift_date + "T12:00:00").toLocaleDateString("de-DE", {
                      weekday: "short", day: "numeric", month: "short"
                    });
                    const isNight = s.end_time?.slice(0, 5) < s.start_time?.slice(0, 5);
                    return (
                      <div key={s.id} className={`mb-shift-card${isToday ? " mb-shift-card--today" : ""}`}>
                        <div className="mb-shift-card__left">
                          {isToday && <span className="mb-shift-today-badge">Heute</span>}
                          <span className="mb-shift-card__date">{dateLabel}</span>
                        </div>
                        <div className="mb-shift-card__right">
                          <span className="mb-shift-card__time">
                            {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
                            {isNight && <span className="mb-shift-night">Nacht</span>}
                          </span>
                          {s.location_name && <span className="mb-shift-card__loc">📍 {s.location_name}</span>}
                          {s.note && <span className="mb-shift-card__note">{s.note}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {past.length > 0 && (
                    <>
                      <p className="mb-shift-section-label mb-shift-section-label--past">Vergangene</p>
                      {past.map(s => {
                        const dateLabel = new Date(s.shift_date + "T12:00:00").toLocaleDateString("de-DE", {
                          weekday: "short", day: "numeric", month: "short"
                        });
                        return (
                          <div key={s.id} className="mb-shift-card mb-shift-card--past">
                            <div className="mb-shift-card__left">
                              <span className="mb-shift-card__date">{dateLabel}</span>
                            </div>
                            <div className="mb-shift-card__right">
                              <span className="mb-shift-card__time">{s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}</span>
                              {s.location_name && <span className="mb-shift-card__loc">📍 {s.location_name}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })()}

            {/* ─── Urlaub ─── */}
            {planungTab === "urlaub" && (
              <div className="mb-urlaub">
                {/* Summary banner */}
                {leaveSummary && (
                  <div className="mb-urlaub-summary">
                    <div className="mb-urlaub-summary__top">
                      <span className="mb-urlaub-summary__days">{leaveSummary.available_days}</span>
                      <span className="mb-urlaub-summary__label">Tage verfügbar {new Date().getFullYear()}</span>
                    </div>
                    <div className="mb-urlaub-summary__bar">
                      <div
                        className="mb-urlaub-summary__fill"
                        style={{ width: `${Math.min(100, (leaveSummary.used_days_this_year / (leaveSummary.annual_leave_days || 1)) * 100)}%` }}
                      />
                    </div>
                    <div className="mb-urlaub-summary__meta">
                      <span>Soll {leaveSummary.annual_leave_days}</span>
                      <span>Genommen {leaveSummary.used_days_this_year}</span>
                      <span>Rest {leaveSummary.remaining_days}</span>
                    </div>
                  </div>
                )}

                {/* Request form */}
                <div className="mb-urlaub-form-card">
                  <p className="mb-urlaub-form-title">Neuer Urlaubsantrag</p>
                  <form className="mb-urlaub-form" onSubmit={handleLeaveSubmit}>
                    <div className="mb-urlaub-form__row">
                      <label className="mb-urlaub-form__field">
                        <span>Von *</span>
                        <input type="date" value={leaveFrom} onChange={e => setLeaveFrom(e.target.value)} required disabled={leaveSubmitting} />
                      </label>
                      <label className="mb-urlaub-form__field">
                        <span>Bis *</span>
                        <input type="date" value={leaveTo} onChange={e => setLeaveTo(e.target.value)} required disabled={leaveSubmitting} />
                      </label>
                    </div>
                    <label className="mb-urlaub-form__field mb-urlaub-form__field--full">
                      <span>Notiz (optional)</span>
                      <textarea
                        rows={2}
                        value={leaveNote}
                        onChange={e => setLeaveNote(e.target.value)}
                        disabled={leaveSubmitting}
                        placeholder="z. B. Familienurlaub, Umzug …"
                      />
                    </label>
                    {leaveError   && <p className="mb-urlaub-error">{leaveError}</p>}
                    {leaveSuccess && <p className="mb-urlaub-success">{leaveSuccess}</p>}
                    <button type="submit" className="mb-urlaub-submit" disabled={leaveSubmitting || !leaveFrom || !leaveTo}>
                      {leaveSubmitting ? "Wird gesendet…" : "Antrag einreichen"}
                    </button>
                  </form>
                </div>

                {/* Past requests */}
                {myLeaveRequests.length > 0 && (
                  <div className="mb-leave-list">
                    <p className="mb-shift-section-label">Meine Anträge</p>
                    {myLeaveRequests.map(r => {
                      const st = (r.status || "").toLowerCase();
                      const badgeCls = st === "approved" ? "mb-leave-badge--green"
                        : st === "rejected" ? "mb-leave-badge--red" : "mb-leave-badge--orange";
                      const badgeTxt = st === "approved" ? "Genehmigt"
                        : st === "rejected" ? "Abgelehnt" : "Ausstehend";
                      return (
                        <div key={r.id} className="mb-leave-item">
                          <div className="mb-leave-item__dates">
                            {new Date(r.start_date + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}
                            {" – "}
                            {new Date(r.end_date + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}
                          </div>
                          <span className={`mb-leave-badge ${badgeCls}`}>{badgeTxt}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ PROFIL ═════════════════════════════════════════════════════ */}
        {tab === "profil" && (
          <div className="mb-profil">
            <div className="mb-avatar-large">{user?.name?.[0]?.toUpperCase() ?? "?"}</div>
            <div style={{ textAlign: "center" }}>
              <p className="mb-profil-name">{user?.name ?? "—"}</p>
              <p className="mb-profil-role">{user?.role === "admin" ? "Administration" : "Mitarbeiter"}</p>
            </div>

            <div className="mb-profil-info">
              <div className="mb-profil-row">
                <span className="mb-profil-row__label">E-Mail</span>
                <span className="mb-profil-row__value">{user?.email ?? "—"}</span>
              </div>
              <div className="mb-profil-row">
                <span className="mb-profil-row__label">Rolle</span>
                <span className="mb-profil-row__value">{user?.role === "admin" ? "Admin" : "Mitarbeiter"}</span>
              </div>
              {user?.phone && (
                <div className="mb-profil-row">
                  <span className="mb-profil-row__label">Telefon</span>
                  <span className="mb-profil-row__value">{user.phone}</span>
                </div>
              )}
            </div>

            <div className="mb-profil-actions">
              {user?.role === "admin" && (
                <Link to="/admin/dashboard" className="mb-action-btn mb-action-btn--blue">
                  <IcoAdmin />
                  Admin Panel
                </Link>
              )}
              <button
                type="button"
                className="mb-action-btn mb-action-btn--red"
                onClick={() => { clearToken(); navigate("/login"); }}
              >
                <IcoLogout />
                Ausloggen
              </button>
            </div>
          </div>
        )}

      </main>

      {/* ─── Bottom Navigation ─── */}
      <nav className="mb-nav">
        {[
          { id: "dashboard", label: "Home",     Icon: IcoHome      },
          { id: "verlauf",   label: "Verlauf",  Icon: IcoClock    },
          { id: "planung",   label: "Planung",  Icon: IcoPlanung  },
          { id: "statistik", label: "Statistik",Icon: IcoChart    },
          { id: "profil",    label: "Profil",   Icon: IcoPerson   },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`mb-nav__item${tab === id ? " mb-nav__item--active" : ""}`}
            onClick={() => setTab(id)}
          >
            <span className="mb-nav__icon"><Icon /></span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* ─── Check-In / Check-Out Overlay ─── */}
      {overlay && (
        <CheckinOverlay
          type={overlay}
          gps={gps}
          gpsBusy={gpsBusy}
          gpsError={gpsError}
          workplace={workplace}
          apiResult={apiResult}
          apiBusy={apiBusy}
          onConfirm={handleConfirm}
          onClose={() => setOverlay(null)}
        />
      )}

    </div>
  );
}

// ── Check-In / Check-Out Overlay ───────────────────────────────────────────────
function CheckinOverlay({ type, gps, gpsBusy, gpsError, workplace, apiResult, apiBusy, onConfirm, onClose }) {
  const isCheckin = type === "checkin";

  const distanceM = useMemo(() => {
    if (!gps || !workplace) return null;
    return haversineMeters(gps.lat, gps.lng, workplace.lat, workplace.lng);
  }, [gps, workplace]);

  const isInside = distanceM !== null && workplace ? distanceM <= workplace.radius_meters : null;

  // Marker icons
  const gpsIcon  = useMemo(() => makeIcon(apiResult?.success === false ? "#dc2626" : "#2563eb"), [apiResult]);
  const wpIcon   = useMemo(() => makeIcon("#16a34a"), []);

  const canConfirm = Boolean(gps) && !gpsBusy && !apiBusy && !apiResult;

  return (
    <div className="mb-overlay">
      {/* Header */}
      <div className="mb-overlay__header">
        <button type="button" className="mb-overlay__back" onClick={onClose} aria-label="Zurück">
          <IcoArrowLeft />
        </button>
        <span className="mb-overlay__title">Standort prüfen</span>
      </div>

      <div className="mb-overlay__body">
        {/* Map / Loading */}
        {gpsBusy || !gps ? (
          <div className="mb-map-loading">
            {gpsError ? (
              <>
                <span style={{ fontSize: "2rem" }}>📍</span>
                <span className="mb-map-loading__title" style={{ color: "#dc2626" }}>{gpsError}</span>
              </>
            ) : (
              <>
                <div className="mb-map-loading__spinner" />
                <span className="mb-map-loading__title">Standort prüfen</span>
                <span className="mb-map-loading__sub">Bitte warte, wir prüfen deinen Standort…</span>
              </>
            )}
          </div>
        ) : (
          <div className="mb-map-wrap">
            <MapContainer
              center={[gps.lat, gps.lng]}
              zoom={16}
              style={{ height: "100%", width: "100%" }}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapFly lat={gps.lat} lng={gps.lng} />
              <Marker position={[gps.lat, gps.lng]} icon={gpsIcon} />
              {workplace && (
                <>
                  <Marker position={[workplace.lat, workplace.lng]} icon={wpIcon} />
                  <Circle
                    center={[workplace.lat, workplace.lng]}
                    radius={workplace.radius_meters}
                    pathOptions={{
                      color:       isInside === false ? "#dc2626" : "#16a34a",
                      fillColor:   isInside === false ? "#dc2626" : "#16a34a",
                      fillOpacity: 0.1,
                      weight:      2,
                    }}
                  />
                </>
              )}
            </MapContainer>
          </div>
        )}

        {/* Info */}
        <div className="mb-overlay__info">

          {/* Success */}
          {apiResult?.success && (
            <div className="mb-status-banner mb-status-banner--inside">
              <span className="mb-status-banner__icon">✅</span>
              <div>
                <div className="mb-status-banner__main">
                  {isCheckin ? "Erfolgreich eingecheckt!" : "Erfolgreich ausgecheckt!"}
                </div>
                <div className="mb-status-banner__sub">Wird geschlossen…</div>
              </div>
            </div>
          )}

          {/* Error */}
          {apiResult?.success === false && (
            <div className="mb-status-banner mb-status-banner--outside">
              <span className="mb-status-banner__icon">⚠️</span>
              <div>
                <div className="mb-status-banner__main">
                  {apiResult.isOutside ? "Außerhalb des Bereichs" : "Fehler"}
                </div>
                <div className="mb-status-banner__sub">{apiResult.message}</div>
              </div>
            </div>
          )}

          {/* GPS found, no result yet: show status */}
          {gps && !apiResult && isInside !== null && (
            <div className={`mb-status-banner ${isInside ? "mb-status-banner--inside" : "mb-status-banner--outside"}`}>
              <span className="mb-status-banner__icon">{isInside ? "✅" : "⚠️"}</span>
              <div>
                <div className="mb-status-banner__main">
                  {isInside ? "Innerhalb des Bereichs" : "Außerhalb des Bereichs"}
                </div>
                {distanceM !== null && (
                  <div className="mb-status-banner__sub">
                    {distanceM}m Entfernung · erlaubt: {workplace.radius_meters}m
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Detail rows */}
          {gps && (
            <div className="mb-detail-rows">
              {workplace && (
                <div className="mb-detail-row">
                  <span className="mb-detail-row__label">Standort</span>
                  <span className="mb-detail-row__value">{workplace.name}</span>
                </div>
              )}
              {distanceM !== null && (
                <div className="mb-detail-row">
                  <span className="mb-detail-row__label">Entfernung</span>
                  <span className={`mb-detail-row__value ${isInside ? "mb-detail-row__value--green" : "mb-detail-row__value--red"}`}>
                    {distanceM}m {workplace ? `(innerhalb ${workplace.radius_meters}m)` : ""}
                  </span>
                </div>
              )}
              <div className="mb-detail-row">
                <span className="mb-detail-row__label">Zeit</span>
                <span className="mb-detail-row__value">
                  {new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            </div>
          )}

          {/* Confirm button */}
          {!apiResult && (
            <button
              type="button"
              className={`mb-confirm-btn ${isCheckin ? "mb-confirm-btn--green" : "mb-confirm-btn--red"}`}
              onClick={onConfirm}
              disabled={!canConfirm}
            >
              {apiBusy  ? "Wird gespeichert…"  :
               gpsBusy  ? "GPS wird geladen…"   :
               isCheckin ? "Einchecken"          : "Auschecken"}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}
