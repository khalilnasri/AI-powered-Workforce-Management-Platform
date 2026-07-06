from datetime import datetime

from pydantic import BaseModel


class InviteCodeOut(BaseModel):
    id: int
    code: str
    created_at: datetime
