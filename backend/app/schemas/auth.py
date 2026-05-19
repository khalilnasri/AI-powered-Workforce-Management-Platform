from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    """Role is assigned by the server (first user = admin, all later = employee)."""

    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class TokenResponse(BaseModel):
    """
    JWT plus role from the database at login (for client routing).
    Every protected route still loads the user and role from the DB via the token.
    """

    access_token: str
    token_type: str = "bearer"
    role: str


class EmployeeResponse(BaseModel):
    """Public employee fields (never includes password)."""

    id: int
    name: str
    email: str
    role: str
