import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../apiClient";

const UNREAD_COUNT_URL = "/notifications/unread-count";
const LIST_URL = "/notifications?limit=50";
const POLL_INTERVAL_MS = 30_000;

export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const fetchUnreadCount = useCallback(() => {
    return apiClient
      .get(UNREAD_COUNT_URL)
      .then((res) => setUnreadCount(res.data?.count ?? 0))
      .catch(() => {});
  }, []);

  const fetchNotifications = useCallback(() => {
    setListLoading(true);
    return apiClient
      .get(LIST_URL)
      .then((res) => setNotifications(res.data ?? []))
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    fetchUnreadCount();

    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchUnreadCount();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [fetchUnreadCount]);

  const markRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    apiClient.post(`/notifications/${id}/read`).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    setUnreadCount(0);
    apiClient.post("/notifications/mark-all-read").catch(() => {});
  }, []);

  return {
    unreadCount,
    notifications,
    listLoading,
    openList: fetchNotifications,
    markRead,
    markAllRead,
  };
}
