from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.deps import get_current_employee
from app.auth.jwt_tokens import create_access_token
from app.auth.passwords import hash_password, verify_password
from app.auth.validators import (
    validate_email_or_raise,
    validate_name_or_raise,
    validate_password_or_raise,
)
from app.config.database import get_db
from app.models.employee import Employee, EmployeeRole
from app.models.invite_code import InviteCode
from app.schemas.auth import (
    EmployeeResponse,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_FAILED_MSG = "E-Mail oder Passwort ist nicht korrekt."
DUPLICATE_EMAIL_MSG = "Mit dieser E-Mail-Adresse existiert bereits ein Konto."
ACCOUNT_DEACTIVATED_MSG = (
    "Ihr Konto wurde deaktiviert. Bitte wenden Sie sich an einen Administrator."
)
INVITE_CODE_REQUIRED_MSG = "Einladungscode erforderlich."
INVITE_CODE_INVALID_MSG = "Ungültiger oder bereits verwendeter Einladungscode."


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
    name = validate_name_or_raise(body.name)
    email_norm = validate_email_or_raise(body.email)
    validate_password_or_raise(body.password)

    existing = db.scalars(
        select(Employee).where(func.lower(Employee.email) == email_norm),
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DUPLICATE_EMAIL_MSG,
        )

    total_employees = db.scalar(select(func.count()).select_from(Employee))
    if total_employees is None:
        total_employees = 0
    assigned_role = EmployeeRole.admin if total_employees == 0 else EmployeeRole.employee

    code_norm = None
    if total_employees != 0:
        code_norm = (body.invite_code or "").strip().upper()
        if not code_norm:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=INVITE_CODE_REQUIRED_MSG,
            )
        # Atomarer Claim: verhindert doppeltes Einlösen bei gleichzeitigen Requests.
        result = db.execute(
            update(InviteCode)
            .where(InviteCode.code == code_norm, InviteCode.used_at.is_(None))
            .values(used_at=func.now())
        )
        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=INVITE_CODE_INVALID_MSG,
            )

    employee = Employee(
        name=name,
        email=email_norm,
        password=hash_password(body.password),
        role=assigned_role,
    )
    db.add(employee)
    db.flush()

    if code_norm is not None:
        db.execute(
            update(InviteCode)
            .where(InviteCode.code == code_norm)
            .values(used_by_employee_id=employee.id)
        )

    db.commit()
    db.refresh(employee)
    return _employee_to_response(employee)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    email_norm = validate_email_or_raise(body.email)

    if not body.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwort darf nicht leer sein.",
        )

    stmt = select(Employee).where(func.lower(Employee.email) == email_norm)
    employee = db.scalars(stmt).first()

    if employee is None or not verify_password(body.password, employee.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=LOGIN_FAILED_MSG,
        )

    if not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ACCOUNT_DEACTIVATED_MSG,
        )

    token = create_access_token(
        subject=str(employee.id),
        role=employee.role.value,
    )
    return TokenResponse(access_token=token, role=employee.role.value)


@router.get("/me", response_model=EmployeeResponse)
def me(current_employee: Employee = Depends(get_current_employee)):
    """Return the authenticated employee (requires valid JWT)."""
    return _employee_to_response(current_employee)
