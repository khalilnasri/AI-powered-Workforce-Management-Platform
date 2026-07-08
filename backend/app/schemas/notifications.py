from datetime import datetime

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str | None = None

    entity_type: str | None = None
    entity_id: int | None = None

    actor_id: int | None = None
    actor_name: str | None = None

    read_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UnreadCountOut(BaseModel):
    count: int
