from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.company_site import ALLOWED_RADIUS_METERS, COMPANY_LAT, COMPANY_LNG
from app.models.location import WorkplaceLocation
from app.utils.distance import haversine_meters

OUTSIDE_COMPANY_AREA = JSONResponse(
    status_code=400,
    content={
        "status": "error",
        "message": "Outside allowed company area",
    },
)


def geofence_block_response(db: Session, lat: float, lng: float) -> JSONResponse | None:
    """
    If coordinates are outside every allowed site, return an error response.

    When at least one row exists in `locations`, the user must be within
    radius_meters of any site. If the table is empty, fall back to the legacy
    single point from company_site (backward compatible).
    """
    locations = db.scalars(select(WorkplaceLocation)).all()

    if not locations:
        distance_m = haversine_meters(lat, lng, COMPANY_LAT, COMPANY_LNG)
        if distance_m > ALLOWED_RADIUS_METERS:
            return OUTSIDE_COMPANY_AREA
        return None

    for loc in locations:
        if haversine_meters(lat, lng, loc.lat, loc.lng) <= float(loc.radius_meters):
            return None
    return OUTSIDE_COMPANY_AREA


def company_geofence_block_response(lat: float, lng: float) -> JSONResponse | None:
    """Legacy helper: single fixed site (no DB). Prefer geofence_block_response with db."""
    distance_m = haversine_meters(lat, lng, COMPANY_LAT, COMPANY_LNG)
    if distance_m > ALLOWED_RADIUS_METERS:
        return OUTSIDE_COMPANY_AREA
    return None
