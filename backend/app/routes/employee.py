from fastapi import APIRouter, Depends

from app.auth.deps import get_current_employee
from app.models.employee import Employee

router = APIRouter(prefix="/employee", tags=["employee"])


@router.get("/dashboard")
def employee_dashboard(current_employee: Employee = Depends(get_current_employee)):
    return {
        "message": f"Hello, {current_employee.name}",
        "role": current_employee.role.value,
        "employee_id": current_employee.id,
        "email": current_employee.email,
    }
