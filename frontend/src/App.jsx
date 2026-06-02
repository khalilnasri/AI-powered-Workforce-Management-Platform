import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiClient, getToken } from "./apiClient";
import { AdminDashboard } from "./pages/AdminDashboard";
import { EmployeeDashboard } from "./pages/EmployeeDashboard";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";

function ProtectedRoute({ children }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** Only admins; employees are sent to the employee dashboard. */
function AdminRoute({ children }) {
  const token = getToken();
  const [state, setState] = useState({ loading: Boolean(token), allowed: false });

  useEffect(() => {
    if (!token) {
      setState({ loading: false, allowed: false });
      return;
    }
    let cancelled = false;
    apiClient
      .get("/auth/me")
      .then((res) => {
        if (!cancelled) {
          setState({
            loading: false,
            allowed: res.data?.role === "admin",
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, allowed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (state.loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
        Zugriff wird geprüft…
      </div>
    );
  }
  if (!state.allowed) {
    return <Navigate to="/employee/dashboard" replace />;
  }
  return children;
}

export default function App() {
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
      <Route
        path="/admin/dashboard"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
