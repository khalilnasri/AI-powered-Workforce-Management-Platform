import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../utils/useNotifications";
import { useLanguage } from "../i18n/LanguageContext";
import { notifBodyLines, notifCategory, formatNotifRelativeTime } from "../utils/notificationDisplay";

const IcoBell = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

/**
 * Geteilte Benachrichtigungs-Glocke für Desktop- und Mobile-Employee-Dashboard.
 * `variant` wählt nur das CSS-Klassenpräfix — Daten-/Interaktionslogik ist identisch.
 */
export function NotificationDropdown({ variant = "desktop", onOpenEntity, onViewAll, notif }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const internal = useNotifications();
  const { t, locale } = useLanguage();
  const { unreadCount, notifications, listLoading, openList, markRead, markAllRead } = notif ?? internal;

  const prefix = variant === "mobile" ? "mb-notif" : "ed-notif";

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleToggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) openList();
      return next;
    });
  }

  function handleItemClick(notification) {
    if (!notification.read_at) markRead(notification.id);
    setOpen(false);
    onOpenEntity?.(notification);
  }

  function handleViewAll() {
    setOpen(false);
    onViewAll?.();
  }

  return (
    <div className={`${prefix}-wrap`} ref={wrapRef}>
      <button
        type="button"
        className={`${prefix}-trigger`}
        onClick={handleToggle}
        aria-label={t("notifications.panelTitle")}
        aria-expanded={open}
      >
        <IcoBell />
        {unreadCount > 0 && <span className={`${prefix}-badge`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && (
        <div className={`${prefix}-panel`}>
          <div className={`${prefix}-panel__header`}>
            <span>{t("notifications.panelTitle")}</span>
            {unreadCount > 0 && (
              <button type="button" className={`${prefix}-mark-all`} onClick={markAllRead}>
                {t("common.markAllRead")}
              </button>
            )}
          </div>

          <div className={`${prefix}-list`}>
            {listLoading && notifications.length === 0 ? (
              <div className={`${prefix}-empty`}>{t("common.loading")}</div>
            ) : notifications.length === 0 ? (
              <div className={`${prefix}-empty`}>{t("notifications.empty")}</div>
            ) : (
              notifications.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={`${prefix}-item${!n.read_at ? ` ${prefix}-item--unread` : ""}`}
                  onClick={() => handleItemClick(n)}
                >
                  <span className={`${prefix}-item__category`}>{notifCategory(n.type, t)}</span>
                  <span className={`${prefix}-item__title`}>{n.title}</span>
                  {notifBodyLines(n.body).map((line) => (
                    <span key={line} className={`${prefix}-item__body`}>{line}</span>
                  ))}
                  <span className={`${prefix}-item__time`}>{formatNotifRelativeTime(n.created_at, locale)}</span>
                </button>
              ))
            )}
          </div>

          <button type="button" className={`${prefix}-view-all`} onClick={handleViewAll}>
            {t("notifications.viewAll")}
          </button>
        </div>
      )}
    </div>
  );
}
