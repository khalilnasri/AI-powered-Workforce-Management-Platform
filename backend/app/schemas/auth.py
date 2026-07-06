from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    """Role is assigned by the server (first user = admin, all later = employee).

    ``invite_code`` is required for every registration except the very first
    (bootstrap admin) account — enforced server-side in the route handler.
    """

    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., min_length=1, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)
    invite_code: str | None = Field(default=None, max_length=20)


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
