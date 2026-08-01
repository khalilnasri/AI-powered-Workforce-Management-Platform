import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Keyboard } from "@capacitor/keyboard";

/** Kept in sync with --mb-paper in MobileEmployeeDashboard.css. */
const PAPER = "#F0EADD";

function bindKeyboardClass() {
  if (!Capacitor.isPluginAvailable("Keyboard")) return;
  const setOpen = (open) => document.body.classList.toggle("keyboard-open", open);
  Keyboard.addListener("keyboardWillShow", () => setOpen(true));
  Keyboard.addListener("keyboardWillHide", () => setOpen(false));
}

/**
 * Applies native-only chrome (status bar, splash screen, keyboard hooks).
 * No-op in the browser, so it is safe to call from any entry point.
 */
export async function initNativeUi() {
  if (!Capacitor.isNativePlatform()) return;

  document.body.classList.add("native-app");

  // The app bar is warm cream, so the status bar needs dark icons (Style.Light).
  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Light }),
    StatusBar.setBackgroundColor({ color: PAPER }),
  ]);

  bindKeyboardClass();

  // Two frames: the first paint has landed before the splash is torn down.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      SplashScreen.hide().catch(() => {});
    });
  });
}
