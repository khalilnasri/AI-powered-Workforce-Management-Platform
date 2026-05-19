from sqlalchemy import Column, DateTime, Float, Integer, String, func

from app.config.database import Base


class WorkplaceLocation(Base):
    """Company site for geofencing and admin planning (supports multiple sites)."""

    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    address = Column(String(512), nullable=False, default="", server_default="")
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    radius_meters = Column(Float, nullable=False, default=200.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
