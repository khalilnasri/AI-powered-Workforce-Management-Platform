import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Dialog } from "@capacitor/dialog";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Routes where "back" means "leave the app" instead of "go one step back".
 * Mirrors App.mobile.jsx: "/" and "*" redirect to /login, and the dashboard
 * is the post-login home — going back from there would only bounce off the
 * ProtectedRoute redirect and trap the user in a loop.
 */
const DEFAULT_EXIT_ROUTES = ["/", "/login", "/employee/dashboard"];

/**
 * Subscribes to a Capacitor App event on native platforms only and removes
 * the listener on unmount, including when the component unmounts before
 * addListener's promise resolves.
 */
function useAppEvent(eventName, handler, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) {
      return undefined;
    }

    let removed = false;
    let handle = null;

    App.addListener(eventName, (event) => handlerRef.current(event))
      .then((listener) => {
        if (removed) {
          listener.remove();
          return;
        }
        handle = listener;
      })
      .catch(() => {});

    return () => {
      removed = true;
      if (handle) {
        handle.remove();
        handle = null;
      }
    };
  }, [eventName, enabled]);
}

/**
 * Hardware back button handling for Android. On a root route the app is
 * closed, otherwise the router goes back one entry. No-op in the browser,
 * where the built-in browser back button already does the right thing.
 */
export function useAndroidBackButton(exitRoutes = DEFAULT_EXIT_ROUTES) {
  const navigate = useNavigate();
  const location = useLocation();
  const stateRef = useRef({ pathname: location.pathname, exitRoutes });
  stateRef.current = { pathname: location.pathname, exitRoutes };

  useAppEvent("backButton", ({ canGoBack }) => {
    const { pathname, exitRoutes: routes } = stateRef.current;

    if (routes.includes(pathname) || (!canGoBack && window.history.length <= 1)) {
      App.exitApp();
      return;
    }

    navigate(-1);
  });
}

/**
 * Calls onResume every time the app returns to the foreground, so callers can
 * refresh state that may have gone stale while backgrounded.
 */
export function useAppStateListener(onResume) {
  useAppEvent("appStateChange", ({ isActive }) => {
    if (isActive && onResume) {
      onResume();
    }
  });
}

/**
 * Receives deep links opened while the app is running or cold-started, e.g.
 * timestemple://employee/dashboard. Routing is left to the caller.
 */
export function useDeepLinkListener(onUrl) {
  useAppEvent("appUrlOpen", ({ url }) => {
    if (onUrl) {
      onUrl(url);
    }
  });
}

/** Native confirm dialog, falling back to window.confirm in the browser. */
export async function nativeConfirm(message, title = "Bestätigen") {
  if (!Capacitor.isNativePlatform()) {
    return window.confirm(message);
  }

  const { value } = await Dialog.confirm({
    title,
    message,
    okButtonTitle: "OK",
    cancelButtonTitle: "Abbrechen",
  });
  return value;
}

/** Native alert dialog, falling back to window.alert in the browser. */
export async function nativeAlert(message, title = "Hinweis") {
  if (!Capacitor.isNativePlatform()) {
    window.alert(message);
    return;
  }

  await Dialog.alert({ title, message, buttonTitle: "OK" });
}
