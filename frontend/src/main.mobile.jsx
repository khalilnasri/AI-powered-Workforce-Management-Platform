import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppMobile from "./App.mobile";
import { hydrateTokenFromPreferences } from "./apiClient";
import { initNativeUi } from "./utils/nativeUi";
import "./index.css";

// No-op in the browser; applies status bar / splash screen / keyboard
// chrome on native platforms only.
initNativeUi();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found');
}

hydrateTokenFromPreferences().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <AppMobile />
      </BrowserRouter>
    </StrictMode>,
  );
});
