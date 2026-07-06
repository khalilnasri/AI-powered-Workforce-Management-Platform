import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.employee import Employee
from app.models.invite_code import InviteCode
from app.schemas.invite_codes import InviteCodeOut

router = APIRouter(prefix="/admin/invite-codes", tags=["invite-codes"])

# ohne verwechselbare Zeichen (O/0, I/1)
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_MAX_ATTEMPTS = 10


def _generate_code() -> str:
    return "TS-" + "".join(secrets.choice(_ALPHABET) for _ in range(6))


@router.post("", response_model=InviteCodeOut, status_code=status.HTTP_201_CREATED)
def create_invite_code(
    db: Session = Depends(get_db),
    current_admin: Employee = Depends(require_admin),
):
    """Erzeugt einen einmalig verwendbaren Einladungscode."""
    for _ in range(_MAX_ATTEMPTS):
        code = _generate_code()
        clash = db.scalar(select(func.count()).select_from(InviteCode).where(InviteCode.code == code))
        if not clash:
            break
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Konnte keinen eindeutigen Code erzeugen. Bitte erneut versuchen.",
        )

    invite = InviteCode(code=code, created_by_employee_id=current_admin.id)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return InviteCodeOut(id=invite.id, code=invite.code, created_at=invite.created_at)
