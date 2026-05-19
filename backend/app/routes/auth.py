from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_employee
from app.auth.jwt_tokens import create_access_token
from app.auth.passwords import hash_password, verify_password
from app.config.database import get_db
from app.models.employee import Employee, EmployeeRole
from app.schemas.auth import (
    EmployeeResponse,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _employee_to_response(employee: Employee) -> EmployeeResponse:
    return EmployeeResponse(
        id=employee.id,
        name=employee.name,
        email=employee.email,
        role=employee.role.value,
    )


@router.post("/register", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """
    Create an employee account. Role is never taken from the request:
    the first user in the database becomes admin; everyone else is employee.
    Password is stored only as a bcrypt hash.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")

    email_norm = body.email.strip().lower()

    existing = db.scalars(
        select(Employee).where(func.lower(Employee.email) == email_norm),
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    total_employees = db.scalar(select(func.count()).select_from(Employee))
    if total_employees is None:
        total_employees = 0
    assigned_role = EmployeeRole.admin if total_employees == 0 else EmployeeRole.employee

    employee = Employee(
        name=name,
        email=email_norm,
        password=hash_password(body.password),
        role=assigned_role,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return _employee_to_response(employee)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    email_norm = body.email.strip().lower()
    stmt = select(Employee).where(func.lower(Employee.email) == email_norm)
    employee = db.scalars(stmt).first()

    if employee is None or not verify_password(body.password, employee.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    token = create_access_token(subject=str(employee.id))
    return TokenResponse(access_token=token, role=employee.role.value)


@router.get("/me", response_model=EmployeeResponse)
def me(current_employee: Employee = Depends(get_current_employee)):
    """Return the authenticated employee (requires valid JWT)."""
    return _employee_to_response(current_employee)
