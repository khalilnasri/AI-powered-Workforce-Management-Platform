from fastapi import Depends, HTTPException, status

from app.auth.deps import get_current_employee
from app.models.employee import Employee, EmployeeRole


def require_admin(current_employee: Employee = Depends(get_current_employee)) -> Employee:
    """
    Dependency for /admin/* routes.
    Employees receive 403 — role is always read from the database via JWT → Employee.
    """
    if current_employee.role != EmployeeRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_employee
