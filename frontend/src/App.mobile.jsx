import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./apiClient";
import { EmployeeDashboard } from "./pages/EmployeeDashboard";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { useAndroidBackButton } from "./utils/nativeLifecycle";

/**
 * Mobile (Capacitor) app router — employee-only.
 * Deliberately does NOT import AdminDashboard so admin code/strings
 * never end up in the mobile bundle. Kept in sync with App.jsx's
 * employee routes; do not add admin routes here.
 */
function ProtectedRoute({ children }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function AppMobile() {
  // No-op in the browser; on Android, "back" navigates within the app
  // instead of leaving it, except on the root/login/dashboard routes.
  useAndroidBackButton();

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/employee/dashboard"
        element={
          <ProtectedRoute>
            <EmployeeDashboard />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
