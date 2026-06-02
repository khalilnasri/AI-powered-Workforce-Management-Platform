/** Post-login route from server role (must match backend EmployeeRole values). */
export function dashboardPathForRole(role) {
  if (role === "admin") return "/admin/dashboard";
  return "/employee/dashboard";
}
