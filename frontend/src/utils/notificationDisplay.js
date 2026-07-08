const NOTIF_TYPE_KEYS = {
  "session.approved": "notifications.category.work",
  "session.rejected": "notifications.category.work",
  "session.corrected": "notifications.category.work",
  "session.deleted": "notifications.category.work",
  "attendance.reminder": "notifications.category.stamp",
  "attendance.force_checkout": "notifications.category.work",
  "leave.approved": "notifications.category.leave",
  "leave.rejected": "notifications.category.leave",
  "shift.assigned": "notifications.category.shift",
  "shift.updated": "notifications.category.shift",
  "shift.deleted": "notifications.category.shift",
};

/** Kategorie-Label für Notification-Typen (benötigt `t` aus useLanguage). */
export function notifCategory(type, t) {
  const key = NOTIF_TYPE_KEYS[type];
  return key ? t(key) : t("notifications.category.admin");
}

/** Body-Zeilen für die Anzeige (Backend trennt mit \\n). */
export function notifBodyLines(body) {
  if (!body) return [];
  return String(body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatNotifRelativeTime(iso, locale = "de") {
  const date = new Date(iso);
  const diffSec = (Date.now() - date.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diffSec < 60) return locale === "en" ? "Just now" : locale === "fr" ? "À l'instant" : "Gerade eben";
  if (diffSec < 3600) {
    const m = -Math.floor(diffSec / 60);
    return rtf.format(m, "minute");
  }
  if (diffSec < 86400) {
    const h = -Math.floor(diffSec / 3600);
    return rtf.format(h, "hour");
  }
  return date.toLocaleDateString(locale === "fr" ? "fr-FR" : locale === "en" ? "en-GB" : "de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
